#!/usr/bin/env node
/**
 * Interactive first-run setup for QuickMail.
 *
 * Installs tools, logs into Cloudflare, creates D1/R2, writes env and
 * wrangler config, and onboards a mail domain (Resend or Cloudflare Email).
 *
 * Usage:
 *   bun run setup
 *   node scripts/setup.mjs
 *   bash scripts/setup.sh
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import readline from 'node:readline/promises';
import { stdin as stdinStream, stdout as stdoutStream } from 'node:process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const wranglerFile = join(root, 'wrangler.jsonc');
const devVarsFile = join(root, '.dev.vars');
const devVarsExample = join(root, '.dev.vars.example');
const envFile = join(root, '.env');

const MIN_WRANGLER = [4, 123, 0];
const ADDRESSES_WRANGLER = [4, 113, 0];
const MIN_NODE_MAJOR = 20;
const BUN_INSTALL_DIR = process.env.BUN_INSTALL || join(homedir(), '.bun');
const RESEND_WEBHOOK_EVENTS = [
	'email.received',
	'email.sent',
	'email.delivered',
	'email.bounced',
	'email.complained',
	'email.delivery_delayed',
	'email.failed'
];

const tty = Boolean(stdoutStream.isTTY);
const c = {
	dim: (s) => (tty ? `\x1b[2m${s}\x1b[0m` : s),
	bold: (s) => (tty ? `\x1b[1m${s}\x1b[0m` : s),
	green: (s) => (tty ? `\x1b[32m${s}\x1b[0m` : s),
	yellow: (s) => (tty ? `\x1b[33m${s}\x1b[0m` : s),
	red: (s) => (tty ? `\x1b[31m${s}\x1b[0m` : s)
};

const args = parseArgs(process.argv.slice(2));

if (args.help) {
	printHelp();
	process.exit(0);
}

let rl = null;

function printHelp() {
	console.log(`QuickMail setup

Installs tools, logs you into Cloudflare, creates D1/R2, writes env and
wrangler config, and onboards your mail domain.

  bun run setup
  bash scripts/setup.sh
  node scripts/setup.mjs [options]

Options:
  --domain <name>      Mail domain (e.g. example.com)
  --provider <name>    resend | cloudflare
  --d1-name <name>     D1 database name (e.g. quickmail)
  --r2-name <name>     R2 bucket name (e.g. quickmail-attachments)
  --yes                Accept defaults (still requires --domain)
  --skip-deploy        Do not deploy at the end
  --help               Show this help
`);
}

function parseArgs(argv) {
	const out = {
		help: false,
		yes: false,
		skipDeploy: false,
		domain: null,
		provider: null,
		d1Name: null,
		r2Name: null
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		switch (arg) {
			case '--help':
			case '-h':
				out.help = true;
				break;
			case '--yes':
			case '-y':
				out.yes = true;
				break;
			case '--skip-deploy':
				out.skipDeploy = true;
				break;
			case '--domain':
				out.domain = argv[++i] ?? '';
				break;
			case '--provider':
				out.provider = argv[++i] ?? '';
				break;
			case '--d1-name':
				out.d1Name = argv[++i] ?? '';
				break;
			case '--r2-name':
				out.r2Name = argv[++i] ?? '';
				break;
			default:
				if (arg.startsWith('--domain=')) out.domain = arg.slice('--domain='.length);
				else if (arg.startsWith('--provider=')) out.provider = arg.slice('--provider='.length);
				else if (arg.startsWith('--d1-name=')) out.d1Name = arg.slice('--d1-name='.length);
				else if (arg.startsWith('--r2-name=')) out.r2Name = arg.slice('--r2-name='.length);
				else {
					console.error(`Unknown option: ${arg}`);
					printHelp();
					process.exit(1);
				}
		}
	}
	if (out.provider) {
		out.provider = out.provider.trim().toLowerCase();
		if (out.provider !== 'resend' && out.provider !== 'cloudflare') {
			console.error('--provider must be "resend" or "cloudflare".');
			process.exit(1);
		}
	}
	return out;
}

function log(message = '') {
	console.log(message);
}

function ok(message) {
	console.log(`  ${c.green('✓')} ${message}`);
}

function warn(message) {
	console.log(`  ${c.yellow('!')} ${message}`);
}

function fail(message) {
	console.error(`  ${c.red('✗')} ${message}`);
}

function section(step, total, title) {
	console.log(`\n${c.bold(`── ${step}/${total}  ${title}`)}`);
}

function which(cmd) {
	const probe =
		process.platform === 'win32'
			? spawnSync('where', [cmd], { encoding: 'utf8' })
			: spawnSync('sh', ['-c', `command -v ${shellQuote(cmd)}`], { encoding: 'utf8' });
	const path = probe.stdout?.trim().split(/\r?\n/)[0];
	return probe.status === 0 && path ? path : null;
}

function shellQuote(value) {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

function bunBin() {
	return which('bun') || (existsSync(join(BUN_INSTALL_DIR, 'bin', 'bun')) ? join(BUN_INSTALL_DIR, 'bin', 'bun') : null);
}

function hasBun() {
	return Boolean(bunBin());
}

function childEnv(extra = {}) {
	const bunDir = join(BUN_INSTALL_DIR, 'bin');
	const bins = [join(root, 'node_modules', '.bin'), bunDir].filter((dir) => existsSync(dir) || dir === bunDir);
	return {
		...process.env,
		PATH: `${bins.join(delimiter)}${delimiter}${process.env.PATH ?? ''}`,
		...extra
	};
}

function run(command, commandArgs, { inherit = false, input, env, allowFail = false, stdio } = {}) {
	const result = spawnSync(command, commandArgs, {
		cwd: root,
		encoding: 'utf8',
		env: childEnv(env),
		input,
		stdio: stdio ?? (inherit ? 'inherit' : ['pipe', 'pipe', 'pipe'])
	});
	if (result.status !== 0 && !allowFail) {
		const detail = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
		const error = new Error(
			detail || `${command} ${commandArgs.join(' ')} failed (exit ${result.status ?? 'null'})`
		);
		error.output = detail;
		error.status = result.status;
		throw error;
	}
	return result;
}

function wrangler(wranglerArgs, options = {}) {
	const local = join(
		root,
		'node_modules',
		'.bin',
		process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler'
	);
	if (existsSync(local)) {
		return run(local, wranglerArgs, options);
	}
	if (hasBun()) {
		return run(bunBin(), ['x', 'wrangler', ...wranglerArgs], options);
	}
	return run('npx', ['wrangler', ...wranglerArgs], options);
}

function parseJsonOutput(text) {
	if (!text) return null;
	const start = text.search(/[\[{]/);
	if (start === -1) return null;
	try {
		return JSON.parse(text.slice(start));
	} catch {
		return null;
	}
}

function parseVersion(text) {
	const match = String(text).match(/(\d+)\.(\d+)\.(\d+)/);
	return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [0, 0, 0];
}

function versionGte(version, minimum) {
	for (let i = 0; i < 3; i++) {
		if (version[i] > minimum[i]) return true;
		if (version[i] < minimum[i]) return false;
	}
	return true;
}

function formatVersion(version) {
	return version.join('.');
}

async function ensureReadline() {
	if (!rl) {
		rl = readline.createInterface({ input: stdinStream, output: stdoutStream });
	}
	return rl;
}

async function closeReadline() {
	if (rl) {
		rl.close();
		rl = null;
	}
}

async function prompt(question, fallback = '') {
	if (args.yes) return fallback;
	if (!stdinStream.isTTY) {
		if (fallback) return fallback;
		throw new Error(`Non-interactive run needs a value for: ${question}`);
	}
	const suffix = fallback ? ` ${c.dim(`(${fallback})`)}` : '';
	const input = await (await ensureReadline()).question(`  ${question}${suffix}: `);
	return input.trim() || fallback;
}

async function confirm(question, defaultYes = true) {
	if (args.yes) return defaultYes;
	if (!stdinStream.isTTY) return defaultYes;
	const hint = defaultYes ? 'Y/n' : 'y/N';
	const input = (await prompt(`${question} [${hint}]`)).toLowerCase();
	if (!input) return defaultYes;
	return input === 'y' || input === 'yes';
}

async function promptSecret(question) {
	if (!stdinStream.isTTY) {
		throw new Error(`Non-interactive run cannot prompt for ${question}. Omit it or run in a terminal.`);
	}
	await closeReadline();
	stdoutStream.write(`  ${question}: `);
	const value = await readMutedLine();
	stdoutStream.write('\n');
	return value.trim();
}

function readMutedLine() {
	return new Promise((resolve, reject) => {
		if (typeof stdinStream.setRawMode !== 'function') {
			const lineRl = readline.createInterface({ input: stdinStream, output: stdoutStream });
			lineRl
				.question('')
				.then((answer) => {
					lineRl.close();
					resolve(answer);
				}, reject);
			return;
		}

		stdinStream.setRawMode(true);
		stdinStream.resume();
		stdinStream.setEncoding('utf8');
		let value = '';

		const restore = () => {
			stdinStream.setRawMode(false);
			stdinStream.pause();
			stdinStream.removeListener('data', onData);
		};

		const onData = (char) => {
			if (char === '\n' || char === '\r' || char === '\u0004') {
				restore();
				resolve(value);
				return;
			}
			if (char === '\u0003') {
				restore();
				stdoutStream.write('\n');
				process.exit(1);
			}
			if (char === '\u007f' || char === '\b') {
				value = value.slice(0, -1);
				return;
			}
			if (char < ' ') return;
			value += char;
			stdoutStream.write('•');
		};

		stdinStream.on('data', onData);
	});
}

function readWrangler() {
	if (!existsSync(wranglerFile)) {
		throw new Error('wrangler.jsonc is missing. Run this from the QuickMail repo root.');
	}
	return readFileSync(wranglerFile, 'utf8');
}

function writeWrangler(source) {
	writeFileSync(wranglerFile, source.endsWith('\n') ? source : `${source}\n`);
}

function jsoncString(source, key) {
	return source.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`))?.[1] ?? null;
}

function setFirstString(source, key, value) {
	return source.replace(new RegExp(`("${key}"\\s*:\\s*")[^"]*(")`), `$1${value}$2`);
}

function setVars(source, { provider, domains }) {
	const lines = [`\t\t"EMAIL_PROVIDER": "${provider}"`];
	if (provider === 'cloudflare' && domains) {
		lines.push(`\t\t"CLOUDFLARE_MAIL_DOMAINS": "${domains}"`);
	} else {
		lines.push(`\t\t// "CLOUDFLARE_MAIL_DOMAINS": "example.com"`);
	}
	const block = `\t"vars": {\n${lines.join(',\n')}\n\t}`;
	if (/\t"vars"\s*:\s*\{[\s\S]*?\n\t\}/.test(source)) {
		return source.replace(/\t"vars"\s*:\s*\{[\s\S]*?\n\t\}/, block);
	}
	return source.replace(/\n(\t"send_email")/, `\n${block},\n\n$1`);
}

function setAddresses(source, addresses) {
	const rendered = `"addresses": ${JSON.stringify(addresses)}`;
	if (/"addresses"\s*:/.test(source)) {
		return source.replace(/"addresses"\s*:\s*\[[^\]]*\]/, rendered);
	}
	return source.replace(/\n(\t*"send_email")/, `\n\t${rendered},\n\n$1`);
}

function removeAddresses(source) {
	return source.replace(/\n\t"addresses"\s*:\s*\[[^\]]*\]\s*,?/, '\n');
}

function setRoutes(source, hostname) {
	const block = `\t"routes": [\n\t\t{\n\t\t\t"pattern": "${hostname}",\n\t\t\t"custom_domain": true\n\t\t}\n\t],\n`;
	if (/^\t"routes": \[/m.test(source)) {
		return source.replace(/\t"routes": \[[\s\S]*?\],\n/, block);
	}
	if (/\t\/\/ "routes": \[[\s\S]*?\t\/\/ \],\n/.test(source)) {
		return source.replace(/\t\/\/ "routes": \[[\s\S]*?\t\/\/ \],\n/, block);
	}
	return source.replace(/("workers_dev": true,\n)/, `$1\n${block}`);
}

function upsertEnvFile(file, updates, { fromExample = false } = {}) {
	let text = existsSync(file)
		? readFileSync(file, 'utf8')
		: fromExample && existsSync(devVarsExample)
			? readFileSync(devVarsExample, 'utf8')
			: '';

	for (const [key, value] of Object.entries(updates)) {
		if (value == null) continue;
		const line = `${key}=${value}`;
		const re = new RegExp(`^#?\\s*${key}=.*$`, 'm');
		if (re.test(text)) text = text.replace(re, line);
		else text = `${text.trimEnd()}\n${line}\n`;
	}

	writeFileSync(file, text.endsWith('\n') ? text : `${text}\n`);
}

function normalizeDomain(raw) {
	let value = String(raw).trim().toLowerCase();
	value = value.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
	if (value.includes('@')) value = value.slice(value.lastIndexOf('@') + 1);
	value = value.replace(/\.$/, '').replace(/^www\./, '');
	return value;
}

function isDomain(value) {
	return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(value);
}

function isWorkerName(value) {
	return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(value);
}

function isR2BucketName(value) {
	return (
		value.length >= 3 &&
		value.length <= 63 &&
		/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(value)
	);
}

function nodeMajor() {
	const path = which('node');
	if (!path) return null;
	const result = spawnSync(path, ['-v'], { encoding: 'utf8' });
	const version = parseVersion(result.stdout || '');
	return version[0] || null;
}

async function ensureRuntime() {
	if (process.platform === 'win32' && !hasBun() && !which('node')) {
		throw new Error(
			'Install Node.js 20+ from https://nodejs.org or Bun from https://bun.sh, then re-run setup.'
		);
	}

	if (hasBun()) {
		ok(`bun ${run(bunBin(), ['--version'], { allowFail: true }).stdout.trim() || 'installed'}`);
		return;
	}

	warn('Bun is not installed. QuickMail scripts (build, deploy, migrate) expect bun.');
	if (await confirm('Install bun now?', true)) {
		if (process.platform === 'win32') {
			throw new Error('Install bun from https://bun.sh on Windows, then re-run setup.');
		}
		run('sh', ['-c', 'curl -fsSL https://bun.sh/install | bash'], { inherit: true });
		if (!hasBun()) {
			throw new Error(
				`Bun installed but not on PATH. Open a new terminal or add ${join(BUN_INSTALL_DIR, 'bin')} to PATH.`
			);
		}
		ok(`bun ${run(bunBin(), ['--version']).stdout.trim()}`);
		return;
	}

	const major = nodeMajor();
	if (major && major >= MIN_NODE_MAJOR) {
		ok(`node v${process.versions.node} (bun skipped; some npm scripts still call bun)`);
		return;
	}
	if (major) {
		throw new Error(`Node ${major} is too old. Install Node ${MIN_NODE_MAJOR}+ or bun, then re-run.`);
	}
	throw new Error('Need bun (https://bun.sh) or Node 20+ (https://nodejs.org).');
}

function installDeps() {
	if (hasBun()) {
		run(bunBin(), ['install'], { inherit: true });
		ok('dependencies installed (bun)');
		return;
	}
	run('npm', ['install'], { inherit: true });
	ok('dependencies installed (npm)');
}

function wranglerVersion() {
	const result = wrangler(['--version'], { allowFail: true });
	return parseVersion(`${result.stdout}\n${result.stderr}`);
}

function upgradeWrangler() {
	if (hasBun()) {
		run(bunBin(), ['add', '-d', 'wrangler@latest'], { inherit: true });
	} else {
		run('npm', ['install', '-D', 'wrangler@latest'], { inherit: true });
	}
}

async function ensureWrangler(needLatest) {
	if (!existsSync(join(root, 'node_modules', 'wrangler')) && !which('wrangler')) {
		installDeps();
	}

	let version = wranglerVersion();
	ok(`wrangler ${formatVersion(version)}`);

	if (!needLatest && versionGte(version, MIN_WRANGLER)) return version;
	if (needLatest && versionGte(version, MIN_WRANGLER)) return version;

	warn(
		`Wrangler ${formatVersion(version)} is too old. Cloudflare Email Sending needs ${formatVersion(MIN_WRANGLER)}+.`
	);
	if (!(await confirm('Upgrade wrangler to latest?', true))) {
		if (needLatest) {
			throw new Error(`Upgrade wrangler (bun add -d wrangler@latest) and re-run.`);
		}
		return version;
	}
	upgradeWrangler();
	version = wranglerVersion();
	ok(`wrangler ${formatVersion(version)}`);
	return version;
}

function parseWhoami(text) {
	const combined = text.trim();
	const unauthenticated = /not (logged in|authenticated)|please run.*login|login to continue/i.test(
		combined
	);
	const email =
		combined.match(/email ['"]([^'"]+)['"]/i)?.[1] ??
		combined.match(/\b([\w.+-]+@[\w.-]+\.[a-z]{2,})\b/i)?.[1] ??
		null;
	const accounts = [];
	const seen = new Set();
	for (const match of combined.matchAll(/([^\n│|]{2,64}?)[│|]\s*([0-9a-f]{32})/gi)) {
		const name = match[1].replace(/[│|]/g, '').trim();
		const id = match[2].toLowerCase();
		if (seen.has(id)) continue;
		seen.add(id);
		accounts.push({ name: name || id, id });
	}
	if (accounts.length === 0) {
		for (const match of combined.matchAll(/\b([0-9a-f]{32})\b/gi)) {
			const id = match[1].toLowerCase();
			if (seen.has(id)) continue;
			seen.add(id);
			accounts.push({ name: id, id });
		}
	}
	return { email, accounts, unauthenticated };
}

async function ensureLogin() {
	const who = wrangler(['whoami'], { allowFail: true });
	const parsed = parseWhoami(`${who.stdout}\n${who.stderr}`);
	if (who.status === 0 && !parsed.unauthenticated && (parsed.email || parsed.accounts.length)) {
		ok(parsed.email ? `logged in as ${parsed.email}` : 'logged in to Cloudflare');
		return pickAccount(parsed.accounts);
	}

	log(`  ${c.dim('Opening a browser for wrangler login…')}`);
	wrangler(['login'], { inherit: true });

	const again = wrangler(['whoami'], { allowFail: true });
	const next = parseWhoami(`${again.stdout}\n${again.stderr}`);
	if (again.status !== 0 || next.unauthenticated) {
		throw new Error('Cloudflare login did not complete. Run `bunx wrangler login` and re-run setup.');
	}
	ok(next.email ? `logged in as ${next.email}` : 'logged in to Cloudflare');
	return pickAccount(next.accounts);
}

async function pickAccount(accounts) {
	if (accounts.length === 0) return null;
	if (accounts.length === 1) {
		ok(`account ${accounts[0].name}`);
		upsertEnvFile(envFile, { CLOUDFLARE_ACCOUNT_ID: accounts[0].id });
		return accounts[0];
	}

	log('  This login can see more than one Cloudflare account:');
	accounts.forEach((account, index) => {
		log(`    ${index + 1}) ${account.name}  ${c.dim(account.id)}`);
	});

	if (args.yes) {
		upsertEnvFile(envFile, { CLOUDFLARE_ACCOUNT_ID: accounts[0].id });
		ok(`using ${accounts[0].name}`);
		return accounts[0];
	}

	let chosen = null;
	while (!chosen) {
		const raw = await prompt('Account number', '1');
		const index = Number(raw) - 1;
		chosen = accounts[index];
		if (!chosen) warn('Pick a number from the list.');
	}
	upsertEnvFile(envFile, { CLOUDFLARE_ACCOUNT_ID: chosen.id });
	ok(`using ${chosen.name}`);
	return chosen;
}

async function askDomain() {
	if (args.domain) {
		const domain = normalizeDomain(args.domain);
		if (!isDomain(domain)) throw new Error(`Invalid --domain "${args.domain}".`);
		return domain;
	}
	while (true) {
		const domain = normalizeDomain(await prompt('Mail domain (e.g. example.com)'));
		if (isDomain(domain)) return domain;
		warn('Enter a domain like example.com — no URL, no @.');
	}
}

async function askProvider() {
	if (args.provider) return args.provider;
	if (args.yes) return 'resend';

	log(`  ${c.bold('Mail provider')}`);
	log('    1) Cloudflare Email  — zone already on Cloudflare DNS; Workers paid plan for sending');
	log('    2) Resend            — any DNS host; Resend account');
	while (true) {
		const choice = await prompt('Choice (1/2)', '2');
		if (choice === '1' || choice === 'cloudflare') return 'cloudflare';
		if (choice === '2' || choice === 'resend') return 'resend';
		warn('Enter 1 or 2.');
	}
}

async function askWorkerName(current) {
	const fallback = current && isWorkerName(current) ? current : 'quickmail';
	while (true) {
		const name = (await prompt('Worker name', fallback)).toLowerCase();
		if (isWorkerName(name)) return name;
		warn('Use lowercase letters, numbers, and hyphens.');
	}
}

async function askHostname(domain) {
	const raw = await prompt(`Web UI hostname (blank = workers.dev)`, '');
	if (!raw) return null;
	const host = normalizeDomain(raw.includes('.') ? raw : `${raw}.${domain}`);
	if (!isDomain(host)) {
		warn(`Ignoring invalid hostname "${raw}". Deploying to workers.dev.`);
		return null;
	}
	return host;
}

async function askResourceName(question, fallback, flagValue, validate, invalidHint) {
	if (flagValue) {
		const name = flagValue.trim().toLowerCase();
		if (!validate(name)) throw new Error(`Invalid ${question}: "${flagValue}". ${invalidHint}`);
		return name;
	}
	if (args.yes) return fallback;
	while (true) {
		const raw = await prompt(question);
		const name = (raw || fallback).toLowerCase();
		if (validate(name)) return name;
		warn(invalidHint);
	}
}

function listD1() {
	const result = wrangler(['d1', 'list', '--json'], { allowFail: true });
	const parsed = parseJsonOutput(`${result.stdout}\n${result.stderr}`);
	const rows = Array.isArray(parsed) ? parsed : parsed?.databases ?? parsed?.result ?? [];
	const fromJson = rows
		.map((row) => ({
			name: row.name ?? row.database_name,
			id: row.uuid ?? row.id ?? row.database_id
		}))
		.filter((row) => row.name && row.id);
	if (fromJson.length > 0) return fromJson;

	const table = wrangler(['d1', 'list'], { allowFail: true });
	const text = `${table.stdout}\n${table.stderr}`;
	const found = [];
	for (const line of text.split('\n')) {
		const id = line.match(/\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i)?.[1];
		if (!id) continue;
		const name = line.match(/\b(quickmail|[a-z0-9][a-z0-9-]{1,62})\b/i)?.[1];
		if (name) found.push({ name, id });
	}
	return found;
}

function createD1(name) {
	const result = wrangler(['d1', 'create', name], {
		allowFail: true,
		env: { CI: 'true' }
	});
	const text = `${result.stdout}\n${result.stderr}`;
	const id =
		text.match(/"database_id"\s*:\s*"([^"]+)"/)?.[1] ??
		text.match(/database_id\s*=\s*"([^"]+)"/)?.[1];
	if (result.status === 0 && id) return id;
	if (/already exists/i.test(text)) {
		const existing = listD1().find((row) => row.name === name);
		if (existing) return existing.id;
	}
	throw new Error(text.trim() || `Failed to create D1 database "${name}".`);
}

async function ensureD1(databaseName) {
	const existing = listD1().find((row) => row.name === databaseName);
	if (existing) {
		ok(`reusing D1 ${databaseName} (${existing.id})`);
		return existing.id;
	}

	log(`  ${c.dim(`Creating D1 database ${databaseName}…`)}`);
	const id = createD1(databaseName);
	ok(`D1 ${databaseName} (${id})`);
	return id;
}

function listR2Names() {
	const result = wrangler(['r2', 'bucket', 'list', '--json'], { allowFail: true });
	const parsed = parseJsonOutput(`${result.stdout}\n${result.stderr}`);
	const rows = Array.isArray(parsed) ? parsed : parsed?.buckets ?? parsed?.result ?? [];
	const fromJson = rows
		.map((row) => (typeof row === 'string' ? row : row.name ?? row.Name))
		.filter(Boolean);
	if (fromJson.length > 0) return fromJson;

	const table = wrangler(['r2', 'bucket', 'list'], { allowFail: true });
	const text = `${table.stdout}\n${table.stderr}`;
	const names = [];
	for (const line of text.split('\n')) {
		const match = line.match(/\b([a-z0-9][a-z0-9-]{1,61}[a-z0-9])\b/i);
		if (match && !/^(name|creation|location|id)$/i.test(match[1])) names.push(match[1]);
	}
	return names;
}

function ensureR2(bucketName) {
	if (listR2Names().includes(bucketName)) {
		ok(`reusing R2 bucket ${bucketName}`);
		return;
	}

	log(`  ${c.dim(`Creating R2 bucket ${bucketName}…`)}`);
	const result = wrangler(['r2', 'bucket', 'create', bucketName], {
		allowFail: true,
		env: { CI: 'true' }
	});
	const text = `${result.stdout}\n${result.stderr}`;
	if (result.status === 0 || /already exists/i.test(text)) {
		ok(`R2 bucket ${bucketName}`);
		return;
	}
	throw new Error(text.trim() || `Failed to create R2 bucket "${bucketName}".`);
}

function setPackageMigrateScripts(databaseName) {
	const pkgPath = join(root, 'package.json');
	if (!existsSync(pkgPath)) return;
	const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
	if (!pkg.scripts) return;
	pkg.scripts['db:migrate:local'] = `wrangler d1 migrations apply ${databaseName} --local`;
	pkg.scripts['db:migrate:remote'] = `wrangler d1 migrations apply ${databaseName} --remote`;
	writeFileSync(pkgPath, `${JSON.stringify(pkg, null, '\t')}\n`);
}

function putSecret(name, value) {
	wrangler(['secret', 'put', name], {
		input: value,
		stdio: ['pipe', 'inherit', 'inherit']
	});
	ok(`stored ${name} as a Worker secret`);
}

function wranglerOutputLooksEnabled(text, kind) {
	if (kind === 'sending') {
		return /enabled:\s*yes|status:\s*(enabled|ready)|successfully enabled/i.test(text);
	}
	return /enabled:\s*true|status:\s*ready|successfully enabled/i.test(text);
}

function tryWrangler(wranglerArgs) {
	const result = wrangler(wranglerArgs, { allowFail: true });
	return {
		ok: result.status === 0,
		text: `${result.stdout}\n${result.stderr}`.trim()
	};
}

async function setupCloudflare(domain, workerName, wranglerVer) {
	log(`  ${c.dim('Enabling Email Sending (needs a Workers paid plan)…')}`);
	const sending = tryWrangler(['email', 'sending', 'enable', domain]);
	if (sending.ok) ok(`Email Sending enabled on ${domain}`);
	else {
		warn('Could not enable Email Sending from the CLI.');
		log(`  ${sending.text.split('\n').slice(0, 8).join('\n  ')}`);
		log(
			`  ${c.dim('Dashboard: https://dash.cloudflare.com/?to=/:account/email-service/sending')}`
		);
	}

	log(`  ${c.dim('Enabling Email Routing…')}`);
	const routing = tryWrangler(['email', 'routing', 'enable', domain]);
	if (routing.ok) ok(`Email Routing enabled on ${domain}`);
	else {
		warn('Could not enable Email Routing from the CLI.');
		log(`  ${routing.text.split('\n').slice(0, 8).join('\n  ')}`);
		log(
			`  ${c.dim('Dashboard: https://dash.cloudflare.com/?to=/:account/email-service/routing')}`
		);
	}

	const sendingDns = tryWrangler(['email', 'sending', 'dns', 'get', domain]);
	if (sendingDns.text) {
		log(`\n  ${c.bold('Sending DNS (Cloudflare usually adds these for you)')}`);
		log(
			sendingDns.text
				.split('\n')
				.map((line) => `    ${line}`)
				.join('\n')
		);
	}
	const routingDns = tryWrangler(['email', 'routing', 'dns', 'get', domain]);
	if (routingDns.text) {
		log(`\n  ${c.bold('Routing DNS (apex MX must point at Cloudflare)')}`);
		log(
			routingDns.text
				.split('\n')
				.map((line) => `    ${line}`)
				.join('\n')
		);
	}

	tryWrangler(['email', 'sending', 'list']);
	const settings = tryWrangler(['email', 'routing', 'settings', domain]);
	if (settings.text && wranglerOutputLooksEnabled(settings.text, 'routing')) {
		ok('Email Routing reports enabled');
	}

	return {
		useAddresses: versionGte(wranglerVer, ADDRESSES_WRANGLER),
		workerName
	};
}

async function listResendDomains(apiKey) {
	const response = await fetch('https://api.resend.com/domains?limit=100', {
		headers: { Authorization: `Bearer ${apiKey}` }
	});
	const raw = await response.text();
	const parsed = raw ? parseJsonOutput(raw) : null;
	if (!response.ok) {
		const message = parsed?.message ?? parsed?.error ?? `Resend API ${response.status}`;
		throw new Error(message);
	}
	return parsed?.data ?? [];
}

async function listResendWebhooks(apiKey) {
	const response = await fetch('https://api.resend.com/webhooks', {
		headers: { Authorization: `Bearer ${apiKey}` }
	});
	const raw = await response.text();
	const parsed = raw ? parseJsonOutput(raw) : null;
	if (!response.ok) return [];
	return parsed?.data ?? [];
}

async function createResendWebhook(apiKey, endpoint) {
	const response = await fetch('https://api.resend.com/webhooks', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ endpoint, events: RESEND_WEBHOOK_EVENTS })
	});
	const raw = await response.text();
	const parsed = raw ? parseJsonOutput(raw) : null;
	if (!response.ok) {
		throw new Error(parsed?.message ?? parsed?.error ?? `Resend webhook create failed (${response.status})`);
	}
	return parsed;
}

async function setupResend(domain) {
	log('  Create an API key at https://resend.com/api-keys with send + domains + receiving.');
	log('  Add the domain in Resend (Domains → Add Domain) and copy every DNS record, including apex MX.');

	let apiKey = '';
	if (stdinStream.isTTY && !args.yes) {
		apiKey = await promptSecret('Resend API key (starts with re_, blank to skip)');
	} else {
		warn('Skipped API key prompt. Set RESEND_API_KEY later with wrangler secret put.');
	}

	if (!apiKey) {
		return { apiKey: '', webhookSecret: '', domainOk: false };
	}

	if (!apiKey.startsWith('re_')) {
		warn('That does not look like a Resend key (usually starts with re_). Storing it anyway.');
	}

	putSecret('RESEND_API_KEY', apiKey);

	try {
		const domains = await listResendDomains(apiKey);
		if (domains.length === 0) {
			warn('This key sees no domains yet. Add one in the Resend dashboard before going live.');
			return { apiKey, webhookSecret: '', domainOk: false };
		}
		log('  Resend domains on this key:');
		for (const item of domains) {
			const receiving = item.capabilities?.receiving === 'enabled' ? 'receive on' : 'receive off';
			log(`    • ${item.name}  ${c.dim(`${item.status}, ${receiving}`)}`);
		}
		const match = domains.find((item) => item.name?.toLowerCase() === domain);
		if (!match) {
			warn(`${domain} is not on this Resend account yet. Add it, then finish DNS.`);
			return { apiKey, webhookSecret: '', domainOk: false };
		}
		ok(`${domain} is in Resend (${match.status})`);
		if (match.capabilities?.receiving !== 'enabled') {
			warn('Enable sending and receiving on the domain in Resend or inbound mail will not arrive.');
		}
		return { apiKey, webhookSecret: '', domainOk: match.status === 'verified' };
	} catch (error) {
		warn(`Could not list Resend domains: ${error.message}`);
		return { apiKey, webhookSecret: '', domainOk: false };
	}
}

function migrate(local, remote) {
	const databaseName = jsoncString(readWrangler(), 'database_name') || 'quickmail';
	if (local) {
		wrangler(['d1', 'migrations', 'apply', databaseName, '--local'], { inherit: true });
		ok('local D1 migrations applied');
	}
	if (remote) {
		wrangler(['d1', 'migrations', 'apply', databaseName, '--remote'], { inherit: true });
		ok('remote D1 migrations applied');
	}
}

function parseDeployUrl(text) {
	const workers = text.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/i);
	if (workers) return workers[0];
	const https = text.match(/https:\/\/[a-z0-9.-]+\.[a-z]{2,}[^\s]*/i);
	return https ? https[0].replace(/[).,]+$/, '') : null;
}

