import { applyDesign, readDesignId, setDesignPreference } from './apply';
import { DEFAULT_DESIGN_ID, getDesign, isDesignId } from './catalog';
import type { DesignDefinition } from './types';

function initialId(): string {
	if (typeof document !== 'undefined') {
		const stamped = document.documentElement.dataset.design;
		if (isDesignId(stamped)) return stamped!;
	}
	return DEFAULT_DESIGN_ID;
}

let designId = $state(initialId());

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
