import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { checkSkillDigest } from './skill-digest.mjs';

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
// Build requests are an open-work queue; completed records belong in DEVLOG.md.
function checkBuildRequests(markdown) {
  markdown = markdown.replace(/\r\n/g, '\n');
  const issues = [];
  const requestIds = new Set();
  if (!/^## Outstanding work\s*$/m.test(markdown)) issues.push('Missing outstanding-work section.');
  for (const heading of markdown.matchAll(/^#{1,6} (.+)$/gm)) {
    if (!/^(?:# Build requests|## Outstanding work|### BR-\d+ — .+)$/.test(heading[0]))
      issues.push(`Unexpected heading: ${heading[0]}. Work records belong in DEVLOG.md.`);
  }
  for (const entry of markdown.split(/(?=^### BR-\d+ — )/m).slice(1)) {
    const id = entry.match(/^### (BR-\d+)/)[1];
    if (requestIds.has(id)) issues.push(`Duplicate request ${id}.`);
    requestIds.add(id);
    const statuses = [...entry.matchAll(/^- Status: (.*)$/gm)];
    if (statuses.length !== 1 || !/^(?:open|in progress|blocked)$/.test(statuses[0][1]))
      issues.push(`${id}: use an open status; move completed records to DEVLOG.md.`);
    for (const field of ['Remaining', 'Completion', 'Context']) {
      if (!new RegExp(`^- ${field}: \\S.+`, 'm').test(entry)) issues.push(`${id}: missing ${field}.`);
    }
  }
  for (const field of markdown.matchAll(/^- ([A-Za-z][A-Za-z -]*):/gm)) {
    if (!['Status', 'Remaining', 'Completion', 'Context', 'Source'].includes(field[1]))
      issues.push(`Work-record or unknown field ${field[1]}; keep historical evidence in DEVLOG.md.`);
  }
  return issues;
}
const requests = await readFile(resolve(root, 'build_request.md'), 'utf8');
errors.push(...checkBuildRequests(requests).map(issue => `build_request.md: ${issue}`));
if (!documents.includes(resolve(root, 'DEVLOG.md'))) errors.push('Missing DEVLOG.md work-history owner.');
try { await checkSkillDigest(root); }
catch (error) { errors.push(error.message); }
let links = 0;
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
  const markdown = await readFile(path, 'utf8');
  for (const match of markdown.matchAll(/\]\(([^)]+)\)/g)) {
    const [target,fragment] = match[1].split('#');
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    links++;
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
  console.log(`Checked ${documents.length} documents, ${links} local links, ${entries.length} decision records, open build-request structure, devlog presence, skill digest freshness and coverage, and private-file exclusions.`);
  console.log('Repository checks only; manufacturing software tests run separately and do not establish physical print success.');
}
