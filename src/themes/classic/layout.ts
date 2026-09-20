import type { SplitLayout } from '$lib/components/SplitLayoutPicker.svelte';

/** Each Classic shell owns its preference; the toolbar and mailbox share it. */
export const CLASSIC_LAYOUT = Symbol('classic-layout');
export type ClassicLayoutContext = { readonly value: SplitLayout };
