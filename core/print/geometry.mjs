// Native geometry for a shell print: the 3DM the maker's part is stored as.
//
// The wedge demo writes a capped Rhino extrusion. That is not available here:
// rhino3dm builds no general solid from a set of patches, so a shell is stored
// as its named untrimmed surfaces and its closure is verified numerically by
// the same check the slicer relies on. Reopening the file and rebuilding the
// patches is what ties the reviewed geometry to the file on disk.

import rhino3dm from 'rhino3dm';
import { patchFromSurface, evaluate } from '../geom/nurbs.mjs';
import { makeShell, assertClosed } from '../geom/shell.mjs';
import { buildShell } from './generate.mjs';
import { hash } from './plan.mjs';
import { requireThat } from '../geom/tolerance.mjs';

// Display resolution of the proxy mesh, per patch, per direction. The proxy is
// for the viewer only; every toolpath comes from the patches themselves.
const PROXY_STEPS = 8;

let runtime;
export const rhino = () => runtime ??= rhino3dm();

// Control nets are compared through a rounded hash: 3DM stores doubles, and a
// nanometre is nine orders below the tolerances the process works at.
const netHash = patches => hash(patches.map(patch => [patch.name, patch.nu, patch.nv, patch.orderU, patch.orderV,
  [...patch.knotsU].map(round), [...patch.knotsV].map(round), [...patch.cp].map(round)]));
const round = value => Number(value.toFixed(9));

export async function createGeometry(parameters) {
  const r = await rhino();
  const shell = buildShell(r, parameters);
  requireThat(shell.surfaces?.length === shell.patches.length, 'The shape builder did not supply one Rhino surface per patch.');

  const doc = new r.File3dm();
  doc.applicationName = 'SAAM';
  doc.applicationDetails = 'Shell pipeline (full-fill, draped-skin)';
  doc.settings().modelUnitSystem = r.UnitSystem.Millimeters;
  const geometryVersion = hash(parameters);
  const features = [];
  for (const [index, entry] of shell.surfaces.entries()) {
    const attributes = new r.ObjectAttributes();
    attributes.name = entry.name;
    attributes.setUserString('saam:feature', entry.name);
    attributes.setUserString('saam:geometry', geometryVersion);
    features.push({ id: entry.name, objectId: doc.objects().add(entry.surface, attributes), patchIndex: index });
  }
  const bytes = doc.toByteArray();
  doc.destroy();

  const descriptor = {
    schema: 'saam-shell-geometry/1',
    parameters,
    geometryVersion,
    fileHash: hash(bytes),
    nativeForm: 'named untrimmed NURBS surfaces; closure verified numerically, not a Rhino solid',
    patchHash: netHash(shell.patches),
    features,
    boundsMm: shell.bounds,
    ...proxyMesh(shell)
  };
  // The file is only accepted once it reopens as the same closed shell.
  await verifyGeometry(bytes, descriptor);
  return { bytes, descriptor };
}

// Reopen the stored file, rebuild the patches from it, and require the closed
// shell they form to be the one the descriptor was written for. A file edited
// outside SAAM fails here rather than being sliced as something else.
export async function verifyGeometry(bytes, descriptor) {
  requireThat(hash(bytes) === descriptor.fileHash, 'Geometry file changed; geometry approval is stale.');
  const r = await rhino();
  const doc = r.File3dm.fromByteArray(bytes);
  try {
    requireThat(doc && doc.objects().count === descriptor.features.length, 'Invalid shell 3DM: unexpected object count.');
    const patches = [];
    for (const [index, feature] of descriptor.features.entries()) {
      const object = doc.objects().get(index);
      const attributes = object.attributes();
      requireThat(attributes.getUserString('saam:feature') === feature.id, `3DM object ${index} is not the named face "${feature.id}".`);
      requireThat(attributes.getUserString('saam:geometry') === descriptor.geometryVersion, 'The 3DM was written for different geometry parameters.');
      patches.push(patchFromSurface(object.geometry(), feature.id));
    }
    assertClosed(makeShell(patches, { name: descriptor.parameters.shape }));
    requireThat(netHash(patches) === descriptor.patchHash, 'The 3DM surfaces differ from the reviewed geometry.');
  } finally { doc?.destroy(); }
}

// Quad proxy for the viewer: each patch is sampled on its own (u, v) grid, so
// every quad carries the name of the face it came from and stays selectable.
function proxyMesh(shell) {
  const vertices = [], faces = [], labels = [];
  for (const patch of shell.patches) {
    const [u0, u1] = patch.domainU, [v0, v1] = patch.domainV;
    const base = vertices.length, row = PROXY_STEPS + 1;
    for (let i = 0; i <= PROXY_STEPS; i++)
      for (let j = 0; j <= PROXY_STEPS; j++)
        vertices.push(evaluate(patch, u0 + (u1 - u0) * i / PROXY_STEPS, v0 + (v1 - v0) * j / PROXY_STEPS, false).point.map(round));
    for (let i = 0; i < PROXY_STEPS; i++)
      for (let j = 0; j < PROXY_STEPS; j++) {
        faces.push([base + i * row + j, base + (i + 1) * row + j, base + (i + 1) * row + j + 1, base + i * row + j + 1]);
        labels.push(patch.name);
      }
  }
  return { vertices, faces, labels, proxyStepsPerPatch: PROXY_STEPS };
}
