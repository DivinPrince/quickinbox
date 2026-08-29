import fs from 'node:fs';
import path from 'node:path';

const source = '/Users/macbook/Projects/Zero/components/icons/icons.tsx';
const destDir = path.resolve('src/themes/zero/icons');

const src = fs.readFileSync(source, 'utf8');
const re = /export const (\w+) = \([^)]*\) => \(\s*(<svg[\s\S]*?<\/svg>)\s*\);/g;

const icons = [];
let match;
while ((match = re.exec(src))) {
	const name = match[1];
	let svg = match[2]
		.replaceAll('className={className}', 'class={className}')
		.replaceAll('className=', 'class=')
		.replaceAll('fillRule=', 'fill-rule=')
		.replaceAll('clipRule=', 'clip-rule=')
		.replaceAll('clipPath=', 'clip-path=')
		.replaceAll('strokeWidth=', 'stroke-width=')
		.replaceAll('strokeLinecap=', 'stroke-linecap=')
		.replaceAll('strokeLinejoin=', 'stroke-linejoin=')
		.replaceAll('fillOpacity=', 'fill-opacity=')
		.replaceAll('strokeOpacity=', 'stroke-opacity=')
		.replaceAll('colorInterpolationFilters=', 'color-interpolation-filters=')
		.replace(/style=\{\{\s*stopColor:\s*'([^']+)'\s*\}\}/g, 'stop-color="$1"')
		.replace(/\s*mask-type="[^"]*"/g, '')
		.replaceAll('xmlns="http://www.w3.org/2000/svg"', 'xmlns="http://www.w3.org/2000/svg"');
	icons.push({ name, svg });
}

fs.mkdirSync(destDir, { recursive: true });

const names = icons.map((icon) => icon.name);
const catalog = `<!-- Generated from Zero/components/icons/icons.tsx. Do not edit by hand. -->
<script lang="ts">
	let {
		name,
		class: className = '',
		size = 16
	}: {
		name: string;
		class?: string;
		size?: number;
	} = $props();
</script>

<span class="z-icon {className}" style="width: {size}px; height: {size}px;" data-name={name}>
{#if false}
${icons
	.map(
		(icon) => `{:else if name === '${icon.name}'}
	${icon.svg}`
	)
	.join('\n')}
{/if}
</span>

<style>
	.z-icon {
		display: inline-flex;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		line-height: 0;
		color: var(--icon-color);
	}

	.z-icon :global(svg) {
		width: 100%;
		height: 100%;
		display: block;
	}

	/* Native Zero SVGs often leave paths unfilled (fill="none" on the root). */
	.z-icon :global(path:not([fill]):not([stroke])) {
		fill: currentColor;
	}
</style>
`;

fs.writeFileSync(path.join(destDir, 'Icon.svelte'), catalog);
fs.writeFileSync(
	path.join(destDir, 'names.ts'),
	`export const ZERO_ICON_NAMES = ${JSON.stringify(names, null, '\t')} as const;\nexport type ZeroIconName = (typeof ZERO_ICON_NAMES)[number];\n`
);

console.log(`converted ${icons.length} icons`);
