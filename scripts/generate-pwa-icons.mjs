import { deflateSync, inflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLEAR = [0, 0, 0, 0];
const BLACK = [0, 0, 0, 255];
const LIGHT_BG = [250, 250, 250, 255];
const DARK_BG = [14, 14, 16, 255];

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = join(root, 'src/lib/assets/logo.png');
const outDir = join(root, 'static/icons');

const crcTable = (() => {
	const table = new Uint32Array(256);
	for (let i = 0; i < 256; i += 1) {
		let value = i;
		for (let bit = 0; bit < 8; bit += 1) {
			value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
		}
		table[i] = value >>> 0;
	}
	return table;
})();

function crc32(buffer) {
	let crc = 0xffffffff;
	for (const byte of buffer) {
		crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
	const header = Buffer.from(type);
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([header, data])));
	return Buffer.concat([length, header, data, crc]);
}

function encodePng(width, height, paint) {
	const raw = Buffer.alloc((width * 4 + 1) * height);
	for (let y = 0; y < height; y += 1) {
		const row = y * (width * 4 + 1);
		raw[row] = 0;
		for (let x = 0; x < width; x += 1) {
			const [r, g, b, a] = paint(x, y, width, height);
			const i = row + 1 + x * 4;
			raw[i] = r;
			raw[i + 1] = g;
			raw[i + 2] = b;
			raw[i + 3] = a;
		}
	}

	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	ihdr[9] = 6;

	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(raw, { level: 9 })),
		chunk('IEND', Buffer.alloc(0))
	]);
}

function paeth(a, b, c) {
	const p = a + b - c;
	const pa = Math.abs(p - a);
	const pb = Math.abs(p - b);
	const pc = Math.abs(p - c);
	if (pa <= pb && pa <= pc) return a;
	if (pb <= pc) return b;
	return c;
}

function decodePng(buffer) {
	if (buffer.subarray(0, 8).toString('binary') !== '\x89PNG\r\n\x1a\n') {
		throw new Error('logo.png is not a PNG');
	}

	let offset = 8;
	let width = 0;
	let height = 0;
	let bitDepth = 0;
	let colorType = 0;
	let interlace = 0;
	const idat = [];

	while (offset < buffer.length) {
		const length = buffer.readUInt32BE(offset);
		const type = buffer.toString('ascii', offset + 4, offset + 8);
		const data = buffer.subarray(offset + 8, offset + 8 + length);
		if (type === 'IHDR') {
			width = data.readUInt32BE(0);
			height = data.readUInt32BE(4);
			bitDepth = data[8];
			colorType = data[9];
			interlace = data[12];
		} else if (type === 'IDAT') {
			idat.push(data);
		} else if (type === 'IEND') {
			break;
		}
		offset += 12 + length;
	}

	if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
		throw new Error(`Unsupported PNG: depth=${bitDepth} color=${colorType} interlace=${interlace}`);
	}

	const channels = colorType === 6 ? 4 : 3;
	const stride = width * channels;
	const inflated = inflateSync(Buffer.concat(idat));
	const pixels = new Uint8ClampedArray(width * height * 4);
	const prev = Buffer.alloc(stride);

	let src = 0;
	for (let y = 0; y < height; y += 1) {
		const filter = inflated[src];
		src += 1;
		const row = inflated.subarray(src, src + stride);
		src += stride;
		const recon = Buffer.alloc(stride);

		for (let i = 0; i < stride; i += 1) {
			const left = i >= channels ? recon[i - channels] : 0;
			const up = prev[i];
			const upLeft = i >= channels ? prev[i - channels] : 0;
			const x = row[i];
			switch (filter) {
				case 0:
					recon[i] = x;
					break;
				case 1:
					recon[i] = (x + left) & 255;
					break;
				case 2:
					recon[i] = (x + up) & 255;
					break;
				case 3:
					recon[i] = (x + ((left + up) >> 1)) & 255;
					break;
				case 4:
					recon[i] = (x + paeth(left, up, upLeft)) & 255;
					break;
				default:
					throw new Error(`Unsupported PNG filter ${filter}`);
			}
		}

		for (let x = 0; x < width; x += 1) {
			const si = x * channels;
			const di = (y * width + x) * 4;
			pixels[di] = recon[si];
			pixels[di + 1] = recon[si + 1];
			pixels[di + 2] = recon[si + 2];
			pixels[di + 3] = channels === 4 ? recon[si + 3] : 255;
		}

		recon.copy(prev);
	}

	return { width, height, pixels };
}

