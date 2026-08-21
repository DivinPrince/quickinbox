import { DEFAULT_DESIGN_ID, getDesign, isDesignId } from './catalog';

export const DESIGN_STORAGE_KEY = 'mail:design';

export function readDesignId(): string {
	if (typeof localStorage === 'undefined') return DEFAULT_DESIGN_ID;
	const stored = localStorage.getItem(DESIGN_STORAGE_KEY);
	return isDesignId(stored) ? stored! : DEFAULT_DESIGN_ID;
}

/**
 * Stamps the chosen design on <html>. The same thing happens in the inline
 * script in app.html so the first paint is already correct.
 */
export function applyDesign(id: string): void {
	const design = getDesign(id);
	document.documentElement.dataset.design = design.id;
}

export function setDesignPreference(id: string): void {
	const design = getDesign(id);
	localStorage.setItem(DESIGN_STORAGE_KEY, design.id);
	applyDesign(design.id);
}
