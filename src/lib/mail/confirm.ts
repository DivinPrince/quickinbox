import { t } from '$lib/i18n';
import { permanentActionConfirmKey } from './permanent-action';

/** Native confirm for permanent deletion. Every other action continues. */
export function confirmIfPermanent(action: string, count = 1): boolean {
	const key = permanentActionConfirmKey(action, count);
	if (!key) return true;
	return confirm(t(key, count > 1 ? { count } : undefined));
}
