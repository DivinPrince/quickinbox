import { timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const encoder = new TextEncoder();

export function base32(bytes: Uint8Array): string {
 let bits = 0, value = 0, result = '';
 for (const byte of bytes) {
  value = (value << 8) | byte;
  bits += 8;
  while (bits >= 5) { result += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
 }
 if (bits) result += ALPHABET[(value << (5 - bits)) & 31];
 return result;
}

function unbase32(secret: string): Uint8Array<ArrayBuffer> {
 let bits = 0, value = 0;
 const bytes: number[] = [];
 for (const char of secret) {
  const digit = ALPHABET.indexOf(char);
  if (digit < 0) throw new Error('Invalid authenticator secret');
  value = (value << 5) | digit;
  bits += 5;
  if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
 }
 return new Uint8Array(bytes);
}

/** RFC 6238 / RFC 4226, SHA-1, 30-second steps. Eight digits support RFC test vectors. */
export async function totpCode(secret: string, step: number, digits = 6): Promise<string> {
 const counter = new Uint8Array(8);
 new DataView(counter.buffer).setBigUint64(0, BigInt(step));
 const key = await crypto.subtle.importKey('raw', unbase32(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
 const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, counter));
 const offset = digest[digest.length - 1] & 15;
 const value = new DataView(digest.buffer).getUint32(offset) & 0x7fffffff;
 return String(value % (10 ** digits)).padStart(digits, '0');
}

export async function matchingStep(secret: string, code: string, lastStep: number, now = Date.now()): Promise<number | null> {
 if (!/^\d{6}$/.test(code)) return null;
 const step = Math.floor(now / 30_000);
 for (const candidate of [step, step - 1, step + 1]) {
  if (candidate <= lastStep || candidate < 0) continue;
  if (timingSafeEqual(encoder.encode(await totpCode(secret, candidate)), encoder.encode(code))) return candidate;
 }
 return null;
}

export function encryptionConfigured(value: string | undefined): boolean {
 if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value)) return false;
 try { return atob(value).length === 32; } catch { return false; }
}

async function encryptionKey(value: string | undefined): Promise<CryptoKey> {
 if (!encryptionConfigured(value)) throw new Error('Two-factor encryption key is unavailable');
 return crypto.subtle.importKey('raw', Uint8Array.from(atob(value!), c => c.charCodeAt(0)), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptSecret(secret: string, userId: string, keyValue: string | undefined): Promise<string> {
 const iv = crypto.getRandomValues(new Uint8Array(12));
 const encrypted = new Uint8Array(await crypto.subtle.encrypt(
  { name: 'AES-GCM', iv, additionalData: encoder.encode(`quickinbox:mfa:v1:${userId}`) },
  await encryptionKey(keyValue), encoder.encode(secret)
 ));
 return `v1.${btoa(String.fromCharCode(...iv))}.${btoa(String.fromCharCode(...encrypted))}`;
}

export async function decryptSecret(value: string, userId: string, keyValue: string | undefined): Promise<string> {
 const [version, iv, encrypted, extra] = value.split('.');
 if (version !== 'v1' || !iv || !encrypted || extra) throw new Error('Invalid encrypted authenticator secret');
 const bytes = await crypto.subtle.decrypt({
  name: 'AES-GCM', iv: Uint8Array.from(atob(iv), c => c.charCodeAt(0)),
  additionalData: encoder.encode(`quickinbox:mfa:v1:${userId}`)
 }, await encryptionKey(keyValue), Uint8Array.from(atob(encrypted), c => c.charCodeAt(0)));
 return new TextDecoder().decode(bytes);
}
