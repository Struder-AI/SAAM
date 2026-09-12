import test from 'node:test';
import assert from 'node:assert/strict';
import { perimeterLoops } from '../region/perimeters.mjs';
import { offsetRegion } from '../region/offset.mjs';
import { loopArea } from '../region/region2d.mjs';

const circle = (r, x = 0, count = 256) => Array.from({ length: count }, (_, i) => {
  const a = 2 * Math.PI * i / count;
  return [x + r * Math.cos(a), r * Math.sin(a)];
});
const ring = thickness => [circle(10 + thickness), circle(10).reverse()];

test('opposed fronts meeting in a closed wall retain one central deposition loop', () => {
  const region = ring(2);
  const loops = [0.2, 0.6, 1].flatMap(d => perimeterLoops(region, d));
  assert.equal(loops.length, 5);
  const radii = loops.map(loop => loop.reduce((s, p) => s + Math.hypot(...p), 0) / loop.length).sort((a, b) => a - b);
  for (let i = 0; i < 5; i++) assert.ok(Math.abs(radii[i] - (10.2 + 0.4 * i)) < 0.002);
  assert.deepEqual(perimeterLoops(region, 1.4), [], 'higher settings stop at the available wall');
  // Polygonal circles and integer rounding can retain small material remnants
  // where the ideal circular fronts meet. Keep the kernel's region result;
  // central-track recovery, above, owns the single deposition contour.
  const remnants = offsetRegion(region, -1);
  assert.ok(remnants.reduce((area, loop) => area + Math.abs(loopArea(loop)), 0) < 0.002);
  assert.ok(remnants.flat().every(p => Math.abs(Math.hypot(...p) - 11) < 0.002));
  assert.deepEqual(offsetRegion(region, -1.002), [], 'erosion beyond the construction tolerance collapses');
});

test('even bead counts and wider or uneven walls retain ordinary contours', () => {
  for (const region of [ring(1.6), ring(2.4), [circle(12), circle(10, 0.1).reverse()]]) {
    for (const d of [0.2, 0.6, 1, 1.4]) assert.deepEqual(perimeterLoops(region, d), offsetRegion(region, -d));
  }
});

test('central-loop recovery preserves disconnected and nested material islands', () => {
  const region = [...ring(2), circle(3), circle(3, 20)];
  const loops = perimeterLoops(region, 1);
  assert.equal(loops.length, 3);
  assert.ok(loops.every(loop => loopArea(loop) > 0));
  const areas = loops.map(loop => loopArea(loop)).sort((a, b) => a - b);
  assert.ok(Math.abs(areas[0] - Math.PI * 4) < 0.01);
  assert.ok(Math.abs(areas[1] - Math.PI * 4) < 0.01);
});

test('an additional hole cutting the central track prevents a fabricated closed loop', () => {
  const loops = perimeterLoops([...ring(2), circle(0.2, 11).reverse()], 1);
  assert.ok(loops.every(loop => Math.abs(loopArea(loop)) < 10));
});
