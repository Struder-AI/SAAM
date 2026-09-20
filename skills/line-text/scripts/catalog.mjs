import {existsSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadStrokeFont} from './strokefont.mjs';
import {requireThat} from '../../../core/geom/tolerance.mjs';

export const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fonts');

const EMS = 'https://gitlab.com/oskay/svg-fonts';
const HERSHEY_TERMS = 'Hershey fonts: free for any use if the acknowledgement carried in the font file is distributed with the data; not the NTIS format.';
const OFL = 'SIL Open Font License 1.1 (derivative of the named Google font)';

// Order breaks ranking ties, so the best-spaced general face is first.
// Editorial fields (tags, summary) are chosen by hand; everything measured lives
// in manifest.json, which `node skills/line-text/scripts/build-manifest.mjs`
// regenerates from the font files.
export const FONTS = Object.freeze([
  {id: 'relief-single-line', file: 'relief/ReliefSingleLineSVG-Regular.svg', source: 'https://github.com/isdat-type/Relief-SingleLine', license: 'SIL Open Font License 1.1', licenseFile: 'relief/OFL.txt',
    tags: ['sans', 'technical', 'label', 'kerned'], summary: 'Modern kerned monoline sans with round bowls; the best-spaced label face.'},
  {id: 'hershey-sans-1', file: 'hershey/HersheySans1.svg', source: EMS, license: HERSHEY_TERMS, licenseFile: null,
    tags: ['sans', 'technical', 'label'], summary: 'Plain one-stroke sans. Roomy counters, so it takes the heaviest strokes of any bundled face.'},
  {id: 'ems-readability', file: 'ems/EMSReadability.svg', source: EMS, license: `${OFL}: Source Sans Pro Light`, licenseFile: 'ems/OFL.txt',
    tags: ['sans', 'readable', 'light'], summary: 'Humanist sans (Source Sans Light). Open forms, good for body-size labels.'},
  {id: 'ems-tech', file: 'ems/EMSTech.svg', source: EMS, license: `${OFL}: Architects Daughter`, licenseFile: 'ems/OFL.txt',
    tags: ['handwriting', 'technical', 'casual'], summary: 'Architect-style hand lettering; unjoined, open counters.'},
  {id: 'ems-casual-hand', file: 'ems/EMSCasualHand.svg', source: EMS, license: `${OFL}: Covered By Your Grace`, licenseFile: 'ems/OFL.txt',
    tags: ['handwriting', 'casual'], summary: 'Loose marker handwriting; unjoined, few strokes per letter.'},
  {id: 'ems-invite', file: 'ems/EMSInvite.svg', source: EMS, license: `${OFL}: Tangerine`, licenseFile: 'ems/OFL.txt',
    tags: ['script', 'formal', 'calligraphic'], summary: 'Slanted calligraphic script with a small x-height and unjoined letters.'},
  {id: 'ems-allure', file: 'ems/EMSAllure.svg', source: EMS, license: `${OFL}: Allura`, licenseFile: 'ems/OFL.txt',
    tags: ['script', 'formal', 'joined', 'signature'], summary: 'Formal joined script (Allura); loops fuse early, so keep strokes light.'},
  {id: 'ems-swiss', file: 'ems/EMSSwiss.svg', source: EMS, license: `${OFL}: Italianno`, licenseFile: 'ems/OFL.txt',
    tags: ['script', 'formal', 'joined', 'italic'], summary: 'Italic joined script (Italianno); the tightest counters of the set.'},
  {id: 'ems-brush', file: 'ems/EMSBrush.svg', source: EMS, license: `${OFL}: Alex Brush`, licenseFile: 'ems/OFL.txt',
    tags: ['script', 'brush', 'signature'], summary: 'Brush-pen script with mostly separate letters.'},
  {id: 'ems-society', file: 'ems/EMSSociety.svg', source: EMS, license: `${OFL}: Mrs Saint Delafield`, licenseFile: 'ems/OFL.txt',
    tags: ['script', 'formal', 'flourish', 'signature'], summary: 'Signature-style flourish script with very tall capitals.'},
  {id: 'hershey-script-1', file: 'hershey/HersheyScript1.svg', source: EMS, license: HERSHEY_TERMS, licenseFile: null,
    tags: ['script', 'joined', 'cursive'], summary: 'Classic engraver cursive; the most consistently joined face.'}
]);

export const fontEntry = id => {
  const entry = FONTS.find(f => f.id === id);
  requireThat(entry, `Unknown line-text font ${JSON.stringify(id)}; choose one of ${FONTS.map(f => f.id).join(', ')}.`);
  return entry;
};

const cache = new Map();
export function loadFont(id) {
  if (!cache.has(id)) cache.set(id, loadStrokeFont(join(FONT_DIR, fontEntry(id).file), {id}));
  return cache.get(id);
}

export function readManifest() {
  const path = join(FONT_DIR, 'manifest.json');
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
}
