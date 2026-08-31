import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { inboundAttachmentMetadata } from './inbound';

describe('inbound attachment metadata', () => {
	test('preserves Resend inline disposition and content id', () => {
		assert.deepEqual(
			inboundAttachmentMetadata({
				disposition: 'inline',
				contentId: 'logo@example.com'
			}),
			{ disposition: 'inline', contentId: 'logo@example.com' }
		);
	});

	test('accepts a parameterized and case-insensitive disposition', () => {
		assert.deepEqual(
			inboundAttachmentMetadata({
				disposition: 'Inline; filename="logo.svg"',
				contentId: ' <logo@example.com> '
			}),
			{ disposition: 'inline', contentId: '<logo@example.com>' }
		);
	});

	test('classifies a related CID part as inline when PostalMime has no disposition', () => {
		assert.deepEqual(
			inboundAttachmentMetadata({ related: true, contentId: 'logo@example.com' }),
			{ disposition: 'inline', contentId: 'logo@example.com' }
		);
	});

	test('preserves an explicit attachment disposition on a related CID part', () => {
		assert.deepEqual(
			inboundAttachmentMetadata({
				disposition: 'attachment',
				related: true,
				contentId: 'download@example.com'
			}),
			{ disposition: 'attachment', contentId: 'download@example.com' }
		);
	});

	test('omits metadata for ordinary attachments', () => {
		assert.deepEqual(inboundAttachmentMetadata({}), {});
		assert.deepEqual(inboundAttachmentMetadata({ disposition: null, contentId: '   ' }), {});
	});
});
