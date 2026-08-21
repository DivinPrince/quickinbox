import { mailDesign } from './mail';
import type { DesignDefinition } from './types';
import { zeroDesign } from './zero';

/**
 * Registered designs, in the order they appear in Settings.
 * Append new entries here — do not special-case them in the shell.
 */
export const DESIGNS: readonly DesignDefinition[] = [mailDesign, zeroDesign];

export const DEFAULT_DESIGN_ID = mailDesign.id;

const byId = new Map(DESIGNS.map((design) => [design.id, design]));

export function isDesignId(value: string | null | undefined): boolean {
	return Boolean(value && byId.has(value));
}

export function getDesign(id: string | null | undefined): DesignDefinition {
	return (id && byId.get(id)) || mailDesign;
}

export function listDesigns(): readonly DesignDefinition[] {
	return DESIGNS;
}
