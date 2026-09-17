import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { decideClassification, persistClassification, shouldNotify } from './classify-policy';

describe('inbound classification policy', () => {
	test('high-confidence phishing is spam and is not notified', () => {
		const decision = decideClassification({
			senderDisposition: null,
			userLockedCategory: null,
			judgments: {
				isSpam: 0.2,
				isPhishing: 0.9,
				category: { choice: 'primary', confidence: 0.9 },
				labels: []
			}
		});
		assert.equal(decision.spam, true);
		assert.equal(decision.notify, false);
		assert.equal(shouldNotify(decision), false);
	});

	test('is_spam at 0.9 is spam; a wanted newsletter score below that is not', () => {
		assert.equal(
			decideClassification({
				senderDisposition: null,
				userLockedCategory: null,
				judgments: {
					isSpam: 0.9,
					isPhishing: 0,
					category: { choice: 'promotions', confidence: 0.9 },
					labels: []
				}
			}).spam,
			true
		);
		assert.equal(
			decideClassification({
				senderDisposition: null,
				userLockedCategory: null,
				judgments: {
					isSpam: 0.89,
					isPhishing: 0,
					category: { choice: 'promotions', confidence: 0.9 },
					labels: []
				}
			}).spam,
			false
		);
	});

	test('low category confidence and missing judgments fail open into Primary and still notify', () => {
		assert.deepEqual(
			decideClassification({
				senderDisposition: null,
				userLockedCategory: null,
				judgments: {
					isSpam: 0.1,
					isPhishing: 0.1,
					category: { choice: 'social', confidence: 0.4 },
					labels: []
				}
			}),
			{
				spam: false,
				notify: true,
				category: 'primary',
				categorySource: null,
				labelIds: []
			}
		);
		assert.deepEqual(
			decideClassification({
				senderDisposition: null,
				userLockedCategory: null,
				judgments: null
			}),
			{
				spam: false,
				notify: true,
				category: 'primary',
				categorySource: null,
				labelIds: []
			}
		);
	});

	test('promotions and social skip notify; updates still ping', () => {
		const promotions = decideClassification({
			senderDisposition: null,
			userLockedCategory: null,
			judgments: {
				isSpam: 0,
				isPhishing: 0,
				category: { choice: 'promotions', confidence: 0.8 },
				labels: []
			}
		});
		assert.equal(promotions.category, 'promotions');
		assert.equal(promotions.notify, false);

		const social = decideClassification({
			senderDisposition: null,
			userLockedCategory: null,
			judgments: {
				isSpam: 0,
				isPhishing: 0,
				category: { choice: 'social', confidence: 0.8 },
				labels: []
			}
		});
		assert.equal(social.notify, false);

		const updates = decideClassification({
			senderDisposition: null,
			userLockedCategory: null,
			judgments: {
				isSpam: 0,
				isPhishing: 0,
				category: { choice: 'updates', confidence: 0.8 },
				labels: []
			}
		});
		assert.equal(updates.notify, true);
	});

	test('blocked senders auto-spam; safe senders never auto-spam', () => {
		assert.equal(
			decideClassification({
				senderDisposition: 'spam',
				userLockedCategory: null,
				judgments: {
					isSpam: 0,
					isPhishing: 0,
					category: { choice: 'primary', confidence: 0.99 },
					labels: []
				}
			}).spam,
			true
		);
		assert.equal(
			decideClassification({
				senderDisposition: 'safe',
				userLockedCategory: null,
				judgments: {
					isSpam: 0.99,
					isPhishing: 0.99,
					category: { choice: 'primary', confidence: 0.99 },
					labels: []
				}
			}).spam,
			false
		);
	});

	test('a user-locked category wins over auto, and custom labels apply at 0.7', () => {
		const decision = decideClassification({
			senderDisposition: null,
			userLockedCategory: 'forums',
			judgments: {
				isSpam: 0,
				isPhishing: 0,
				category: { choice: 'social', confidence: 0.99 },
				labels: [
					{ id: 'work', noul: 0.7 },
					{ id: 'skip', noul: 0.69 }
				]
			}
		});
		assert.equal(decision.category, 'forums');
		assert.equal(decision.categorySource, 'user');
		assert.deepEqual(decision.labelIds, ['work']);
	});

	test('a TypeSafe answer settles low-confidence Primary as auto so backfill can finish', () => {
		const undecided = decideClassification({
			senderDisposition: null,
			userLockedCategory: null,
			judgments: {
				isSpam: 0.1,
				isPhishing: 0.1,
				category: { choice: 'social', confidence: 0.4 },
				labels: []
			}
		});
		assert.equal(undecided.categorySource, null);
		assert.equal(persistClassification(undecided, true).categorySource, 'auto');
		assert.equal(persistClassification(undecided, false).categorySource, null);
	});
});
