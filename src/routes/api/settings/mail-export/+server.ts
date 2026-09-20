import { json, type RequestHandler } from '@sveltejs/kit';
import { exportScope, exportZipStream, prepareExport, validateExportPart } from '$lib/server/mail-transfer-export';
import { MailTransferError } from '$lib/mail/transfer';

export const GET: RequestHandler = async ({ url, locals, platform }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (locals.authMethod !== 'session') return json({ error: 'Use a browser session to export mail.' }, { status: 403 });
	if (!platform?.env.DB || !platform.env.ATTACHMENTS) return json({ error: 'Storage unavailable' }, { status: 503 });
	try {
		const { DB: db, ATTACHMENTS: bucket } = platform.env;
		const scope = await exportScope(db, locals.user.id, url.searchParams);
		if (url.searchParams.get('prepare') === 'true') {
			return json({ parts: await prepareExport(db, scope) }, { headers: { 'Cache-Control': 'private, no-store' } });
		}
		const part = await validateExportPart(db, scope, url.searchParams);
		return new Response(exportZipStream(db, bucket, scope, part), { headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename="quickinbox-${scope.folder}-${new Date().toISOString().slice(0, 10)}-${part.through}.zip"`,
			'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'
		} });
	} catch (error) {
		if (error instanceof MailTransferError) return json({ error: error.message }, { status: error.status });
		console.error('Mail export failed', error);
		return json({ error: 'Could not prepare the export. Please try again.' }, { status: 500 });
	}
};
