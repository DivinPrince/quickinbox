import { applyDesign, readDesignId, setDesignPreference } from './apply';
import { DEFAULT_DESIGN_ID, getDesign } from './catalog';
import type { DesignDefinition } from './types';

// Always start at the default so the SSR markup matches the first client
// render. app.html already stamped data-design for CSS; this store catches
// up in hydrateDesign() after mount.
let designId = $state(DEFAULT_DESIGN_ID);

export function getActiveDesignId(): string {
	return designId;
}

export function getActiveDesign(): DesignDefinition {
	return getDesign(designId);
}

export function hydrateDesign(): void {
	designId = readDesignId();
	applyDesign(designId);
}

export function chooseDesign(id: string): void {
	const next = getDesign(id);
	designId = next.id;
	setDesignPreference(next.id);
}
