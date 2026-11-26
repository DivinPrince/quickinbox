/** Copy key for an irreversible mailbox action, or null when no confirm is needed. */
export function permanentActionConfirmKey(action: string, count = 1): string | null {
	if (action === 'delete') {
		return count > 1
			? 'mailbox.deletePermanentlyConfirmPlural'
			: 'mailbox.deletePermanentlyConfirm';
	}
	if (action === 'empty-trash') return 'mailbox.emptyTrashConfirm';
	if (action === 'empty-spam') return 'mailbox.emptySpamConfirm';
	return null;
}