function sampleBilinear(image, fx, fy) {
	const x = Math.min(Math.max(fx, 0), image.width - 1);
	const y = Math.min(Math.max(fy, 0), image.height - 1);
	const x0 = Math.floor(x);
	const y0 = Math.floor(y);
	const x1 = Math.min(x0 + 1, image.width - 1);
	const y1 = Math.min(y0 + 1, image.height - 1);
	const tx = x - x0;
	const ty = y - y0;

	const mix = (a, b, t) => a + (b - a) * t;
	const at = (ix, iy) => {
		const i = (iy * image.width + ix) * 4;
		return [image.pixels[i], image.pixels[i + 1], image.pixels[i + 2], image.pixels[i + 3]];
	};

	const p00 = at(x0, y0);
	const p10 = at(x1, y0);
	const p01 = at(x0, y1);
	const p11 = at(x1, y1);
	return [
		Math.round(mix(mix(p00[0], p10[0], tx), mix(p01[0], p11[0], tx), ty)),
		Math.round(mix(mix(p00[1], p10[1], tx), mix(p01[1], p11[1], tx), ty)),
		Math.round(mix(mix(p00[2], p10[2], tx), mix(p01[2], p11[2], tx), ty)),
		Math.round(mix(mix(p00[3], p10[3], tx), mix(p01[3], p11[3], tx), ty))
	];
}

function distToRoundedRect(x, y, size, radius) {
	const dx = Math.abs(x - (size - 1) / 2) - (size / 2 - radius);
	const dy = Math.abs(y - (size - 1) / 2) - (size / 2 - radius);
	const ox = Math.max(dx, 0);
	const oy = Math.max(dy, 0);
	return Math.hypot(ox, oy) + Math.min(Math.max(dx, dy), 0) - radius;
}

function lerpColor(a, b, t) {
	return [
		Math.round(a[0] + (b[0] - a[0]) * t),
		Math.round(a[1] + (b[1] - a[1]) * t),
		Math.round(a[2] + (b[2] - a[2]) * t),
		Math.round(a[3] + (b[3] - a[3]) * t)
	];
}

function paintCover(image, x, y, size, { round = false, pad = 0, outside = CLEAR } = {}) {
	if (round) {
		const edge = distToRoundedRect(x + 0.5, y + 0.5, size, size * 0.26);
		if (edge > 0.6) return outside;
		const u = x / (size - 1);
		const v = y / (size - 1);
		const pixel = sampleBilinear(image, u * (image.width - 1), v * (image.height - 1));
		if (edge > -0.6) return lerpColor(outside, pixel, 1 - (edge + 0.6) / 1.2);
		return pixel;
	}

	const nx = x / (size - 1);
	const ny = y / (size - 1);
	const u = pad === 0 ? nx : (nx - pad) / (1 - pad * 2);
	const v = pad === 0 ? ny : (ny - pad) / (1 - pad * 2);
	if (u < 0 || u > 1 || v < 0 || v > 1) return outside;
	return sampleBilinear(image, u * (image.width - 1), v * (image.height - 1));
}

function paintSplash(image, bg) {
	return (x, y, width, height) => {
		const mark = Math.round(Math.min(width, height) * 0.16);
		const left = (width - mark) / 2;
		const top = (height - mark) / 2;
		const lx = x - left;
		const ly = y - top;
		if (lx < -1 || ly < -1 || lx >= mark + 1 || ly >= mark + 1) return bg;
		return paintCover(image, lx, ly, mark, { round: true, outside: bg });
	};
}

function writeFaviconSvg(imagePng, dest) {
	const href = `data:image/png;base64,${imagePng.toString('base64')}`;
	writeFileSync(
		dest,
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="Quickinbox">
	<defs>
		<clipPath id="tile"><rect width="64" height="64" rx="16.5" /></clipPath>
	</defs>
	<image href="${href}" width="64" height="64" clip-path="url(#tile)" />
</svg>
`
	);
}

const logo = decodePng(readFileSync(sourcePath));
mkdirSync(outDir, { recursive: true });

writeFileSync(
	join(outDir, 'icon-192.png'),
	encodePng(192, 192, (x, y, size) => paintCover(logo, x, y, size, { round: true }))
);
writeFileSync(
	join(outDir, 'icon-512.png'),
	encodePng(512, 512, (x, y, size) => paintCover(logo, x, y, size, { round: true }))
);
writeFileSync(
	join(outDir, 'apple-touch-icon.png'),
	encodePng(180, 180, (x, y, size) => paintCover(logo, x, y, size, { outside: BLACK }))
);
writeFileSync(
	join(outDir, 'icon-maskable-512.png'),
	encodePng(512, 512, (x, y, size) => paintCover(logo, x, y, size, { pad: 0.1, outside: BLACK }))
);

const splashes = [
	[1170, 2532],
	[1179, 2556],
	[1290, 2796]
];

for (const [width, height] of splashes) {
	writeFileSync(join(outDir, `splash-${width}x${height}.png`), encodePng(width, height, paintSplash(logo, LIGHT_BG)));
	writeFileSync(
		join(outDir, `splash-${width}x${height}-dark.png`),
		encodePng(width, height, paintSplash(logo, DARK_BG))
	);
}

const sourcePng = readFileSync(sourcePath);
writeFaviconSvg(sourcePng, join(root, 'static/favicon.svg'));

console.log('Wrote PWA icons and iOS splash screens to static/icons');
