/**
 * A composer keeps its Idempotency-Key until a send succeeds, so retrying after
 * a lost response can never email twice. After these answers, retrying under
 * that key can only fail again: the first attempt may or may not have gone out,
 * or the message was edited since. Only the person can decide to send it as a
 * new message, which takes a new key.
 */
export function needsNewSendKey(code: unknown): boolean {
	return code === 'send_outcome_unknown' || code === 'idempotency_conflict';
}
