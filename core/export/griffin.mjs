// Griffin G-code export for the shell pipeline.
//
// The header contract follows machines/ultimaker-s5.json exportGuidance: a
// complete Griffin header including GENERATOR.BUILD_DATE, the active train's
// MATERIAL.GUID and BUILD_VOLUME.TEMPERATURE. Those fields are not cosmetic -
// firmware 8.3.1 rejected an earlier file that omitted the build date, and the
// wedge demo's notes record the correction. This exporter is written against
// that same declared contract.
//
// The interpreter below reconstructs motion from the exported text alone, using
// only G-code and modal state. It never reads SAAMpath, so agreement between
// the two is a real check rather than a restatement.

import { requireThat, distance } from '../geom/tolerance.mjs';

export const format = (value, digits = 5) => Number(value.toFixed(digits)).toString();

export function exportGriffin(path, plan, machine, { generatorVersion, buildDate }) {
  const output = machine.outputs.find(option => option.id === plan.output);
  requireThat(output && output.flavor === 'Griffin', 'The machine does not declare this Griffin output.');
  requireThat(/^\d{4}-\d{2}-\d{2}$/.test(buildDate), 'A fixed release build date is required in the Griffin header.');
  const setup = plan.setup, area = Math.PI * (setup.filamentMm / 2) ** 2, tool = setup.tool;
  // zAfterPrimeMm is the pre-0.2.3 spelling; read both so an older machine
  // snapshot in a saved bundle still exports.
  const startupZ = machine.startup.zAfterStartupMm ?? machine.startup.zAfterPrimeMm;
  requireThat(Number.isFinite(startupZ), 'The machine file must declare its startup Z.');

  const moves = path.actions.filter(action => action.kind === 'move');
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const point of [path.initialPosition, ...moves.map(move => move.to)])
    for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], point[i]); max[i] = Math.max(max[i], point[i]); }
  const volume = path.actions.reduce((total, action) => total + (action.volumeMm3 ?? 0), 0);

  let seconds = 0, cursor = path.initialPosition;
  for (const action of path.actions) {
    if (action.kind === 'move') { seconds += distance(cursor, action.to) / action.speedMmS; cursor = action.to; }
    if (action.kind === 'dwell') seconds += action.seconds;
    if (action.filamentMm) seconds += action.filamentMm / action.speedMmS;
  }

  const lines = [';START_OF_HEADER', ';HEADER_VERSION:0.1', ';FLAVOR:Griffin', ';GENERATOR.NAME:SAAM',
    `;GENERATOR.VERSION:${generatorVersion}`, `;GENERATOR.BUILD_DATE:${buildDate}`,
    ';TARGET_MACHINE.NAME:Ultimaker S5',
    `;EXTRUDER_TRAIN.${tool}.INITIAL_TEMPERATURE:${setup.nozzleC}`,
    `;EXTRUDER_TRAIN.${tool}.MATERIAL.VOLUME_USED:${Math.ceil(volume)}`,
    `;EXTRUDER_TRAIN.${tool}.MATERIAL.GUID:${setup.materialGuid}`,
    `;EXTRUDER_TRAIN.${tool}.NOZZLE.DIAMETER:${setup.nozzleMm}`,
    `;EXTRUDER_TRAIN.${tool}.NOZZLE.NAME:${setup.core}`,
    ';BUILD_PLATE.TYPE:glass', `;BUILD_PLATE.INITIAL_TEMPERATURE:${setup.bedC}`,
    `;BUILD_VOLUME.TEMPERATURE:${setup.buildVolumeC}`,
    `;PRINT.TIME:${Math.ceil(seconds)}`, ';PRINT.GROUPS:1'];
  for (const [bound, values] of [['MIN', min], ['MAX', max]])
    for (const [i, axis] of ['X', 'Y', 'Z'].entries()) lines.push(`;PRINT.SIZE.${bound}.${axis}:${format(values[i])}`);
  lines.push(';END_OF_HEADER',
    ';Clearance is the operator\'s responsibility; no collision model is implemented.',
    ';Firmware owns Griffin startup; this export does not request routine bed leveling.',
    `T${tool}`, 'G21', 'G90', 'M82', `M190 S${setup.bedC}`, `M109 T${tool} S${setup.nozzleC}`,
    `G0 Z${format(startupZ)} F300`, 'G92 E0');

  let filament = 0, tag = '';
  for (const action of path.actions) {
    const next = `${action.phase}:${action.layer}`;
    if (tag !== next) { lines.push(`;SAAM_PHASE:${action.phase}`, `;LAYER:${action.layer}`); tag = next; }
    if (action.kind === 'move') {
      const xyz = action.to.map((value, i) => `${'XYZ'[i]}${format(value)}`).join(' ');
      if (action.volumeMm3 > 0) {
        filament += action.volumeMm3 / area;
        lines.push(`G1 ${xyz} E${format(filament)} F${format(action.speedMmS * 60, 3)}`);
      } else lines.push(`G0 ${xyz} F${format(action.speedMmS * 60, 3)}`);
    } else if (action.kind === 'retract' || action.kind === 'recover') {
      filament += (action.kind === 'retract' ? -1 : 1) * action.filamentMm;
      lines.push(`G1 E${format(filament)} F${format(action.speedMmS * 60, 3)}`);
    } else if (action.kind === 'fan') lines.push(action.percent === 0 ? 'M107' : `M106 S${Math.round(action.percent * 255 / 100)}`);
    else if (action.kind === 'dwell') lines.push(`G4 P${Math.ceil(action.seconds * 1000)}`);
    else throw new Error(`Unsupported SAAMpath action: ${action.kind}`);
  }
  lines.push('M400', `M104 T${tool} S0`, 'M140 S0', 'M107', ';END_OF_SAAM');
  return lines.join('\n') + '\n';
}