function deploy() {
	if (hasBun()) {
		const result = run(bunBin(), ['run', 'deploy'], { inherit: true, allowFail: true });
		return { ok: result.status === 0, text: '' };
	}
	const result = run('npm', ['run', 'deploy'], { inherit: true, allowFail: true });
	return { ok: result.status === 0, text: '' };
}

function deployCaptured() {
	if (hasBun()) {
		const result = run(bunBin(), ['run', 'deploy'], { allowFail: true });
		const text = `${result.stdout}\n${result.stderr}`;
		if (text.trim()) console.log(text);
		return { ok: result.status === 0, text };
	}
	const result = run('npm', ['run', 'deploy'], { allowFail: true });
	const text = `${result.stdout}\n${result.stderr}`;
	if (text.trim()) console.log(text);
	return { ok: result.status === 0, text };
}

async function maybeCreateWebhook(apiKey, publicUrl) {
	if (!apiKey || !publicUrl) return '';
	const endpoint = `${publicUrl.replace(/\/$/, '')}/api/webhooks/resend`;
	const existing = await listResendWebhooks(apiKey);
	const already = existing.find((hook) => hook.endpoint === endpoint);
	if (already) {
		warn(`Resend already has a webhook at ${endpoint}. The signing secret is only shown once — keep the existing RESEND_WEBHOOK_SECRET.`);
		return '';
	}
	if (!(await confirm(`Create Resend webhook at ${endpoint}?`, true))) return '';
	const created = await createResendWebhook(apiKey, endpoint);
	const secret = created?.signing_secret ?? created?.svix_secret ?? '';
	if (!secret) {
		warn('Webhook created but no signing secret in the response. Copy it from the Resend dashboard.');
		return '';
	}
	putSecret('RESEND_WEBHOOK_SECRET', secret);
	log(`  ${c.dim('Signing secret stored. It is not shown again.')}`);
	return secret;
}

