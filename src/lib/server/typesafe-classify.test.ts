import assert from 'node:assert/strict';
import { test } from 'node:test';
import { judgmentsFromBatchAnswers, mailBatchPayload, TYPESAFE_MAIL_CHUNK } from './typesafe-classify';

const sample = (from: string, subject: string) => ({
	from,
	fromName: null,
	to: 'you@example.com',
	subject,
	bodyText: 'Hello',
	attachmentNames: [] as string[],
	autoLabels: [] as { id: string; name: string; auto_instructions: string }[]
});

test('mailBatchPayload puts every message in one state with parallel questions', () => {
	const payload = mailBatchPayload([
		sample('a@x.com', 'Hi'),
		sample('b@x.com', 'Sale')
	]);
	assert.equal(Object.keys(payload.state.mail).length, 2);
	assert.equal(payload.questions.m0_spam.type, 'noul');
	assert.equal(payload.questions.m1_cat.type, 'choice');
	assert.equal(Object.keys(payload.questions).length, 6);
});

test('judgmentsFromBatchAnswers maps per-slot TypeSafe answers back to emails', () => {
	const inputs = [sample('a@x.com', 'Hi'), sample('scam@x.com', 'Invoice')];
	const judged = judgmentsFromBatchAnswers(
		{
			m0_spam: { type: 'noul', noul: 0.05 },
			m0_phish: { type: 'noul', noul: 0.02 },
			m0_cat: { type: 'choice', choice: 'primary', confidence: 0.8 },
			m1_spam: { type: 'noul', noul: 0.97 },
			m1_phish: { type: 'noul', noul: 0.4 },
			m1_cat: { type: 'choice', choice: 'promotions', confidence: 0.7 }
		},
		inputs
	);
	assert.equal(judged[0]?.isSpam, 0.05);
	assert.equal(judged[0]?.category?.choice, 'primary');
	assert.equal(judged[1]?.isSpam, 0.97);
});

test('TYPESAFE_MAIL_CHUNK is large enough that 100 emails are a handful of calls', () => {
	assert.equal(Math.ceil(100 / TYPESAFE_MAIL_CHUNK), 4);
});
