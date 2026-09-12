import test from 'node:test';
import assert from 'node:assert/strict';
import rhino3dm from 'rhino3dm';
import { patchFromSurface, evaluate } from '../geom/nurbs.mjs';
import { sectionShell, assertClosed } from '../geom/shell.mjs';
import { boxShell, wedgeShell, splineTopShell, splineSideShell, verticalSplineSideShell, shellFromSurfaces } from '../geom/shapes.mjs';
import { topAt } from '../geom/field.mjs';
import { offsetRegion, regionArea, scanlineFill, pointInRegion } from '../region/region2d.mjs';
import { union, intersect, difference, levelSetRegion, levelSetCoverage } from '../region/boolean.mjs';

const rhino = await rhino3dm();
const area = loops => Math.abs(regionArea(loops));
const rectangle = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const circle = (cx, cy, r, n = 240) => Array.from({ length: n }, (_, i) => {
  const t = 2 * Math.PI * i / n;
  return [cx + r * Math.cos(t), cy + r * Math.sin(t)];
});

test('level-set material does not disappear under a linear chord threshold',()=>{
  const field={xs:[0,1],ys:[0,0.0005],values:[[1,1],[-1,-1]]};
  const loops=levelSetRegion(field,0);
  assert.equal(loops.length,1);
  assert.ok(Math.abs(area(loops)-0.00025)<1e-12);
});

test('our NURBS evaluation agrees with rhino3dm on rational and polynomial surfaces', () => {
  const cases = [
    ['sphere', rhino.NurbsSurface.createFromSphere(new rhino.Sphere([1, 2, 3], 5))],
    ['cylinder', rhino.NurbsSurface.createFromCylinder(new rhino.Cylinder(new rhino.Circle(4), 12))],
    ['ruled', rhino.NurbsSurface.createRuledSurface(new rhino.LineCurve([0, 0, 0], [30, 0, 0]), new rhino.LineCurve([0, 20, 4], [30, 20, 9]))]
  ];
  for (const [name, surface] of cases) {
    const patch = patchFromSurface(surface, name);
    for (let i = 0; i <= 6; i++)
      for (let j = 0; j <= 6; j++) {
        const u = patch.domainU[0] + (patch.domainU[1] - patch.domainU[0]) * i / 6;
        const v = patch.domainV[0] + (patch.domainV[1] - patch.domainV[0]) * j / 6;
        const mine = evaluate(patch, u, v);
        const theirs = surface.pointAt(u, v);
        for (let k = 0; k < 3; k++) assert.ok(Math.abs(mine.point[k] - theirs[k]) < 1e-9, `${name} point`);
        if (!mine.normal) continue;
        const normal = surface.normalAt(u, v);
        const agreement = Math.abs(mine.normal.reduce((sum, value, k) => sum + value * normal[k], 0));
        assert.ok(Math.abs(agreement - 1) < 1e-9, `${name} normal`);
      }
  }
});

test('sections of a closed shell match the analytic cross sections', () => {
  const box = boxShell(rhino, { xMm: 30, yMm: 20, zMm: 10 });
  const cut = sectionShell(box, 5);
  assert.equal(cut.loops.length, 1);
  // A planar-sided box needs no subdivision: the section is the rectangle.
  assert.equal(cut.loops[0].length, 4);
  assert.ok(Math.abs(area(cut.loops) - 600) < 1e-6);

  const wedge = wedgeShell(rhino, { runMm: 30, widthMm: 20, baseMm: 2, angleDeg: 15 });
  const slope = Math.tan(15 * Math.PI / 180);
  for (const z of [1, 3, 5, 8]) {
    const expected = z <= 2 ? 600 : (30 - (z - 2) / slope) * 20;
    const section = sectionShell(wedge, z);
    assert.equal(section.openChains.length, 0, `open chain at z=${z}`);
    assert.ok(Math.abs(area(section.loops) - expected) < 1e-4, `wedge area at z=${z}`);
  }
});

test('a curved top surface sections cleanly at every layer', () => {
  const dome = splineTopShell(rhino, { runMm: 24, widthMm: 18, heights: (i, j) => 5 + 2 * Math.sin(i) * Math.cos(j) });
  let layers = 0;
  for (let z = 0.2; z < dome.bounds.max[2]; z += 0.2) {
    const section = sectionShell(dome, z);
    assert.equal(section.openChains.length, 0, `open chain at z=${z.toFixed(2)}`);
    assert.ok(section.loops.every(loop => loop.length >= 3));
    layers++;
  }
  assert.ok(layers > 20);
});

