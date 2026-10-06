import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { checkSkillDigest } from './skill-digest.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const excluded = new Set(['.git', '.claude', '.local', '.saam', 'Prints', 'node_modules', 'dist', 'build']);
// Dated records of past work name the files as they were then; their targets are not required
// to still exist, and the records are never rewritten to keep a link alive.
const historical = new Set(['DEVLOG.md', 'DECISIONS.md']);
const documents = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (excluded.has(entry.name) || (dir === root && entry.name.toLowerCase() === 'prints')) continue;
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (entry.isFile() && entry.name.endsWith('.md')) documents.push(path);
  }
}
await walk(root);
const errors = [];
try { await checkSkillDigest(root); }
catch (error) { errors.push(error.message); }
const checked = {links: 0};
const anchors = markdown => {
  const result=new Set(),counts=new Map();
  let fenced=false;
  for(const line of markdown.split(/\r?\n/)) {
    if(/^\s*```|^\s*~~~/.test(line)){fenced=!fenced;continue;}
    if(fenced)continue;
    const heading=/^#{1,6}\s+(.+?)(?:\s+#+)?$/.exec(line);
    if(!heading)continue;
    const base=heading[1].toLowerCase().replace(/<[^>]*>/g,'').replace(/[^\p{L}\p{N}_\-\s]/gu,'').replace(/\s/g,'-');
    const count=counts.get(base)??0;counts.set(base,count+1);
    result.add(count?`${base}-${count}`:base);
  }
  return result;
};
for (const path of documents) {
  // Code is quoted, not linked: fenced blocks and inline code spans are skipped.
  const markdown = (await readFile(path, 'utf8')).replace(/^\s*(```|~~~)[\s\S]*?^\s*\1/gm,'').replace(/`[^`\n]*`/g,'');
  for (const match of markdown.matchAll(/\]\(([^)]+)\)/g)) {
    const [target,fragment] = match[1].split('#');
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    checked.links++;
    if (historical.has(relative(root, path))) continue;
    const resolved = target ? resolve(dirname(path), decodeURIComponent(target)) : path;
    if (!resolved.startsWith(root + sep)) errors.push(`${relative(root,path)}: link escapes repository: ${target}`);
    else try {
      await stat(resolved);
      if(fragment&&resolved.endsWith('.md')&&!anchors(await readFile(resolved,'utf8')).has(decodeURIComponent(fragment)))
        errors.push(`${relative(root,path)}: missing heading ${match[1]}`);
    } catch { errors.push(`${relative(root,path)}: missing link ${target}`); }
  }
}
const decisions = await readFile(resolve(root, 'DECISIONS.md'), 'utf8');
const entries = decisions.split(/(?=^## D-\d+)/m).slice(1);
const ids = entries.map(entry => entry.match(/^## (D-\d+)/)?.[1]);
if (!entries.length) errors.push('No decision records found.');
if (new Set(ids).size !== ids.length) errors.push('Duplicate decision IDs.');
for (const entry of entries) {
  const id = entry.match(/^## (D-\d+)/)?.[1];
  for (const reference of entry.matchAll(/(?:Supersedes: |superseded by )(D-\d+)/g)) {
    if (!ids.includes(reference[1])) errors.push(`${id}: unknown replacement ${reference[1]}.`);
  }
}
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding:'utf8' }).split('\0').filter(Boolean);
const privateFiles = tracked.filter(path => /^(Prints|\.local|\.saam)\//i.test(path));
if (privateFiles.length) errors.push('Personal files tracked: '+privateFiles.join(', '));
for (const example of ['Prints/check/plan.json', 'prints/check/plan.json', '.local/architecture-map/index.html', '.saam/session.json']) {
  try { execFileSync('git', ['check-ignore', '--no-index', '-q', example], { cwd:root }); }
  catch { errors.push('Missing ignore rule for '+example); }
}
try {
  execFileSync('git', ['check-ignore', '--no-index', '-q', 'examples/prints/README.md'], { cwd:root });
  errors.push('Curated examples must not be ignored.');
} catch (error) {
  if (error.status !== 1) errors.push('Could not check curated-example visibility.');
}
// Tolerance literals: a raw small number in code outside core/dimensions.mjs is a
// tolerance that does not name its class (core/README.md#dimensions-and-tolerances).
// Counts per file may only fall; --write-tolerance-baseline records lower counts.
const toleranceLiteral = /(?<![\w.])(?:\d+(?:\.\d+)?e-\d+|0?\.00\d+)(?![\w.])|Number\.EPSILON/g;
const toleranceFiles = tracked.filter(path => /^(core|studio|skills|packaging)\/.*\.(mjs|js|cpp)$/.test(path)
  && !/(^|\/)tests?\/|\.test\.mjs$/.test(path) && path !== 'core/dimensions.mjs');
const toleranceCounts = {};
for (const path of toleranceFiles) {
  const code = (await readFile(resolve(root, path), 'utf8')).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  const count = code.match(toleranceLiteral)?.length ?? 0;
  if (count) toleranceCounts[path] = count;
}
const toleranceBaselinePath = resolve(root, 'scripts/tolerance-literals.json');
if (process.argv.includes('--write-tolerance-baseline')) {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(toleranceBaselinePath, JSON.stringify(toleranceCounts, null, 1) + '\n');
} else {
  const baseline = JSON.parse(await readFile(toleranceBaselinePath, 'utf8'));
  for (const [path, count] of Object.entries(toleranceCounts)) if (count > (baseline[path] ?? 0))
    errors.push(`Raw tolerance literal in ${path} (${count} > baseline ${baseline[path] ?? 0}): use a class from core/dimensions.mjs or derive it from the print's dimensions.`);
  for (const [path, count] of Object.entries(baseline)) if ((toleranceCounts[path] ?? 0) < count)
    errors.push(`Tolerance literals in ${path} fell to ${toleranceCounts[path] ?? 0}; run node scripts/check-repo.mjs --write-tolerance-baseline.`);
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Checked ${documents.length} documents, ${checked.links} local links (dated records excepted), ${entries.length} decision records, skill digest freshness and coverage, and private-file exclusions.`);
  console.log('Repository checks only; manufacturing software tests run separately and do not establish physical print success.');
}
