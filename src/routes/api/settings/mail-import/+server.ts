import { json, type RequestHandler } from '@sveltejs/kit';
import { importMessage, parseImportOptions, readImportBody } from '$lib/server/mail-import';
import { MailTransferError } from '$lib/mail/transfer';

export const POST: RequestHandler = async ({ request, url, locals, platform }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (locals.authMethod !== 'session') return json({ error: 'Use a browser session to import mail.' }, { status: 403 });
	if (request.headers.get('origin') !== url.origin) return json({ error: 'Invalid request origin.' }, { status: 403 });
	if (!platform?.env.DB || !platform.env.ATTACHMENTS) return json({ error: 'Storage unavailable' }, { status: 503 });
	try {
		const options = parseImportOptions(url.searchParams);
		const raw = await readImportBody(request);
		const result = await importMessage(platform.env.DB, platform.env.ATTACHMENTS, locals.user.id, raw, options);
		return json(result, { headers: { 'Cache-Control': 'private, no-store' } });
	} catch (error) {
		if (error instanceof MailTransferError) return json({ error: error.message }, { status: error.status });
		console.error('Mail import failed', error);
		return json({ error: 'Could not store this message. Retry the import; duplicates will be skipped.' }, { status: 500 });
	}
};