function printNextSteps(state) {
	log(`\n${c.bold('Next')}`);
	const app = state.publicUrl ? `${state.publicUrl}/setup` : 'the deployed URL /setup (or http://localhost:5173/setup after bun run dev)';

	if (state.provider === 'cloudflare') {
		if (state.useAddresses && state.deployed) {
			log(`  1. Confirm catch-all: Email Routing → ${state.domain} → Catch-all → Send to a Worker → ${state.workerName}.`);
			log('     Deploy tried to attach `*@' + state.domain + '` via wrangler `addresses`. If mail never arrives, set that catch-all in the dashboard.');
		} else {
			log(`  1. Catch-all → Worker (CLI cannot set this to a Worker on older Wrangler):`);
			log('     https://dash.cloudflare.com/?to=/:account/email-service/routing');
			log(`     Enable Catch-all → Send to a Worker → ${state.workerName}.`);
		}
		log('     The dashboard may ask you to verify a personal destination first. Do not forward production mail there.');
		log(`  2. Open ${app} and create the admin (name, local-part, password).`);
		log('  3. Send yourself a message from another account. Inbound only hits a deployed Worker — not vite dev.');
	} else {
		let n = 1;
		if (!state.resendDomainOk) {
			log(`  ${n++}. In Resend, add ${state.domain} and every DNS record they show, including apex MX. Enable sending and receiving.`);
		}
		if (!state.webhookSecret && state.publicUrl) {
			log(`  ${n++}. Create a webhook at https://resend.com/webhooks → ${state.publicUrl}/api/webhooks/resend`);
			log('     Events: received, sent, delivered, bounced, complained, delivery_delayed, failed.');
			log('     Then: bunx wrangler secret put RESEND_WEBHOOK_SECRET && bun run deploy');
		} else if (!state.publicUrl) {
			log(`  ${n++}. Deploy, then create the Resend webhook pointing at https://<worker>/api/webhooks/resend`);
			log('     Save the signing secret (shown once) and wrangler secret put RESEND_WEBHOOK_SECRET.');
		}
		log(`  ${n++}. Open ${app} and create the admin (name, local-part, password).`);
		log('  Local inbound needs a tunnel (cloudflared) — production uses the public Worker URL.');
	}

	log(`\n  ${c.dim('wrangler.jsonc now has a real D1 id. Do not commit that back to the public template.')}`);
	if (state.publicUrl) log(`\n  ${c.green(state.publicUrl)}`);
}

