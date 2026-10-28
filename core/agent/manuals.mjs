// Read the repository's published Markdown through the same paths its links use, and assemble
// a manual for the agent reading it: its client, its print's machine and what it asked for.
import { lstat, readFile } from 'node:fs/promises';
import { resolve, posix } from 'node:path';
import {readExtension} from '../extensions/library.mjs';

const rootManuals = new Set(['AGENTS.md', 'README.md', 'MAKERS.md', 'GEOMETRY.md', 'BUILDERS.md', 'DEVELOPER-CONTEXT.md',
  'CONTRIBUTING.md', 'CONTRIBUTING-AGENTS.md', 'SETUP.md', 'GLOSSARY.md', 'DECISIONS.md', 'DEVLOG.md', 'CLAUDE.md', 'examples/prints/README.md', 'TECHNICAL-OVERVIEW.md', 'ARCHITECTURE.md']);
const documentRoots = new Set(['core', 'skills', 'extensions', 'studio', 'machines', 'packaging', 'scripts', 'docs', 'plans', 'intent']);
const excluded = new Set(['prints', 'node_modules', 'dist', 'build']);
const aliases = {
  overview: 'TECHNICAL-OVERVIEW.md', architecture: 'ARCHITECTURE.md', makers: 'MAKERS.md', geometry: 'GEOMETRY.md', builders: 'BUILDERS.md', development: 'BUILDERS.md',
  'developer-context': 'DEVELOPER-CONTEXT.md', glossary: 'GLOSSARY.md',
  application: 'core/application/README.md', 'print-tools': 'core/print/USAGE.md'
};
export const guidanceIds = Object.keys(aliases);

// Published: Markdown, and the example recipes (create_bundle inputs) a skill or extension ships.
function publishedPath(path) {
  const parts = path.split('/');
  return (path.endsWith('.md') || /^(skills|extensions)\/[^/]+\/examples\/[^/]+\.json$/.test(path)) && !/[\\:*?"<>|\x00-\x1f]/.test(path)
    && parts.every(part => part && !/^[.]|[. ]$/.test(part)
      && (!excluded.has(part.toLowerCase()) || path === 'examples/prints/README.md' && part === 'prints')
      && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))
    && (rootManuals.has(path) || documentRoots.has(parts[0]));
}

// A gate marker is an HTML comment on the line directly above a heading; it gates that heading's
// section. `layer: advanced` is read on request;
// `requires: a, b` (advanced) also opens for a machine with any of those capabilities, and
// `nonplanar>=N` for one whose nonplanar limit reaches N degrees. A marker that cannot be read
// stays ordinary text, so its section is ungated; builder and developer reads note it.
const MARKER = /^<!--\s*((?:layer|requires):[^>]*?)\s*-->\s*$/;
function parseMarker(line) {
  const body = MARKER.exec(line.trimEnd())?.[1];
  if (!body) return undefined;
  const gate = { layer: undefined, requires: [] }, unreadable = reason => ({ unreadable: `"${line.trim()}": ${reason}` });
  for (const part of body.split(';')) {
    const [key, value = ''] = part.split(':').map(item => item.trim());
    if (key === 'layer' && value === 'advanced') gate.layer = value;
    else if (key === 'requires') gate.requires = value.split(',').map(item => item.trim()).filter(Boolean);
    else return unreadable('use layer: advanced and requires: capability, …');
  }
  if (gate.requires.some(token => !/^[a-z][a-z0-9-]*$|^nonplanar>=\d+(?:\.\d+)?$/.test(token)))
    return unreadable('name a machine capability or nonplanar>=DEGREES');
  if (gate.requires.length) gate.layer = 'advanced';
  return gate.layer ? { gate } : unreadable('use layer: advanced and requires: capability, …');
}

// How a gate reads in the index and in the list of omitted sections.
export function gateText(gate) {
  if (!gate.requires.length) return 'on request';
  return gate.requires.map(token => token.replace(/^nonplanar>=(.*)$/, 'nonplanar ≥ $1°')).join(' or ') + ' machines';
}

// A manual's headings with their gates, and the marker lines it could not read.
function outline(markdown) {
  const result = [], unreadable = [], counts = new Map();
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
      } else {
        const parsed = parseMarker(line);
        gate = parsed?.gate;
        if (parsed?.unreadable) unreadable.push(parsed.unreadable);
      }
    }
    previous = gate;
    offset += line.length;
  }
  return { sections: result, unreadable };
}
const sectionEnd = (sections, index, length) =>
  sections.slice(index + 1).find(item => item.level <= sections[index].level)?.offset ?? length;

