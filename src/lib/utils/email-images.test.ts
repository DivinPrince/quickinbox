import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cssImages, isExternalImage, srcsetImages } from './email-images';

const context = { origin: 'https://mail.example.test', messageId: 'message-1' };

test('embedded and stored attachment images do not claim that remote images were blocked', () => {
	for (const source of ['cid:screenshot', 'data:image/png;base64,AA==', '#local-image', '/api/mail/message-1/attachments/image-1', 'https://mail.example.test/api/mail/message-1/attachments/image-1']) {
		assert.equal(isExternalImage(source, context), false, source);
	}
	for (const source of ['https://sender.example.test/pixel', '//sender.example.test/pixel', '/api/mail/message-2/attachments/image-1', '/tracker.png', 'https://mail.example.test.other.test/api/mail/message-1/attachments/image-1']) {
		assert.equal(isExternalImage(source, context), true, source);
	}
});

test('responsive images preserve data URLs and still detect an external alternative', () => {
	const embedded = 'data:image/png;base64,AA== 1x, /api/mail/message-1/attachments/image-1 2x';
	assert.equal(srcsetImages(embedded).some((source) => isExternalImage(source, context)), false);
	const mixed = `${embedded}, https://sender.example.test/large.png 3x`;
	assert.equal(srcsetImages(mixed).some((source) => isExternalImage(source, context)), true);
	assert.deepEqual(srcsetImages('https://sender.example.test/one, /two 2x'), ['https://sender.example.test/one', '/two']);
});

test('CSS image detection distinguishes embedded images from remote backgrounds and image sets', () => {
	assert.equal(cssImages('background-image: url("data:image/png;base64,AA==")').some((source) => isExternalImage(source, context)), false);
	assert.equal(cssImages('background: image-set(url("data:image/png;base64,AA==") 1x type("image/png"))').some((source) => isExternalImage(source, context)), false);
	for (const css of ['background: url(https://sender.example.test/bg)', 'background: image-set("https://sender.example.test/bg" 1x)', 'background: url("\\68 ttps://sender.example.test/bg")']) {
		assert.equal(cssImages(css).some((source) => isExternalImage(source, context)), true, css);
	}
});