async function main() {
	if (!stdinStream.isTTY && !args.yes) {
		throw new Error('Non-interactive shells need --yes and --domain. See --help.');
	}
	if (args.yes && !args.domain) {
		throw new Error('--yes requires --domain.');
	}

	log(`\n${c.bold('QuickMail setup')}`);
	log(c.dim('  A mailbox on your domain, on Cloudflare.\n'));

	const total = 8;

	section(1, total, 'Tools');
	await ensureRuntime();
	installDeps();

	section(2, total, 'Cloudflare login');
	await ensureLogin();

	section(3, total, 'Domain and provider');
	const domain = await askDomain();
	ok(domain);
	const provider = await askProvider();
	ok(provider === 'cloudflare' ? 'Cloudflare Email' : 'Resend');

	const wranglerVer = await ensureWrangler(provider === 'cloudflare');

	let source = readWrangler();
	const workerName = await askWorkerName(jsoncString(source, 'name') || 'quickmail');
	const hostname = await askHostname(domain);
	if (hostname) ok(`UI hostname ${hostname}`);

	section(4, total, 'D1 and R2');
	const databaseName = await askResourceName(
		'D1 database name (e.g. quickmail)',
		jsoncString(source, 'database_name') || 'quickmail',
		args.d1Name,
		isWorkerName,
		'Use lowercase letters, numbers, and hyphens.'
	);
	const bucketName = await askResourceName(
		'R2 bucket name (e.g. quickmail-attachments)',
		jsoncString(source, 'bucket_name') || 'quickmail-attachments',
		args.r2Name,
		isR2BucketName,
		'3–63 characters, lowercase letters, numbers, and hyphens.'
	);
	ok(`D1 ${databaseName}`);
	ok(`R2 ${bucketName}`);
	const databaseId = await ensureD1(databaseName);
	ensureR2(bucketName);

	section(5, total, 'Config');
	source = readWrangler();
	source = setFirstString(source, 'name', workerName);
	source = setFirstString(source, 'database_name', databaseName);
	source = setFirstString(source, 'database_id', databaseId);
	source = setFirstString(source, 'bucket_name', bucketName);
	source = setVars(source, {
		provider,
		domains: provider === 'cloudflare' ? domain : ''
	});
	if (hostname) source = setRoutes(source, hostname);
	if (provider === 'cloudflare' && versionGte(wranglerVer, ADDRESSES_WRANGLER)) {
		source = setAddresses(source, [`*@${domain}`]);
	} else {
		source = removeAddresses(source);
	}
	writeWrangler(source);
	ok('updated wrangler.jsonc');
	setPackageMigrateScripts(databaseName);
	if (databaseName !== 'quickmail') ok(`updated package.json migrate scripts for ${databaseName}`);

	const devVars = {
		EMAIL_PROVIDER: provider
	};
	if (provider === 'cloudflare') {
		devVars.CLOUDFLARE_MAIL_DOMAINS = domain;
	}
	upsertEnvFile(devVarsFile, devVars, { fromExample: true });
	ok('updated .dev.vars');

	section(6, total, 'Provider');
	let useAddresses = false;
	let resend = { apiKey: '', webhookSecret: '', domainOk: false };
	if (provider === 'cloudflare') {
		const cf = await setupCloudflare(domain, workerName, wranglerVer);
		useAddresses = cf.useAddresses;
	} else {
		resend = await setupResend(domain);
		if (resend.apiKey) {
			upsertEnvFile(devVarsFile, { RESEND_API_KEY: resend.apiKey });
			ok('wrote RESEND_API_KEY to .dev.vars');
		}
	}

	section(7, total, 'Database');
	migrate(true, false);

	section(8, total, 'Deploy');
	let deployed = false;
	let publicUrl = hostname ? `https://${hostname}` : null;
	const shouldDeploy = args.skipDeploy ? false : await confirm('Deploy now?', true);
	if (shouldDeploy) {
		migrate(false, true);
		const result = deployCaptured();
		deployed = result.ok;
		const parsed = parseDeployUrl(result.text);
		if (parsed) publicUrl = parsed;
		if (deployed) ok('deployed');
		else warn('Deploy failed. Fix the error above, then bun run deploy.');

		if (deployed && provider === 'resend' && resend.apiKey && publicUrl) {
			try {
				const secret = await maybeCreateWebhook(resend.apiKey, publicUrl);
				if (secret) {
					resend.webhookSecret = secret;
					upsertEnvFile(devVarsFile, { RESEND_WEBHOOK_SECRET: secret });
					log(`  ${c.dim('Redeploying so the Worker has RESEND_WEBHOOK_SECRET…')}`);
					const again = deploy();
					if (!again.ok) warn('Second deploy failed. Run bun run deploy after checking the secret.');
				}
			} catch (error) {
				warn(`Webhook setup failed: ${error.message}`);
			}
		}
	} else {
		log(`  ${c.dim('Skipped deploy. bun run db:migrate:remote && bun run deploy when you are ready.')}`);
	}

	printNextSteps({
		provider,
		domain,
		workerName,
		useAddresses,
		deployed,
		publicUrl,
		resendDomainOk: resend.domainOk,
		webhookSecret: resend.webhookSecret
	});
}

try {
	await main();
} catch (error) {
	fail(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
} finally {
	await closeReadline();
}
