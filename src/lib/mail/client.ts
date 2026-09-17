export async function runMailAction(
	action: string,
	ids: string[] = [],
	extra: Record<string, unknown> = {}
): Promise<{ ok: boolean; affected?: number; error?: string }> {
	const response = await fetch('/api/mail/actions', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action, ids, ...extra })
	});
	const body = (await response.json()) as { ok?: boolean; affected?: number; error?: string };
	if (!response.ok) {
		throw new Error(body.error ?? 'Could not update mail');
	}
	return { ok: true, affected: body.affected };
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
