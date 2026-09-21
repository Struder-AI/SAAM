import {createHash} from 'node:crypto';
import {requireThat} from '../geom/tolerance.mjs';

// The H2D nozzle-change block. Firmware macros are allowed in a job's body only as this pinned template, rendered
// from a few numeric slots and checked line by line: it was derived from, and reproduces byte for byte, every
// nozzle switch in the supplied Bambu Studio slices (scripts/h2d-derive-tool-change.mjs; maps/reference/bambu.md).
// Diameters are equal on both nozzles: how the diameter tokens split across nozzles of different sizes is unknown.
export const TOOL_CHANGE_BEGIN = ';SAAM_TOOLCHANGE_BEGIN', TOOL_CHANGE_END = ';SAAM_TOOLCHANGE_END';

export const toolChangeDigest = config => createHash('sha256').update(JSON.stringify(config)).digest('hex');

const NUMBER = '(-?\\d+(?:\\.\\d+)?)';
const compiled = new WeakMap();
function compile(config) {
  if (!compiled.has(config)) compiled.set(config, config.template.map(line => {
    const names = [];
    const source = line.split(/\{(\w+)\}/).map((part, i) => i % 2 ? (names.push(part), NUMBER) : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
    return {names, re: new RegExp(`^${source}$`)};
  }));
  return compiled.get(config);
}

export const slotText = value => String(Math.round(value * 1000) / 1000);

export function renderBlock(config, slots) {
  return config.template.map(line => line.replace(/\{(\w+)\}/g, (_, key) => {
    requireThat(slots[key] !== undefined, `Nozzle change slot ${key} is missing.`);
    return slots[key];
  }));
}

// Read a block's slot values back from its lines. Every line must fit the template, and a slot that appears
// more than once must have one value.
export function parseBlock(config, lines) {
  const patterns = compile(config), slots = {};
  requireThat(lines.length === patterns.length, 'A nozzle change block has the wrong number of lines.');
  lines.forEach((line, i) => {
    const match = patterns[i].re.exec(line);
    requireThat(match, `Nozzle change line ${i + 1} does not fit the pinned sequence.`);
    patterns[i].names.forEach((name, k) => {
      requireThat(slots[name] === undefined || slots[name] === match[k + 1], `Nozzle change slot ${name} disagrees between lines.`);
      slots[name] = match[k + 1];
    });
  });
  return slots;
}

// The nozzle diameter a tool prints with in this plan: the plan's own tool, or a network that names it.
export function nozzleOfTool(plan, tool) {
  if (tool === plan.setup.tool) return plan.setup.nozzleMm;
  return (plan.skills['line-network']?.networks ?? []).find(network => network.tool?.index === tool)?.tool.nozzleMm ?? null;
}

// The slot values for one change. Equal diameters only, taken from the table the references gave.
export function slotValues(config, {from, to, changeIndex, lift, fan, plan}) {
  const toMm = nozzleOfTool(plan, to), fromMm = nozzleOfTool(plan, from);
  requireThat(toMm !== null && toMm === fromMm, 'A nozzle change needs the same nozzle diameter on both nozzles; mixed diameters are not supported.');
  const table = config.diameters[String(toMm)];
  requireThat(table, `A nozzle change is not supported for a ${toMm} mm nozzle (supported: ${Object.keys(config.diameters).join(', ')} mm).`);
  return {
    sel: String(to), old: String(from), lift: slotText(lift), f20: table.f20, f25: table.f25, f983: table.f983, dia: String(toMm),
    counter: String(changeIndex === 0 ? config.counters.first : config.counters.later), purgeX: slotText(config.entry.x),
    fanPart: slotText(fan), fanAux: '0'
  };
}

// The lines the writer emits for one change, and where the head is left.
export function changeLines(config, request) {
  const slots = slotValues(config, request);
  return {lines: [TOOL_CHANGE_BEGIN, ...renderBlock(config, slots), TOOL_CHANGE_END], position: [config.entry.x, config.entry.y, Number(slots.lift)]};
}

// The interpreter's check of a block it has read: it must be exactly the template for a legal change from the
// nozzle in use, with lift, fans, temperatures and timing that the state proves safe. Returns the effect.
export function checkBlock(config, lines, state) {
  const {plan, machine, tool, fan, maxZ, changeIndex, heat, boundsOf} = state;
  const slots = parseBlock(config, lines), num = key => Number(slots[key]);
  const to = num('sel'), from = num('old');
  requireThat(Number.isInteger(to) && Number.isInteger(from) && machine.tools.some(t => t.index === to) && from === tool && to !== from, 'Nozzle change does not leave the nozzle in use.');
  const toMm = nozzleOfTool(plan, to), fromMm = nozzleOfTool(plan, from);
  requireThat(toMm !== null && toMm === fromMm && slots.dia === String(toMm), 'Nozzle change diameters do not match the two nozzles.');
  const table = config.diameters[slots.dia];
  requireThat(table && slots.f20 === table.f20 && slots.f25 === table.f25 && slots.f983 === table.f983, 'Nozzle change flow values do not match the nozzle diameter.');
  requireThat(num('counter') === (changeIndex === 0 ? config.counters.first : config.counters.later), 'Nozzle change counter is out of sequence.');
  requireThat(num('purgeX') === config.entry.x, 'Nozzle change enters the purge area at an unexpected position.');
  const limits = boundsOf(to), lift = num('lift');
  requireThat(Number.isFinite(lift) && lift >= config.lift.minMm - 1e-9 && lift >= maxZ + config.lift.aboveWorkMm - 1e-6 && lift <= limits.max[2] + 1e-9, 'Nozzle change lift does not clear the printed part.');
  requireThat(config.entry.x >= limits.min[0] - 1e-9 && config.entry.x <= limits.max[0] + 1e-9 && config.entry.y >= limits.min[1] - 1e-9 && config.entry.y <= limits.max[1] + 1e-9, 'Nozzle change entry is outside the reach of the new nozzle.');
  requireThat(num('fanPart') === fan && num('fanAux') === 0, 'Nozzle change restores fans that differ from the program state.');
  requireThat(heat.targetC(to) === plan.setup.nozzleC && heat.secondsHot(to) >= config.heat.leadSeconds - 1e-6, 'Nozzle change without a completed pre-heat of the new nozzle.');
  return {to, position: [config.entry.x, config.entry.y, lift], fan: num('fanPart')};
}

// Every nozzle a plan prints with, in index order: its own tool, and any a line network names.
export function usedTools(plan) {
  const tools = new Set([plan.setup.tool]);
  const networks = plan.skills['line-network']?.enabled ? plan.skills['line-network'].networks : [];
  for (const network of networks) if (network.tool) tools.add(network.tool.index);
  return [...tools].sort((a, b) => a - b);
}

export const toolColor = (plan, tool, fallback) => tool === plan.setup.tool ? (plan.setup.filamentColor ?? fallback)
  : (plan.skills['line-network']?.networks ?? []).find(network => network.tool?.index === tool)?.tool.color ?? fallback;
