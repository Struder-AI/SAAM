import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {FONT_DIR, FONTS, loadFont} from './catalog.mjs';
import {measureFont} from './measure.mjs';

// Regenerate fonts/manifest.json: the catalog's editorial fields joined to what is
// measured from each font file. Run after adding or changing a font.
const fonts = FONTS.map(entry => ({
  id: entry.id, file: entry.file, source: entry.source, license: entry.license, licenseFile: entry.licenseFile,
  tags: entry.tags, summary: entry.summary, measured: measureFont(loadFont(entry.id))
}));
writeFileSync(join(FONT_DIR, 'manifest.json'), JSON.stringify({version: 1, fonts}, null, 2) + '\n');
console.log(`Wrote ${fonts.length} fonts to ${join(FONT_DIR, 'manifest.json')}`);
