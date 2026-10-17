import fs from 'node:fs';
import path from 'node:path';

// Hand-authored metaball control points. This computes SAAM inputs only;
// SAAM constructs, samples, validates and publishes the actual geometry.
const points = [];
const add = (x, y, z, reachMm, strength = 1) =>
  points.push({ positionMm: [x, y, z], reachMm, strength });

// Broad domed head, buried beneath the bed to leave a flat back.
add(0, 0, -29, 84);
// Round teddy ears, joined generously to the head.
add(-25, 25, -7, 28);
add(25, 25, -7, 28);
// Soft cheeks and a twin-lobed muzzle.
add(-16, -8, 3.5, 20, 0.32);
add(16, -8, 3.5, 20, 0.32);
add(-5, -10, 12, 16, 0.7);
add(5, -10, 12, 16, 0.7);

const kernel = r => r >= 1 ? 0 : r < 0.5
  ? 1 - 6 * r * r + 6 * r * r * r : 2 * (1 - r) ** 3;
const value = (x, y, z, controls) => controls.reduce((sum, p) => sum +
  p.strength * kernel(Math.hypot(x - p.positionMm[0], y - p.positionMm[1],
    z - p.positionMm[2]) / p.reachMm), 0);
const top = (x, y, controls = points) => {
  for (let z = 40; z >= 0; z -= 0.025) {
    if (value(x, y, z, controls) >= 0.25) return Number(z.toFixed(3));
  }
  throw new Error(`No body at ${x}, ${y}`);
};

// Rounded triangular button nose, embedded into the muzzle.
const noseBase = top(0, -7);
add(-1.6, -6.3, noseBase + 0.9, 6.8, 0.65);
add(1.6, -6.3, noseBase + 0.9, 6.8, 0.65);
add(0, -8.1, noseBase + 0.6, 5.2, 0.45);

const positive = structuredClone(points);
const recess = (x, y, offset, reach, strength) =>
  add(x, y, top(x, y, positive) + offset, reach, -strength);
// Shallow inner-ear bowls preserve a thick, continuous back.
recess(-25.6, 26.3, 2.5, 13, 0.75);
recess(25.6, 26.3, 2.5, 13, 0.75);
// Two round expressive eye dimples.
recess(-11.8, 6.3, 1.5, 6.6, 1.05);
recess(11.8, 6.3, 1.5, 6.6, 1.05);

// A short philtrum and two softly rising smile arms. Carving centers follow
// the authored muzzle surface; a broad groove survives a 0.4 mm nozzle.
const smile = [
  [0, -10.7], [0, -11.5], [0, -12.3], [0, -13.1],
  [-0.8, -13.7], [-1.6, -14.15], [-2.4, -14.45],
  [-3.2, -14.55], [-4, -14.45], [-4.8, -14.15],
  [-5.6, -13.7], [-6.25, -13.05],
  [0.8, -13.7], [1.6, -14.15], [2.4, -14.45],
  [3.2, -14.55], [4, -14.45], [4.8, -14.15],
  [5.6, -13.7], [6.25, -13.05],
];
for (const [x, y] of smile) recess(x, y, 0.65, 2.8, 0.22);

const request = {
  bundleId: 'cartoon-bear-face-20261017',
  action: 'create',
  request: { points, threshold: 0.25, edgeMm: 0.45 },
};
const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(.:\/)/, '$1'));
fs.writeFileSync(path.join(dir, 'blob-create.json'), JSON.stringify(request, null, 2));
console.log(JSON.stringify({ controlPoints: points.length, noseBase,
  positiveTops: [[0, 0], [-11.8, 6.3], [25.6, 26.3], [0, -14], [0, -7]]
    .map(([x, y]) => ({ x, y, z: top(x, y, positive) })) }));