// Every gated section of one manual, for the index and the machine-change hint, and the
// marker lines it could not read.
export function gatedSections(markdown, path) {
  const { sections, unreadable } = outline(markdown);
  return { sections: sections.filter(section => section.gate).map(({ title, anchor, gate }) =>
    ({ title, guidanceId: `${path}#${anchor}`, layer: gate.layer, requires: gate.requires, gate: gateText(gate) })), unreadable };
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
  const { sections } = outline(markdown), index = sections.findIndex(section => section.anchor === anchor);
  if (index < 0) throw new Error(`Unknown heading #${anchor}. Read the document for its headings.`);
  return markdown.slice(sections[index].offset, sectionEnd(sections, index, markdown.length));
}

// What a machine opens: its capabilities, and its nonplanar limit for `nonplanar>=N`.
export function machineOpens(selection) {
  if (!selection) return () => false;
  if(typeof selection!=='object')throw Error('Context requires captured machine settings, not a profile ID.');
  const machine = selection;
  const capabilities = new Set(machine.capabilities ?? []);
  return token => {
    const [name, degrees] = token.split('>=');
    return degrees === undefined ? capabilities.has(name)
      : capabilities.has(name) && (machine.nonplanar?.maxAngleDeg ?? 0) >= Number(degrees);
  };
}

// The manual as this reader gets it. `context` is {machineId, all}: an advanced section opens
// when the machine meets a requirement, and every one with `all`. A heading asked for by name is always returned whole of its own gate.
// Closed sections are cut and listed in `omitted`; frontmatter and gate markers are dropped, line
// endings are LF and relative links become repository paths.
export function assembleGuidance(markdown, path, { anchor, machineId, machine, all = false } = {}) {
  if(machineId!==undefined&&machine===undefined)throw Error('Capture machine settings before assembling guidance.');
  const { sections } = outline(markdown), opens = machineOpens(machine);
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
    if (all || gate.requires.some(opens)) return;
    cuts.push([offset, Math.min(end, sectionEnd(sections, index, markdown.length))]);
    omitted.push({ title: section.title, guidanceId: `${path}#${section.anchor}`, gate: gateText(gate) });
  });
  let text = '', position = start;
  for (const [from, to] of cuts) { text += markdown.slice(position, from); position = to; }
  text += markdown.slice(position, end);
  text = text.replace(/\r\n/g, '\n').split('\n').filter(line => !parseMarker(line)?.gate).join('\n')
    .replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
  return { text: repositoryLinks(text, path), omitted };
}

async function loadGuidance(root, guidanceId, {dataRoot}={}) {
  const [requested, encodedAnchor] = guidanceId.split('#');
  let path, anchor;
  try {
    path = Object.hasOwn(aliases, requested) ? aliases[requested] : decodeURIComponent(requested);
    anchor = encodedAnchor ? decodeURIComponent(encodedAnchor) : undefined;
  } catch { throw new Error('Invalid documentation path or heading.'); }
  if (!publishedPath(path)) throw new Error('Invalid documentation path. Use a repository-relative link from a manual.');
  if(path.startsWith('extensions/')){
    const [,id,...parts]=path.split('/'),selected=await readExtension(id,{appRoot:root,dataRoot});
    if(!selected||!parts.length||!selected.files.some(file=>file.path===parts.join('/')))
      throw new Error(`Extension guidance is missing: ${path}.`);
    return {path,anchor,markdown:await readFile(resolve(selected.directory,...parts),'utf8')};
  }
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
export async function readGuidance(root, guidanceId, options={}) {
  const { path, anchor, markdown } = await loadGuidance(root, guidanceId, options);
  const text = guidanceSection(markdown, anchor);
  return { guidanceId, path, text, headings: outline(markdown).sections.map(({ title, anchor }) => ({ title, guidanceId: `${path}#${anchor}` })),
    links: guidanceLinks(text, path), guidanceIds };
}

// The source as an agent reads it (see assembleGuidance); `headings` adds the manual's headings
// with their gates, for choosing a section to read by name; `markers` (builder and developer
// reads) adds the marker lines it could not read.
export async function prepareManual(root,guidanceId,options={}){return {guidanceId,...await loadGuidance(root,guidanceId,options)};}
export function assembleManual({guidanceId,path,anchor,markdown},{headings:withHeadings=false,markers:withMarkers=false,...context}={}){
  const { text, omitted } = assembleGuidance(markdown, path, { ...context, anchor }), { sections, unreadable } = outline(markdown);
  return { guidanceId, path, text, ...(omitted.length ? { omitted } : {}),
    ...(withMarkers && unreadable.length ? { unreadableMarkers: unreadable } : {}),
    ...(withHeadings ? { headings: sections.map(({ title, anchor, gate }) =>
      ({ title, guidanceId: `${path}#${anchor}`, ...(gate ? { gate: gateText(gate) } : {}) })) } : {}) };
}
export async function readManual(root,guidanceId,{dataRoot,...context}={}){return assembleManual(await prepareManual(root,guidanceId,{dataRoot}),context);}
