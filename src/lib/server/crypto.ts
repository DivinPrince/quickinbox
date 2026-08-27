const PBKDF2_ITERATIONS = 100_000;

function toBase64(bytes: Uint8Array): string {
	return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value: string): Uint8Array {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<ArrayBuffer> {
	const keyMaterial = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(password),
		'PBKDF2',
		false,
		['deriveBits']
	);

	return crypto.subtle.deriveBits(
		{
			name: 'PBKDF2',
			salt: salt as BufferSource,
			iterations: PBKDF2_ITERATIONS,
			hash: 'SHA-256'
		},
		keyMaterial,
		256
	);
}

export async function hashPassword(password: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const hash = new Uint8Array(await deriveKey(password, salt));
	return `${toBase64(salt)}:${toBase64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	const [saltPart, hashPart] = stored.split(':');
	if (!saltPart || !hashPart) return false;

	const salt = fromBase64(saltPart);
	const expected = fromBase64(hashPart);
	const actual = new Uint8Array(await deriveKey(password, salt));

	if (actual.length !== expected.length) return false;

	let mismatch = 0;
	for (let i = 0; i < actual.length; i++) {
		mismatch |= actual[i] ^ expected[i];
	}
	return mismatch === 0;
}

export async function hashToken(token: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
	return toBase64(new Uint8Array(digest));
}

export function createSessionToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return toBase64(bytes);
}
