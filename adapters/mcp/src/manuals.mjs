// Read the repository's published Markdown through the same paths its links use.
import { lstat, readFile } from 'node:fs/promises';
import { resolve, posix } from 'node:path';

const rootManuals = new Set(['AGENTS.md', 'README.md', 'MAKERS.md', 'DEVELOP.md',
  'CONTRIBUTING.md', 'GETTING_STARTED.md', 'GLOSSARY.md', 'DECISIONS.md', 'build_request.md', 'CLAUDE.md']);
const documentRoots = new Set(['core', 'skills', 'studio', 'machines', 'materials', 'adapters', 'scripts']);
const excluded = new Set(['prints', 'node_modules', 'dist', 'build']);
const aliases = {
  makers: 'MAKERS.md', development: 'DEVELOP.md', 'getting-started': 'GETTING_STARTED.md', glossary: 'GLOSSARY.md',
  mcp: 'adapters/mcp/README.md', 'print-tools': 'core/print/USAGE.md',
  // Existing clients may retain these IDs; normal navigation follows file links.
  'wedge-generation': 'skills/wedge-demo/references/generation.md',
  'wedge-s5-export': 'skills/wedge-demo/references/s5-export.md'
};
export const guidanceIds = Object.keys(aliases).filter(id => !id.startsWith('wedge-'));

function publishedPath(path) {
  const parts = path.split('/');
  return path.endsWith('.md') && !/[\\:*?"<>|\x00-\x1f]/.test(path)
    && parts.every(part => part && !/^[.]|[. ]$/.test(part) && !excluded.has(part.toLowerCase())
      && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))
    && (parts.length === 1 ? rootManuals.has(path) : documentRoots.has(parts[0]));
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

function manualLinks(markdown, path) {
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

export async function readGuidance(root, guidanceId) {
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
  const sections = headings(markdown);
  let text = markdown;
  if (anchor) {
    const index = sections.findIndex(section => section.anchor === anchor);
    if (index < 0) throw new Error(`Unknown heading #${anchor} in ${path}. Read the document for its headings.`);
    const section = sections[index], next = sections.slice(index + 1).find(item => item.level <= section.level);
    text = markdown.slice(section.offset, next?.offset ?? markdown.length);
  }
  return { guidanceId, path, text, headings: sections.map(({ title, anchor }) => ({ title, guidanceId: `${path}#${anchor}` })),
    links: manualLinks(text, path), guidanceIds };
}
