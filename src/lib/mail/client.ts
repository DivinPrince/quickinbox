export type MailActionNotice = { action: string; undoId?: string | null; error?: string; retry?: () => Promise<unknown> };
function notify(detail: MailActionNotice) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('mail:action', { detail }));
}
export async function runMailAction(action: string, ids: string[] = [], extra: Record<string, unknown> = {}): Promise<{ ok: boolean; affected?: number }> {
  const input = { ...extra, requestId: extra.requestId ?? crypto.randomUUID() };
  try {
    const response = await fetch('/api/mail/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ids, ...input }) });
    const body = await response.json() as { ok?: boolean; affected?: number; undoId?: string; error?: string };
    if (!response.ok || !body.ok) throw new Error(body.error ?? 'Could not update mail');
    if (body.undoId) notify({ action, undoId: body.undoId });
    return { ok: true, affected: body.affected };
  } catch (error) {
    notify({ action, error: error instanceof Error ? error.message : 'Could not update mail', retry: () => runMailAction(action, ids, input) });
    throw error;
  }
}

export async function patchThread(
	id: string,
	flags: Record<string, boolean | string>
): Promise<void> {
	const response = await fetch(`/api/mail/${id}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(flags)
	});
	if (!response.ok) {
		const body = (await response.json()) as { error?: string };
		throw new Error(body.error ?? 'Could not update this conversation');
	}
}
