import {requireThat,distance} from '../geom/tolerance.mjs';

// Nozzle heating for a job that changes nozzles, decided once on the finished path so every exporter and the
// checker see the same schedule. A nozzle is heated `leadSeconds` before it is needed, using the same time
// the exporters count (motion at its written speed, dwells, stationary extrusion, filament moves); a nozzle
// that will sit idle for long is switched off after the change and heated again ahead of its next use.
// If the print has not run long enough before a change to heat that nozzle, the head waits parked.
export function scheduleHeaters(path, {nozzleC, leadSeconds, initialTool}) {
  const actions = path.actions, times = new Array(actions.length + 1);
  let time = 0, position = path.initialPosition;
  actions.forEach((a, i) => {
    times[i] = time;
    if (a.kind === 'move') { time += distance(position, a.to) / a.speedMmS; position = a.to; }
    else if (a.kind === 'dwell') time += a.seconds;
    else if (a.kind === 'extrude') time += a.volumeMm3 / a.flowMm3S;
    else if (a.filamentMm) time += a.filamentMm / a.speedMmS;
    else if (a.kind === 'tool' && a.position) position = a.position;
  });
  times[actions.length] = time;
  const changes = actions.flatMap((a, i) => a.kind === 'tool' ? [i] : []);
  if (!changes.length) return path;
  const idleWorth = 2 * leadSeconds;
  const inserts = new Map(); // index -> actions to place before it
  const place = (index, action, source) => {
    const entry = {...action, phase: source.phase, layer: source.layer, ...(source.operation ? {operation: source.operation} : {})};
    inserts.set(index, [...(inserts.get(index) ?? []), entry]);
  };
  const cooledAt = new Map(); // by tool: the index its switch-off was placed before
  const hot = new Map([[initialTool, true]]); // by tool: at the planned temperature, or heating toward it
  changes.forEach((k, n) => {
    const change = actions[k], to = change.toTool, from = change.fromTool;
    if (!hot.get(to)) {
      // Latest point at least `leadSeconds` before the change; the start of the body if the print is shorter.
      let j = k;
      while (j > (cooledAt.get(to) ?? 0) && times[k] - times[j] < leadSeconds) j--;
      place(j, {kind: 'heater', tool: to, targetC: nozzleC}, actions[j]);
      hot.set(to, true);
      const wait = leadSeconds - (times[k] - times[j]);
      if (wait > 0) place(k, {kind: 'dwell', seconds: Math.ceil(wait * 1000) / 1000}, actions[k - 1] ?? actions[k]);
    }
    // The nozzle left behind: switch it off unless it is wanted again soon.
    const next = changes.slice(n + 1).find(m => actions[m].toTool === from);
    if (next === undefined || times[next] - times[k] >= idleWorth) {
      place(k + 1, {kind: 'heater', tool: from, targetC: 0}, change);
      hot.set(from, false);
      cooledAt.set(from, k + 1);
    }
  });
  const scheduled = [];
  actions.forEach((a, i) => { for (const extra of inserts.get(i) ?? []) scheduled.push(extra); scheduled.push(a); });
  for (const extra of inserts.get(actions.length) ?? []) scheduled.push(extra);
  path.actions = scheduled;
  return path;
}
