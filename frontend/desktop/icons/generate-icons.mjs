/**
 * Regenerates icon.png and icon.ico from icon.svg.
 *
 * Icons are committed pre-generated (see commit bc23acf — CI no longer
 * generates them), so run this locally whenever icon.svg changes:
 *
 *   cd frontend/desktop && node icons/generate-icons.mjs
 *
 * Requires the desktop devDependencies (sharp, png-to-ico).
 */
import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(join(dir, 'icon.svg'));

// PNG (used on Linux/macOS builds and as the canonical raster source).
await sharp(svg).resize(256, 256).png().toFile(join(dir, 'icon.png'));

// ICO (Windows .exe / taskbar) — multiple sizes so each context picks a crisp one.
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const pngBuffers = await Promise.all(
  ICO_SIZES.map((size) => sharp(svg).resize(size, size).png().toBuffer())
);
writeFileSync(join(dir, 'icon.ico'), await pngToIco(pngBuffers));

console.log(`Generated icon.png (256) and icon.ico (${ICO_SIZES.join(', ')}).`);