// Strict interpreter for the subset this exporter emits. Anything else is an
// error: an unsupported command must stop review, not be skipped silently.
export function interpretGriffin(text, plan, machine) {
  requireThat(typeof text === 'string' && text.length < 25_000_000, 'Invalid or oversized G-code.');
  const setup = plan.setup, area = Math.PI * (setup.filamentMm / 2) ** 2;
  const startupZ = machine.startup.zAfterStartupMm ?? machine.startup.zAfterPrimeMm;
  let position = [...machine.tools[setup.tool].startupXY, startupZ];
  let filament = 0, feed = 0, absolute = null, absoluteE = null, metric = false, tool = null;
  let nozzle = 0, bed = 0, hot = false, bedReady = false, fan = 0;
  let phase = 'startup', layer = -1, seconds = 0, volume = 0;
  const moves = [], events = [], header = {};
  let inHeader = false, headerDone = false;
  const tokens = /([A-Z])([+-]?(?:\d+(?:\.\d*)?|\.\d+))/g;

  for (const [offset, raw] of text.split(/\r?\n/).entries()) {
    const line = offset + 1, trimmed = raw.trim();
    if (trimmed === ';START_OF_HEADER') { requireThat(!inHeader && !headerDone && line === 1, 'Malformed Griffin header.'); inHeader = true; continue; }
    if (trimmed === ';END_OF_HEADER') { requireThat(inHeader, 'Malformed Griffin header.'); inHeader = false; headerDone = true; continue; }
    if (inHeader) {
      const match = /^;([A-Z0-9_.]+):(.*)$/.exec(trimmed);
      requireThat(match, `Unrecognized header line ${line}.`);
      header[match[1]] = match[2];
      continue;
    }
    if (!trimmed) continue;
    if (trimmed.startsWith(';')) {
      const phaseMatch = /^;SAAM_PHASE:(.+)$/.exec(trimmed), layerMatch = /^;LAYER:(-?\d+)$/.exec(trimmed);
      if (phaseMatch) phase = phaseMatch[1];
      if (layerMatch) layer = Number(layerMatch[1]);
      continue;
    }
    const command = /^([GMT]\d+)(?:\s|$)/.exec(trimmed);
    requireThat(command, `Unrecognized command on line ${line}: ${trimmed}`);
    const rest = trimmed.slice(command[1].length);
    const words = {};
    for (const [, letter, value] of rest.matchAll(tokens)) {
      requireThat(!(letter in words), `Repeated ${letter} word on line ${line}.`);
      words[letter] = Number(value);
    }
    requireThat(!/[^\sGMTXYZEFSP0-9+\-.]/.test(rest), `Unsupported argument on line ${line}.`);

    switch (command[1]) {
      case 'T0': case 'T1':
        tool = Number(command[1][1]);
        requireThat(tool === setup.tool, `Program selects T${tool}; the plan locks T${setup.tool}.`);
        break;
      case 'G21': metric = true; break;
      case 'G90': absolute = true; break;
      case 'G91': absolute = false; break;
      case 'M82': absoluteE = true; break;
      case 'M83': absoluteE = false; break;
      case 'M190': bed = words.S ?? 0; bedReady = true; break;
      case 'M140': bed = words.S ?? 0; break;
      case 'M109': nozzle = words.S ?? 0; hot = true; break;
      case 'M104': nozzle = words.S ?? 0; break;
      case 'M106': fan = Math.round((words.S ?? 255) * 100 / 255); break;
      case 'M107': fan = 0; break;
      case 'M400': events.push({ line, kind: 'synchronize' }); break;
      case 'G4': seconds += (words.P ?? 0) / 1000; events.push({ line, kind: 'dwell', seconds: (words.P ?? 0) / 1000 }); break;
      case 'G92':
        requireThat(words.E !== undefined, 'Only G92 E is supported.');
        filament = words.E;
        break;
      case 'G0': case 'G1': {
        requireThat(metric && absolute === true && absoluteE === true, `Motion before G21/G90/M82 on line ${line}.`);
        requireThat(tool !== null && hot && bedReady, `Motion before the machine is ready on line ${line}.`);
        if (words.F !== undefined) { feed = words.F; requireThat(feed > 0, `Invalid feed on line ${line}.`); }
        const target = [words.X ?? position[0], words.Y ?? position[1], words.Z ?? position[2]];
        for (const [i, axis] of ['x', 'y', 'z'].entries())
          requireThat(target[i] >= machine.bounds.min[i] - 1e-6 && target[i] <= machine.bounds.max[i] + 1e-6,
            `Move on line ${line} leaves the build volume on ${axis.toUpperCase()}.`);
        const length = distance(position, target);
        const deltaE = words.E === undefined ? 0 : words.E - filament;
        if (words.E !== undefined) filament = words.E;
        const speed = feed / 60;
        // Axis feed limits apply per axis, on the commanded vector.
        if (length > 0) {
          for (const [i, axis] of ['x', 'y', 'z'].entries()) {
            const axisSpeed = Math.abs(target[i] - position[i]) / length * speed;
            requireThat(axisSpeed <= machine.maxFeedMmS[axis] + 1e-6, `Line ${line} exceeds the ${axis.toUpperCase()} feed limit.`);
          }
          seconds += length / speed;
          moves.push({ line, from: [...position], to: target, volumeMm3: deltaE > 0 ? deltaE * area : 0, speedMmS: speed, phase, layer, extruding: deltaE > 0, startSeconds: seconds - length / speed, durationSeconds: length / speed });
          if (deltaE > 0) volume += deltaE * area;
        } else if (deltaE !== 0) {
          events.push({ line, kind: deltaE < 0 ? 'retract' : 'recover', filamentMm: Math.abs(deltaE) });
          seconds += Math.abs(deltaE) / speed;
        }
        position = target;
        break;
      }
      default: throw new Error(`Unsupported command on line ${line}: ${command[1]}`);
    }
  }
  requireThat(headerDone, 'Missing Griffin header.');
  requireThat(header.FLAVOR === 'Griffin' && header['HEADER_VERSION'] === '0.1' && header['TARGET_MACHINE.NAME'] === 'Ultimaker S5', 'Invalid Griffin target or header.');
  for (const key of ['GENERATOR.NAME', 'GENERATOR.VERSION', 'GENERATOR.BUILD_DATE'])
    requireThat(header[key]?.trim(), `${key} must be set in the Griffin header.`);
  requireThat(/^\d{4}-\d{2}-\d{2}$/.test(header['GENERATOR.BUILD_DATE']), 'Invalid generator build date.');
  requireThat(/^\d+$/.test(header['PRINT.TIME']), 'PRINT.TIME must be a nonnegative integer.');
  requireThat(header[`EXTRUDER_TRAIN.${setup.tool}.MATERIAL.GUID`]?.trim(), 'The active train needs a MATERIAL.GUID.');
  requireThat(header['BUILD_VOLUME.TEMPERATURE']?.trim(), 'BUILD_VOLUME.TEMPERATURE must be set.');
  requireThat(nozzle === 0 && bed === 0 && fan === 0, 'The program must switch off nozzle, bed and fan.');
  return {
    header, moves, events, seconds, volumeMm3: volume, finalPosition: position,
    // A summary for review surfaces; every value is read back from the exported
    // text, never from SAAMpath.
    summary: {
      moves: moves.length,
      extrusionMoves: moves.filter(move => move.extruding).length,
      motionSeconds: seconds,
      volumeMm3: volume,
      filamentMm: volume / area,
      layers: new Set(moves.filter(move => move.extruding && move.phase === 'planar').map(move => move.layer)).size,
      skins: new Set(moves.filter(move => move.extruding && move.phase === 'draped-skin').map(move => move.layer)).size
    }
  };
}
