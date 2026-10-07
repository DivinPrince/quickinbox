/**
 * Encryption for secrets that must be read back, such as the AI provider keys
 * people save in Settings. AES-256-GCM under the ENCRYPTION_KEY Worker secret,
 * so a copy of the database alone never yields a usable key. Each ciphertext is
 * bound to where it is stored (`context`), so it cannot be moved to another row.
 */

const VERSION = 'v1';
const MIN_KEY_LENGTH = 32;

/** A usable ENCRYPTION_KEY, or undefined for a missing, placeholder or short value. */
export function configuredEncryptionKey(value: string | undefined): string | undefined {
	const key = value?.trim() ?? '';
	if (key.length < MIN_KEY_LENGTH || /^REPLACE_WITH_/i.test(key)) return undefined;
	return key;
}

function toBase64Url(bytes: Uint8Array): string {
	return btoa(String.fromCharCode(...bytes))
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
	const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
	const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
	return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function importKey(secret: string): Promise<CryptoKey> {
	const material = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
	return crypto.subtle.importKey('raw', material, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function sealSecret(secret: string, plaintext: string, context: string): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ciphertext = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(context) },
		await importKey(secret),
		new TextEncoder().encode(plaintext)
	);
	return `${VERSION}.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`;
}

/** Throws when the key changed, the value was tampered with, or it belongs elsewhere. */
export async function openSecret(secret: string, sealed: string, context: string): Promise<string> {
	const [version, iv, ciphertext] = sealed.split('.');
	if (version !== VERSION || !iv || !ciphertext) throw new Error('Unrecognised secret format');
	const plaintext = await crypto.subtle.decrypt(
		{
			name: 'AES-GCM',
			iv: fromBase64Url(iv) as BufferSource,
			additionalData: new TextEncoder().encode(context)
		},
		await importKey(secret),
		fromBase64Url(ciphertext) as BufferSource
	);
	return new TextDecoder().decode(plaintext);
}
