import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('busy indicator retains slower continuous feedback with reduced motion',async()=>{
  const css=await readFile(new URL('../../studio/style.css',import.meta.url),'utf8');
  const base=css.match(/(?:^|\})\s*\.spinner\s*\{([^}]*)\}/)?.[1];
  const reduced=css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.spinner\s*\{([^}]*)\}/)?.[1];
  assert.ok(base&&reduced,'spinner has both normal and reduced-motion styling');
  const animation=base.match(/(?:^|;)\s*animation\s*:\s*([^;]+)/)?.[1];
  assert.match(animation??'',/\bspin\b/);assert.match(animation??'',/\binfinite\b/);
  const regularSeconds=Number(animation.match(/\s(\d*\.?\d+)s\b/)?.[1]);
  const reducedSeconds=Number(reduced.match(/animation-duration\s*:\s*([\d.]+)s\b/)?.[1]);
  assert.ok(regularSeconds>0&&reducedSeconds>regularSeconds,'reduced motion slows the essential busy indicator');
  assert.doesNotMatch(reduced,/(?:animation\s*:\s*none|animation-play-state\s*:\s*paused|animation-iteration-count\s*:\s*0)/,
    'updating progress must not leave an apparently frozen busy indicator');
});
