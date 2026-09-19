/** Keep the same key after a lost response. A changed message is a new request. */
export function createMailSender() {
  let previous = '';
  let key = '';
  return async (url: string, options: RequestInit): Promise<Response> => {
    const identity = `${url}\n${String(options.body ?? '')}`;
    if (identity !== previous || !key) {
      previous = identity;
      key = crypto.randomUUID();
    }
    const headers = new Headers(options.headers);
    headers.set('Idempotency-Key', key);
    const response = await fetch(url, { ...options, headers });
    // A malformed or lost response keeps the key available for another attempt.
    if (response.ok) {
      const result = await response.clone().json() as { ok?: boolean; state?: string };
      if (result.ok) {
        key = '';
        if (typeof window !== 'undefined' && result.state) window.dispatchEvent(new CustomEvent('mail:outbox', { detail: { state: result.state } }));
      }
    }
    return response;
  };
}
