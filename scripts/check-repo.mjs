import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const excluded = new Set(['.git', '.local', '.saam', 'Prints', 'node_modules', 'dist', 'build']);
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
let links = 0;
for (const path of documents) {
  const markdown = await readFile(path, 'utf8');
  for (const match of markdown.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    links++;
    const resolved = resolve(dirname(path), decodeURIComponent(target));
    if (!resolved.startsWith(root + sep)) errors.push(`${relative(root,path)}: link escapes repository: ${target}`);
    else try { await stat(resolved); } catch { errors.push(`${relative(root,path)}: missing link ${target}`); }
  }
}
const decisions = await readFile(resolve(root, 'DECISIONS.md'), 'utf8');
const entries = decisions.split(/(?=^## D-\d+)/m).slice(1);
const ids = entries.map(entry => entry.match(/^## (D-\d+)/)?.[1]);
if (!entries.length) errors.push('No decision records found.');
if (new Set(ids).size !== ids.length) errors.push('Duplicate decision IDs.');
for (const entry of entries) {
  const id = entry.match(/^## (D-\d+)/)?.[1];
  const status = entry.match(/^- Status: (.+)$/m)?.[1];
  if (!/^(proposed|provisional|accepted|superseded|rejected|withdrawn)(?:\b|$)/.test(status ?? '')) errors.push(`${id}: missing/unknown status.`);
  for (const field of ['Decision', 'Recorded', 'Approvals', 'Source']) {
    if (!new RegExp(`^- ${field}: .+`, 'm').test(entry)) errors.push(`${id}: missing ${field}.`);
  }
  const recorded = entry.match(/^- Recorded: (.+)$/m)?.[1];
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(recorded ?? '') || !Number.isFinite(Date.parse(recorded))) errors.push(`${id}: invalid recording timestamp.`);
  if (status === 'accepted') {
    const approvals = entry.match(/^- Approvals: (.+)$/m)?.[1] ?? '';
    if (!approvals.includes('remettub') || !approvals.includes('tkeller') || approvals.includes('not recorded')) errors.push(`${id}: accepted without both recorded approvals.`);
  }
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
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Checked ${documents.length} documents, ${links} local links, ${entries.length} decision records, and private-file exclusions.`);
  console.log('These are repository checks. No manufacturing runtime is implemented.');
}
