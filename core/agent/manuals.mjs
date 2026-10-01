// Read the repository's published Markdown through the same paths its links use, and assemble
// a manual for the agent reading it: its client, its print's machine and what it asked for.
import { lstat, readFile } from 'node:fs/promises';
import { resolve, posix } from 'node:path';
import { loadMachine } from '../machine/profile.mjs';

const rootManuals = new Set(['AGENTS.md', 'README.md', 'MAKERS.md', 'GEOMETRY.md', 'BUILDERS.md', 'DEVELOPER-CONTEXT.md',
  'CONTRIBUTING.md', 'CONTRIBUTING-AGENTS.md', 'SETUP.md', 'GLOSSARY.md', 'DECISIONS.md', 'DEVLOG.md', 'build_request.md', 'CLAUDE.md', 'examples/prints/README.md', 'TECHNICAL-OVERVIEW.md', 'plans/0.2.0.md']);
const documentRoots = new Set(['core', 'skills', 'studio', 'machines', 'adapters', 'scripts', 'dev-map']);
const excluded = new Set(['prints', 'node_modules', 'dist', 'build']);
const aliases = {
  overview: 'TECHNICAL-OVERVIEW.md', makers: 'MAKERS.md', geometry: 'GEOMETRY.md', builders: 'BUILDERS.md', development: 'BUILDERS.md',
  'developer-context': 'DEVELOPER-CONTEXT.md', glossary: 'GLOSSARY.md',
  mcp: 'adapters/mcp/README.md', 'print-tools': 'core/print/USAGE.md'
};
export const guidanceIds = Object.keys(aliases);

function publishedPath(path) {
  const parts = path.split('/');
  return path.endsWith('.md') && !/[\\:*?"<>|\x00-\x1f]/.test(path)
    && parts.every(part => part && !/^[.]|[. ]$/.test(part)
      && (!excluded.has(part.toLowerCase()) || path === 'examples/prints/README.md' && part === 'prints')
      && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))
    && (rootManuals.has(path) || documentRoots.has(parts[0]));
}

// A gate marker is an HTML comment on the line directly above a heading; it gates that heading's
// section. `layer: script` needs command access; `layer: advanced` is read on request;
// `requires: a, b` (advanced) also opens for a machine with any of those capabilities, and
// `nonplanar>=N` for one whose nonplanar limit reaches N degrees.
const MARKER = /^<!--\s*((?:layer|requires):[^>]*?)\s*-->\s*$/;
function parseMarker(line) {
  const body = MARKER.exec(line.trimEnd())?.[1];
  if (!body) return undefined;
  const gate = { layer: undefined, requires: [] };
  for (const part of body.split(';')) {
    const [key, value = ''] = part.split(':').map(item => item.trim());
    if (key === 'layer' && ['script', 'advanced'].includes(value)) gate.layer = value;
    else if (key === 'requires') gate.requires = value.split(',').map(item => item.trim()).filter(Boolean);
    else throw Error(`Invalid gate marker "${line.trim()}": use layer: script|advanced and requires: capability, …`);
  }
  if (gate.requires.some(token => !/^[a-z][a-z0-9-]*$|^nonplanar>=\d+(?:\.\d+)?$/.test(token)))
    throw Error(`Invalid requirement in "${line.trim()}": name a machine capability or nonplanar>=DEGREES.`);
  if (gate.requires.length) {
    if (gate.layer === 'script') throw Error(`"${line.trim()}": a machine requirement makes a section advanced, not script.`);
    gate.layer = 'advanced';
  }
  if (!gate.layer) throw Error(`Invalid gate marker "${line.trim()}".`);
  return gate;
}

// How a gate reads in the index and in the list of omitted sections.
export function gateText(gate) {
  if (gate.layer === 'script') return 'command access';
  if (!gate.requires.length) return 'on request';
  return gate.requires.map(token => token.replace(/^nonplanar>=(.*)$/, 'nonplanar ≥ $1°')).join(' or ') + ' machines';
}

function headings(markdown) {
  const result = [], counts = new Map();
  let offset = 0, fence, previous;
  for (const line of markdown.split(/(?<=\n)/)) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    let gate;
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
    } else if (!fence) {
      const match = /^(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/.exec(line);
      if (match) {
        const title = match[2], base = title.toLowerCase().replace(/<[^>]*>/g, '')
          .replace(/[^\p{L}\p{N}_\-\s]/gu, '').replace(/\s/g, '-');
        const count = counts.get(base) ?? 0;
        counts.set(base, count + 1);
        result.push({ title, anchor: count ? `${base}-${count}` : base, level: match[1].length, offset, gate: previous });
      } else gate = parseMarker(line);
    }
    previous = gate;
    offset += line.length;
  }
  return result;
}
const sectionEnd = (sections, index, length) =>
  sections.slice(index + 1).find(item => item.level <= sections[index].level)?.offset ?? length;

// Every gated section of one manual, for the index and the machine-change hint.
export function gatedSections(markdown, path) {
  const sections = headings(markdown);
  return sections.filter(section => section.gate).map(({ title, anchor, gate }) =>
    ({ title, guidanceId: `${path}#${anchor}`, layer: gate.layer, requires: gate.requires, gate: gateText(gate) }));
}

