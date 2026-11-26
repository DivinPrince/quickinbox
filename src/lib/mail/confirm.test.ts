import assert from 'node:assert/strict';
import { test } from 'node:test';
import { permanentActionConfirmKey } from './permanent-action';

test('permanent deletion asks, and other mailbox actions do not', () => {
	assert.equal(permanentActionConfirmKey('delete'), 'mailbox.deletePermanentlyConfirm');
	assert.equal(permanentActionConfirmKey('delete', 1), 'mailbox.deletePermanentlyConfirm');
	assert.equal(permanentActionConfirmKey('delete', 3), 'mailbox.deletePermanentlyConfirmPlural');
	assert.equal(permanentActionConfirmKey('empty-trash'), 'mailbox.emptyTrashConfirm');
	assert.equal(permanentActionConfirmKey('empty-spam'), 'mailbox.emptySpamConfirm');
	assert.equal(permanentActionConfirmKey('trash'), null);
	assert.equal(permanentActionConfirmKey('restore'), null);
	assert.equal(permanentActionConfirmKey('archive'), null);
});
