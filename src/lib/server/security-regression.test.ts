/// <reference types="bun" />
import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import type { D1Database } from '@cloudflare/workers-types';
import { labelsForEmails, setThreadLabels, rememberSenders } from './labels';
import { deleteEmailsPermanently, listThreadMessages } from './mail-store';
import { completeFirstLogin, setUserPassword, login } from './auth';
import { hashPassword } from './crypto';
import { authorizeApiRequest } from './api-access';
import { deploymentPolicyResponse } from './deployment-policy';
import { POST as signIn } from '../../routes/api/auth/login/+server';
import { GET as attachment } from '../../routes/api/mail/[id]/attachments/[attachmentId]/+server';

function fixture() {
 const sql = new Database(':memory:');
 for (const filename of readdirSync('migrations').sort()) sql.exec(readFileSync(`migrations/${filename}`, 'utf8'));
 const prepare = (query: string, args: any[] = []): any => ({
  bind(...bound: any[]) {
   if (bound.length > 100) throw new Error('D1 bind limit exceeded');
   return prepare(query, bound);
  },
  execute() {
   const results = sql.query(query).all(...args);
   return { results, success: true, meta: { changes: (sql.query('SELECT changes() AS n').get() as { n: number }).n } };
  },
  async all() { return this.execute(); },
  async run() { return this.execute(); },
  async first(column?: string) { const row = sql.query(query).get(...args) as Record<string, unknown> | null; return column ? row?.[column] : row; }
 });
 const db = { prepare, async batch(statements: any[]) { return sql.transaction(() => statements.map(s => s.execute()))(); } } as unknown as D1Database;
 sql.exec("INSERT INTO users (id,email,name,password_hash) VALUES ('u','colin@example.com','Colin','invalid'),('other','other@example.com','Other','invalid')");
 return { sql, db };
}

