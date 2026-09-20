export async function organizerRequest<T = any>(
	url: string,
	method = 'GET',
	body?: unknown
): Promise<T> {
	const response = await fetch(url, {
		method,
		...(body === undefined
			? {}
			: { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
	});
	const data = await response.json().catch(() => null);
	if (!response.ok)
		throw new Error(
			data?.message || data?.error || 'Could not complete the request. Please try again.'
		);
	return data as T;
}
