import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	categoryUnread,
	emptyMailboxCounts,
	inboxCategoryPath,
	isQuietCategory,
	mailboxCategoryFilter,
	parseInboxCategory
} from './categories';

test('unknown or missing category values fall back to Primary', () => {
	assert.equal(parseInboxCategory(null), 'primary');
	assert.equal(parseInboxCategory('newsletter'), 'primary');
	assert.equal(parseInboxCategory('social'), 'social');
});

test('inbox search without a tab spans every category', () => {
	assert.equal(mailboxCategoryFilter({ view: 'inbox', q: 'hello' }), null);
	assert.equal(
		mailboxCategoryFilter({ view: 'inbox', categoryParam: 'social', q: 'hello' }),
		'social'
	);
	assert.equal(mailboxCategoryFilter({ view: 'inbox' }), 'primary');
	assert.equal(mailboxCategoryFilter({ view: 'inbox', labelId: 'abc' }), null);
	assert.equal(mailboxCategoryFilter({ view: 'spam' }), null);
});

test('promotions and social are quiet; Primary, Updates, and Forums are not', () => {
	assert.equal(isQuietCategory('promotions'), true);
	assert.equal(isQuietCategory('social'), true);
	assert.equal(isQuietCategory('primary'), false);
	assert.equal(isQuietCategory('updates'), false);
	assert.equal(isQuietCategory('forums'), false);
});

test('inbox tab paths and unread badges stay per category', () => {
	assert.equal(inboxCategoryPath('primary'), '/inbox');
	assert.equal(inboxCategoryPath('social'), '/inbox?category=social');
	const counts = emptyMailboxCounts();
	counts.primary_unread = 2;
	counts.social_unread = 4;
	assert.equal(categoryUnread(counts, 'primary'), 2);
	assert.equal(categoryUnread(counts, 'social'), 4);
});
