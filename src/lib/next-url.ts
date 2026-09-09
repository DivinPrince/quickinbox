/**
 * The only place the login page may send someone after signing in, other than
 * the inbox, is back to an OAuth consent screen they were interrupted on. A
 * tight allow-list keeps `?next=` from becoming an open redirect.
 */
export function safeNextPath(value: string | null | undefined): string | null {
	if (!value || value.length > 4096) return null;
	if (!value.startsWith('/oauth/authorize?')) return null;
	if (/[\s\\]/.test(value)) return null;
	return value;
}

/** Login URL that resumes `path` after signing in (optionally as an added account). */
export function loginHref(path: string, options: { add?: boolean } = {}): string {
	const params = new URLSearchParams();
	if (options.add) params.set('add', '1');
	params.set('next', path);
	return `/login?${params}`;
}