function seedCredentials(sql: Database) {
 sql.exec(`INSERT INTO sessions(id,user_id,token_hash,expires_at) VALUES('s','u','s','2099-01-01');
 INSERT INTO api_tokens(id,user_id,name,token_hash,token_preview,created_at) VALUES('a','u','a','a','a','2026-01-01');
 INSERT INTO pairing_codes(id,user_id,code_hash,expires_at) VALUES('p','u','p','2099-01-01');
 INSERT INTO oauth_codes(code_hash,client_id,user_id,redirect_uri,code_challenge,scope,resource,expires_at,created_at) VALUES('c','c','u','https://example.com','challenge','mail:read','https://example.com','2099-01-01','2026-01-01');
 INSERT INTO oauth_grants(id,family_id,client_id,user_id,scope,resource,access_hash,refresh_hash,access_expires_at,refresh_expires_at,created_at) VALUES('g','f','c','u','mail:read','https://example.com','a','r','2099-01-01','2099-01-01','2026-01-01');`);
}
for (const firstLogin of [false, true]) test(`password replacement revokes every credential (first login: ${firstLogin})`, async () => {
 const {sql,db} = fixture(); seedCredentials(sql);
 sql.query('UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?').run(await hashPassword('old-password'), Number(firstLogin), 'u');
 if (firstLogin) await completeFirstLogin(db,'u',{name:'Colin',password:'new-password'});
 else await setUserPassword(db,'u','new-password');
 for (const table of ['sessions','api_tokens','pairing_codes','oauth_codes','oauth_grants']) expect((sql.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n).toBe(0);
 expect(await login(db,'colin@example.com','old-password')).toBeNull();
 expect((await login(db,'colin@example.com','new-password'))?.user.email).toBe('colin@example.com');
 sql.close();
});

test('password reset wins over an in-flight login using the old hash', async () => {
 const {sql,db}=fixture();
 sql.query('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword('old-password'),'u');
 const original=db.prepare.bind(db);
 db.prepare=((query:string) => {
  if (query.includes('INSERT INTO sessions')) sql.query("UPDATE users SET password_hash='changed' WHERE id='u'").run();
  return original(query);
 }) as any;
 expect(await login(db,'colin@example.com','old-password')).toBeNull();
 expect((sql.query('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n).toBe(0); sql.close();
});

test('large threads can be read, labeled, marked as spam and deleted within the D1 bind limit',async()=>{
 const {sql,db}=fixture(); const ids=Array.from({length:205},(_,i)=>`e${i}`);
 for (const id of ids) sql.query("INSERT INTO emails(id,user_id,direction,from_addr,to_addr,subject,thread_id) VALUES(?,'u','inbound','sender@example.com','colin@example.com','same subject','thread')").run(id);
 sql.exec("INSERT INTO labels(id,user_id,name,slug,color) VALUES('label','u','Test','test','#000000')");
 await setThreadLabels(db,'u',ids,['label']);
 expect((await labelsForEmails(db,ids)).size).toBe(205);
 expect((await listThreadMessages(db,'u',sql.query("SELECT * FROM emails WHERE id='e0'").get() as any)).length).toBe(205);
 await rememberSenders(db,'u',ids,'spam');
 sql.exec("INSERT INTO emails(id,user_id,direction,from_addr,to_addr,subject) VALUES('protected','other','inbound','sender@example.com','other@example.com','private')");
 expect(await deleteEmailsPermanently(db,undefined,'u',[...ids,'protected'])).toBe(205);
 expect(sql.query("SELECT id FROM emails WHERE id='protected'").get()).not.toBeNull(); sql.close();
});

test('send-only and read-only keys cannot forward or permanently delete existing messages',()=>{
 for (const [pathname,method] of [['/api/mail/id/forward','POST'],['/api/mail/thread/id/forward','POST'],['/api/mail/id','DELETE']]) {
  for (const scopes of [['mail:send'],['mail:read'],['mail:read','mail:send']]) {
   expect(authorizeApiRequest({pathname,method,authMethod:'api_token',scopes:scopes as any}).ok).toBe(scopes.length===2);
  }
 }
});

test('login enforces account throttling and rejects malformed input',async()=>{
 const {sql,db}=fixture();
 const invoke=(body:string)=>signIn({request:new Request('https://inbox.example.com/api/auth/login',{method:'POST',body,headers:{'cf-connecting-ip':'192.0.2.1'}}),platform:{env:{DB:db}},cookies:{get:()=>undefined},url:new URL('https://inbox.example.com')} as any);
 expect((await invoke('null')).status).toBe(400);
 expect((await invoke('{')).status).toBe(400);
 for (let i=0;i<10;i++) expect((await invoke(JSON.stringify({email:'missing@example.com',password:'wrong'}))).status).toBe(401);
 const blocked=await invoke(JSON.stringify({email:'missing@example.com',password:'wrong'}));
 expect(blocked.status).toBe(429); expect(blocked.headers.get('Retry-After')).toBe('600'); sql.close();
});

test('active-content attachments download with a restrictive sandbox',async()=>{
 const {sql,db}=fixture();
 sql.exec("INSERT INTO emails(id,user_id,direction,from_addr,to_addr,subject) VALUES('e','u','inbound','sender@example.com','colin@example.com','Attachment')");
 for (const contentType of ['text/html','image/svg+xml','application/xhtml+xml']) {
  sql.query("INSERT OR REPLACE INTO email_attachments(id,email_id,filename,content_type,size_bytes,content_base64) VALUES('a','e','attack.html',?,8,?)").run(contentType,Buffer.from('<script>').toString('base64'));
  const response=await attachment({params:{id:'e',attachmentId:'a'},locals:{user:{id:'u'}},platform:{env:{DB:db,ATTACHMENTS:{}}},url:new URL('https://inbox.example.com/api/mail/e/attachments/a')} as any);
  expect(response.headers.get('Content-Disposition')).toStartWith('attachment;');
  expect(response.headers.get('Content-Security-Policy')).toContain("sandbox; default-src 'none'");
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
 }
 sql.close();
});

test('web-mail deployment closes public provisioning and external authentication',()=>{
 const env={DISABLE_PUBLIC_SETUP:'true',DISABLE_EXTERNAL_AUTH:'true'};
 for (const path of ['/setup','/setup/','/api/setup','/oauth/token','/oauth/authorize','/mcp','/api/apikeys','/api/auth/pair-codes','/api/auth/pair','/install.sh','/%6fauth/token']) expect(deploymentPolicyResponse(path,env)?.status).toBe(403);
 for (const path of ['/login','/inbox','/api/mail','/account/setup','/api/auth/complete-setup']) expect(deploymentPolicyResponse(path,env)).toBeNull();
});
