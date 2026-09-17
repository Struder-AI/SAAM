// Read the repository's published Markdown through the same paths its links use.
import { lstat, readFile } from 'node:fs/promises';
import { resolve, posix } from 'node:path';

const rootManuals = new Set(['AGENTS.md', 'README.md', 'MAKERS.md', 'BUILDERS.md', 'DEVELOPER-CONTEXT.md',
  'CONTRIBUTING.md', 'CONTRIBUTING-AGENTS.md', 'SETUP.md', 'GLOSSARY.md', 'DECISIONS.md', 'DEVLOG.md', 'build_request.md', 'CLAUDE.md', 'examples/prints/README.md']);
const documentRoots = new Set(['core', 'skills', 'studio', 'machines', 'adapters', 'scripts', 'maps']);
const excluded = new Set(['prints', 'node_modules', 'dist', 'build']);
const aliases = {
  makers: 'MAKERS.md', builders: 'BUILDERS.md', development: 'BUILDERS.md',
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

function headings(markdown) {
  const result = [], counts = new Map();
  let offset = 0, fence;
  for (const line of markdown.split(/(?<=\n)/)) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
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
        result.push({ title, anchor: count ? `${base}-${count}` : base, level: match[1].length, offset });
      }
    }
    offset += line.length;
  }
  return result;
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

export function guidanceSection(markdown, anchor) {
  if (!anchor) return markdown;
  const sections = headings(markdown), index = sections.findIndex(section => section.anchor === anchor);
  if (index < 0) throw new Error(`Unknown heading #${anchor}. Read the document for its headings.`);
  const section = sections[index], next = sections.slice(index + 1).find(item => item.level <= section.level);
  return markdown.slice(section.offset, next?.offset ?? markdown.length);
}

export async function readGuidance(root, guidanceId, seen = new Set()) {
  if(seen.has(guidanceId)||seen.size>8)throw new Error('Documentation redirect cycle.');
  seen.add(guidanceId);
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
  const markdown = await readFile(current, 'utf8');
  const redirect=/^<!-- saam-map-reference: (maps\/reference\/[a-z0-9-]+\.md) -->/.exec(markdown)?.[1];
  if(redirect) {
    const document=await readGuidance(root,redirect+(anchor?'#'+anchor:''),seen);
    return {...document,guidanceId,redirectedFrom:path};
  }
  const sections = headings(markdown);
  const text = guidanceSection(markdown, anchor);
  return { guidanceId, path, text, headings: sections.map(({ title, anchor }) => ({ title, guidanceId: `${path}#${anchor}` })),
    links: guidanceLinks(text, path), guidanceIds };
}