test('a spline-sided shell closes the tapered walls to its domed roof', () => {
  const shell = splineSideShell(rhino, {
    runMm: 24, widthMm: 18, longSideInsetMm: 1.5, shortSideOutsetMm: 2,
    cpU: 4, cpV: 4,
    heights: (i, j) => 5 + Math.sin(Math.PI * i / 3) * Math.sin(Math.PI * j / 3)
  });
  assert.equal(shell.closure.unmatched.length, 0, 'each tapered side shares the roof boundary exactly');
  assert.deepEqual(shell.bounds.min.map(value => Number(value.toFixed(6))), [-2, 0, 0]);
  assert.deepEqual(shell.bounds.max.map(value => Number(value.toFixed(6))), [26, 18, 5.75]);
  assert.ok(shell.patches.some(patch => patch.name === 'front') && shell.patches.some(patch => patch.name === 'left'));
  for (let z = 0.2; z < shell.bounds.max[2]; z += 0.2) {
    const section = sectionShell(shell, z);
    assert.equal(section.openChains.length, 0, `tapered shell section closes at z=${z.toFixed(2)}`);
    assert.ok(section.loops.every(loop => loop.length >= 3));
  }
});

test('a vertically walled spline shell keeps its bulged footprint at every body height', () => {
  const shell = verticalSplineSideShell(rhino, {
    runMm: 24, widthMm: 18, xBulgeMm: 4, yInsetMm: 3, cpU: 4, cpV: 4,
    heights: (i, j) => 6 + 4 * Math.sin(Math.PI * i / 3) * Math.sin(Math.PI * j / 3)
  });
  const top = shell.patches.find(patch => patch.name === 'top');
  const bottom = shell.patches.find(patch => patch.name === 'bottom');
  for (const u of [0.1, 0.5, 0.9])
    for (const v of [0.1, 0.5, 0.9]) {
      const a = evaluate(top, u, v, false).point, b = evaluate(bottom, u, v, false).point;
      assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9, 'roof and base use the same footprint');
    }
  assert.ok(shell.bounds.min[0] < -3 && shell.bounds.max[0] > 27, 'ends bulge out along X');
  const low = sectionShell(shell, 1), high = sectionShell(shell, 5.8);
  assert.ok(Math.abs(area(low.loops) - area(high.loops)) < 1e-4, 'walls stay vertical below the roof');
});

test('an unclosed shell is rejected rather than sliced into open contours', () => {
  const box = boxShell(rhino, { xMm: 20, yMm: 20, zMm: 10 });
  assert.throws(() => assertClosed(shellFromSurfaces(rhino, box.surfaces.slice(0, 5), 'missing-face')), /not closed/);
});

test('a cut flush with a face is displaced below process resolution and reported', () => {
  const box = boxShell(rhino, { xMm: 30, yMm: 20, zMm: 10 });
  const flush = sectionShell(box, 10);
  assert.ok(Math.abs(flush.nudgedByMm) > 0, 'a coincident face must be nudged');
  assert.ok(Math.abs(flush.nudgedByMm) <= 1e-4, 'the displacement stays far below a layer');
  assert.equal(flush.openChains.length, 0);
  assert.ok(Math.abs(area(flush.loops) - 600) < 1e-3);
});

test('inward offsets match analytic areas and collapse to nothing when they must', () => {
  assert.ok(Math.abs(area(offsetRegion([rectangle(0, 0, 30, 20)], -0.2)) - 29.6 * 19.6) < 1e-6);
  assert.ok(Math.abs(area(offsetRegion([rectangle(0, 0, 30, 20)], -2)) - 26 * 16) < 1e-6);
  assert.ok(Math.abs(area(offsetRegion([circle(0, 0, 10)], -2)) - Math.PI * 64) < 0.2);
  assert.equal(offsetRegion([rectangle(0, 0, 30, 20)], -12).length, 0, 'an over-wide offset leaves nothing');
  const holed = [rectangle(0, 0, 30, 20), circle(15, 10, 4).reverse()];
  // The hole grows as the outline shrinks.
  assert.ok(Math.abs(area(offsetRegion(holed, -1)) - (28 * 18 - Math.PI * 25)) < 0.2);
});