export function guidanceLinks(markdown, path) {
  const links = [];
  for (const match of markdown.matchAll(/\[([^\]]*)\]\(([^)]+)\)/g)) {
    const [target, anchor] = match[2].split('#');
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    let linked;
    try { linked = target ? posix.normalize(posix.join(posix.dirname(path), decodeURIComponent(target))) : path; }
    catch { continue; }
    if (publishedPath(linked)) links.push({ title: match[1], guidanceId: linked + (anchor ? `#${anchor}` : '') });
  }
  return links;
}
// Relative links become repository paths, which read_guidance and a file reader both take as
// they stand; same-manual anchors stay as they are.
function repositoryLinks(markdown, path) {
  return markdown.replace(/\]\(([^)#\s]+)(#[^)\s]*)?\)/g, (whole, target, anchor = '') => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return whole;
    try { return `](${posix.normalize(posix.join(posix.dirname(path), decodeURIComponent(target)))}${anchor})`; }
    catch { return whole; }
  });
}

export function guidanceSection(markdown, anchor) {
  if (!anchor) return markdown;
  const sections = headings(markdown), index = sections.findIndex(section => section.anchor === anchor);
  if (index < 0) throw new Error(`Unknown heading #${anchor}. Read the document for its headings.`);
  return markdown.slice(sections[index].offset, sectionEnd(sections, index, markdown.length));
}

// What a machine opens: its capabilities, and its nonplanar limit for `nonplanar>=N`.
export function machineOpens(selection) {
  if (!selection) return () => false;
  const machine = typeof selection==='string'?loadMachine(selection):selection;
  const capabilities = new Set(machine.capabilities ?? []);
  return token => {
    const [name, degrees] = token.split('>=');
    return degrees === undefined ? capabilities.has(name)
      : capabilities.has(name) && (machine.nonplanar?.maxAngleDeg ?? 0) >= Number(degrees);
  };
}

// The manual as this reader gets it. `context` is {client: 'web'|'script', machineId, all}: a
// script section opens for a script client, an advanced one when the machine meets a requirement,
// and every one with `all`. A heading asked for by name is always returned whole of its own gate.
// Closed sections are cut and listed in `omitted`; frontmatter and markers are dropped, line
// endings are LF and relative links become repository paths.
export function assembleGuidance(markdown, path, { anchor, client = 'web', machineId, machine, all = false } = {}) {
  const sections = headings(markdown), opens = machineOpens(machine===undefined?machineId:machine);
  let start = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(markdown)?.[0].length ?? 0, end = markdown.length, requested;
  if (anchor) {
    requested = sections.findIndex(section => section.anchor === anchor);
    if (requested < 0) throw new Error(`Unknown heading #${anchor}. Read the document for its headings.`);
    start = sections[requested].offset; end = sectionEnd(sections, requested, markdown.length);
  }
  const cuts = [], omitted = [];
  sections.forEach((section, index) => {
    const { gate, offset } = section;
    if (!gate || index === requested || offset < start || offset >= end || cuts.some(([a, b]) => offset >= a && offset < b)) return;
    if (all || (gate.layer === 'script' ? client === 'script' : gate.requires.some(opens))) return;
    cuts.push([offset, Math.min(end, sectionEnd(sections, index, markdown.length))]);
    omitted.push({ title: section.title, guidanceId: `${path}#${section.anchor}`, gate: gateText(gate) });
  });
  let text = '', position = start;
  for (const [from, to] of cuts) { text += markdown.slice(position, from); position = to; }
  text += markdown.slice(position, end);
  text = text.replace(/\r\n/g, '\n').split('\n').filter(line => !MARKER.test(line.trimEnd())).join('\n')
    .replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
  return { text: repositoryLinks(text, path), omitted };
}

async function loadGuidance(root, guidanceId) {
  const [requested, encodedAnchor] = guidanceId.split('#');
  let path, anchor;
  try {
    path = Object.hasOwn(aliases, requested) ? aliases[requested] : decodeURIComponent(requested);
    anchor = encodedAnchor ? decodeURIComponent(encodedAnchor) : undefined;
  } catch { throw new Error('Invalid documentation path or heading.'); }
  if (!publishedPath(path)) throw new Error('Invalid documentation path. Use a repository-relative Markdown link from a manual.');
  let current = root;
  for (const part of path.split('/')) {
    current = resolve(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink() || (info.isFile() && info.nlink > 1))
      throw new Error('Documentation paths cannot contain symbolic links, junctions or hard-linked files.');
  }
  return { path, anchor, markdown: await readFile(current, 'utf8') };
}

// The source as written: one file or section, its headings and resolved links.
export async function readGuidance(root, guidanceId) {
  const { path, anchor, markdown } = await loadGuidance(root, guidanceId);
  const text = guidanceSection(markdown, anchor);
  return { guidanceId, path, text, headings: headings(markdown).map(({ title, anchor }) => ({ title, guidanceId: `${path}#${anchor}` })),
    links: guidanceLinks(text, path), guidanceIds };
}

// The source as an agent reads it (see assembleGuidance); `headings` adds the manual's headings
// with their gates, for choosing a section to read by name.
export async function readManual(root, guidanceId, { headings: withHeadings = false, ...context } = {}) {
  const { path, anchor, markdown } = await loadGuidance(root, guidanceId);
  const { text, omitted } = assembleGuidance(markdown, path, { ...context, anchor });
  return { guidanceId, path, text, ...(omitted.length ? { omitted } : {}),
    ...(withHeadings ? { headings: headings(markdown).map(({ title, anchor, gate }) =>
      ({ title, guidanceId: `${path}#${anchor}`, ...(gate ? { gate: gateText(gate) } : {}) })) } : {}) };
}
