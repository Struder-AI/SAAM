// One STL import entry for CLI and MCP: preserve source, explicit units,
// remembered setup, native mesh verification and the normal print lifecycle.
import { initBundle, proposedPlan } from './bundle.mjs';
import { hash } from './plan.mjs';
import { loadMachine, toolBounds } from '../machine/profile.mjs';
import { parseSTL } from '../geom/mesh.mjs';

export async function importSTLBundle(directory, sourceBytes, { units, machineId, setupFile } = {}) {
  const machine = loadMachine(machineId);
  const plan = await proposedPlan(machine.id, { setupFile });
  plan.geometry = { shape: 'mesh', ...parseSTL(sourceBytes, { units }),
    source: { format: 'stl', sha256: hash(sourceBytes), units, scale: 1 } };
  const translationMm = [0, 1, 2].map(k => -plan.geometry.vertices.reduce((minimum, point) => Math.min(minimum, point[k]), Infinity));
  plan.geometry.vertices = plan.geometry.vertices.map(point => point.map((value, k) => value + translationMm[k]));
  plan.geometry.source.translationMm = translationMm;
  const bounds = toolBounds(machine, plan.setup.tool);
  plan.placement = { xMm: bounds.min[0] + 5, yMm: bounds.min[1] + 5 };
  plan.skills['draped-skin'].enabled = false;
  return initBundle(directory, plan, { machineId: machine.id, setupFile, sourceBytes });
}