test('every offset point keeps its standoff from the original boundary', () => {
  const source = [circle(0, 0, 12, 300)];
  const offset = offsetRegion(source, -1.5);
  for (const loop of offset)
    for (const point of loop) {
      const radius = Math.hypot(point[0], point[1]);
      assert.ok(radius <= 12 - 1.5 + 1e-3 && radius >= 12 - 1.5 - 0.05, `point at radius ${radius}`);
    }
});

test('regions combine at layer level instead of as solids', () => {
  const a = [rectangle(0, 0, 20, 20)], b = [rectangle(10, 10, 20, 20)];
  assert.ok(Math.abs(area(union(a, b)) - 700) < 1e-6);
  assert.ok(Math.abs(area(intersect(a, b)) - 100) < 1e-6);
  assert.ok(Math.abs(area(difference(a, b)) - 300) < 1e-6);
  // A circle cut out of a rectangle leaves a hole, not a notch.
  const holed = difference([rectangle(0, 0, 40, 20)], [circle(20, 10, 8)]);
  assert.ok(Math.abs(area(holed) - (800 - Math.PI * 64)) < 0.2);
  assert.ok(!pointInRegion([20, 10], holed), 'the cut-out interior is outside the result');
  assert.equal(area(intersect([rectangle(0, 0, 10, 10)], [rectangle(50, 50, 10, 10)])), 0);
});

test('a level set reports covering everything or nothing rather than returning no loops', () => {
  const xs = [], ys = [], values = [];
  for (let i = 0; i <= 40; i++) xs.push(i);
  for (let j = 0; j <= 40; j++) ys.push(j);
  for (let i = 0; i <= 40; i++) { values.push([]); for (let j = 0; j <= 40; j++) values[i][j] = 20 - Math.hypot(xs[i] - 20, ys[j] - 20); }
  assert.equal(levelSetCoverage({ xs, ys, values }, 25), 'none');
  assert.equal(levelSetCoverage({ xs, ys, values }, -100), 'all');
  assert.equal(levelSetCoverage({ xs, ys, values }, 10), 'partial');
  assert.ok(Math.abs(area(levelSetRegion({ xs, ys, values }, 10)) - Math.PI * 100) < 1);
});

test('the top surface height field is exact on a known slope', () => {
  const wedge = wedgeShell(rhino, { runMm: 30, widthMm: 20, baseMm: 2, angleDeg: 15 });
  const slope = Math.tan(15 * Math.PI / 180);
  for (let x = 1; x < 30; x += 3)
    for (let y = 1; y < 20; y += 3) {
      const top = topAt(wedge, x, y);
      assert.ok(Math.abs(top.zMm - (2 + x * slope)) < 1e-9, 'height');
      assert.ok(Math.abs(top.slopeDeg - 15) < 1e-9, 'slope');
    }
  assert.equal(topAt(wedge, 50, 10), null, 'outside the footprint there is no top surface');
});

test('scanline fill covers the region it is given', () => {
  const rows = scanlineFill([rectangle(0, 0, 30, 20)], 0.4, 45);
  const covered = rows.reduce((total, row) => total + row.lengthMm, 0) * 0.4;
  assert.ok(covered > 570 && covered < 630, `covered ${covered}`);
  const holed = [rectangle(0, 0, 30, 20), circle(15, 10, 4, 120).reverse()];
  const throughHole = scanlineFill(holed, 0.4, 0).some(row =>
    Math.abs(row.from[1] - 10) < 0.3 && row.from[0] < 15 && row.to[0] > 15);
  assert.ok(!throughHole, 'fill does not cross a hole');
});

test('scanline fill completes disconnected components before crossing a gap', () => {
  const rows = scanlineFill([rectangle(0, 0, 8, 8), rectangle(20, 0, 8, 8)], 1, 0);
  const sides = rows.map(row => row.from[0] < 10 ? 'left' : 'right');
  const firstRight = sides.indexOf('right');
  assert.ok(firstRight > 0, 'both disconnected components receive fill rows');
  assert.ok(sides.slice(0, firstRight).every(side => side === 'left'), 'left component is completed first');
  assert.ok(sides.slice(firstRight).every(side => side === 'right'), 'right component starts after the left');
});
