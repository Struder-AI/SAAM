// Source context assembly and map reads; making belongs to the application.
// No Studio, chat, live-work or release-service lifetime is created here.
import {readFile, access} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readManual} from './manuals.mjs';
import {ONBOARDING,extensionDiscovery} from './layers.mjs';
import {SKILL_IDS, GUIDANCE_IDS, EXTENSION_IDS,BUILDER_IDS} from '../../skills/catalog.mjs';
import {readExtension} from '../extensions/library.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// Areas outside the map: skills, application, setup, the tests and this toolkit are not mapped, so
// they have their own guidance. An `--area` value that names no manual area is a map target: a
// node's index or declaration path.
export const outsideAreas = {
  application: ['core/application/README.md'],
  skills: ['skills/AUTHORING.md'], setup: ['SETUP.md'],
  'core/agent': ['core/agent/README.md']
};
// One prose manual per component, beside the code it describes. A builder gets the manual for the
// area it names; a developer gets none bundled, because the map and DEVELOPER-CONTEXT are the
// developer's orientation.
export const componentManuals = {
  core: ['core/README.md'],
  'core/export': ['core/export/README.md'], 'core/geom': ['core/geom/README.md'],
  'core/machine': ['core/machine/README.md', 'machines/README.md'],
  'core/path': ['core/path/README.md'], 'core/print': ['core/print/README.md'],
  'core/region': ['core/region/README.md'],
  studio: ['studio/README.md', 'studio/KINEMATICS.md', 'studio/RENDERING.md'],
  tests: ['core/tests/README.md'] // the tests are documented, but they are not a region of the map
};
export const developmentAreas = {...outsideAreas, ...componentManuals};
const json = async path => JSON.parse(await readFile(path, 'utf8'));

// Manuals as this command-line agent reads them: script sections included, advanced ones for
// the named machine (see manuals.mjs#assembleGuidance).
export async function contextPacket(ids, context = {}) {
  const documents=await Promise.all([...new Set(ids)].map(id => readManual(root, id, {client: 'script', ...context})));
  if(ids.includes('skills/DIGEST.md')){
    const discovery=await extensionDiscovery(root,{readTool:'read-skill',openTool:'saam call open_workspace'});
    if(discovery)documents.push(discovery);
  }
  return {documents};
}

// What of main this checkout holds, for the one-line report a maker or builder gives at session
// start. It fetches main first so the count is current; offline it counts against the last fetch.
export async function syncStatus() {
  const git = async (...args) => (await promisify(execFile)('git', args,
    {cwd: root, timeout: 15000, env: {...process.env, GIT_TERMINAL_PROMPT: '0'}})).stdout.trim();
  const fetched = await git('fetch', '--quiet', 'origin', 'main').then(() => true, () => false);
  try {
    const [branch, commit, base] = await Promise.all([git('branch', '--show-current'),
      git('rev-parse', '--short', 'HEAD'), git('merge-base', 'HEAD', 'origin/main')]);
    const [[baseCommit, baseDate], ahead] = await Promise.all([
      git('log', '-1', '--format=%h %cs', base).then(line => line.split(' ')),
      git('rev-list', '--count', 'HEAD..origin/main').then(Number)]);
    return {branch, commit, mainIncluded: {commit: baseCommit, date: baseDate}, mainAhead: ahead, fetched,
      summary: `${branch || 'Detached HEAD'} at ${commit} includes main through ${baseCommit} (${baseDate}); `
        + `main has ${ahead} newer commit${ahead === 1 ? '' : 's'}${fetched ? '' : ' as of the last fetch (fetch failed)'}.`};
  } catch (error) { return {fetched, error: error.message.split('\n')[0]}; }
}

async function environmentStatus() {
  const manifest = await json(resolve(root, 'package.json'));
  const missingDependencies = [];
  for (const name of Object.keys(manifest.dependencies)) {
    try {
      await access(fileURLToPath(import.meta.resolve(name)));
    } catch { missingDependencies.push(name); }
  }
  return {node: process.version, nodeSupported: Number(process.versions.node.split('.')[0]) >= 22,
    missingDependencies, sync: await syncStatus(), setupCheck: 'Not run by onboarding. Reuse prior evidence for this environment; follow SETUP.md on first use.',
    clientPermissions: 'Not inspected; follow studio/README.md#studio-agent-permissions.'};
}

// `ID#heading` reads one section of the maker manual, whatever its gate.
export async function readSkill(name, {maker = false, builder = false, developer = false, machine: machineId, all = false} = {}) {
  const [id, anchor] = name.split('#');
  const extension=await readExtension(id,{appRoot:root});
  if (!SKILL_IDS.includes(id)&&!GUIDANCE_IDS.includes(id)&&!extension&&!BUILDER_IDS.includes(id)) throw Error(`Unknown skill or guidance manual: ${id}. Use the catalog to find installed extensions.`);
  if (anchor && (builder || developer)) throw Error('A #heading reads the maker manual; drop --builder and --developer.');
  if(BUILDER_IDS.includes(id)&&maker)throw Error(`${id} is builder context; import and repair are handled by the ordinary maker lifecycle.`);
  const roles = {maker, builder:builder||BUILDER_IDS.includes(id), developer};
  if (!Object.values(roles).some(Boolean)) roles.maker = true;
  const files = {maker: 'SKILL.md', builder: 'BUILDER.md', developer: 'DEVELOPER.md'};
  const ids = [], unavailableRoles = [];
  for (const role of Object.keys(roles).filter(role => roles[role])) {
    const path = `${extension?'extensions':'skills'}/${id}/${files[role]}`;
    try { if(extension){if(!extension.files.some(file=>file.path===files[role])){const error=new Error('Missing optional manual.');error.code='ENOENT';throw error;}}else await access(resolve(root, path)); }
    catch (error) {
      if (error.code !== 'ENOENT' || role === 'maker') throw error;
      unavailableRoles.push(role);
      continue;
    }
    ids.push(path);
  }
  const documents = await Promise.all(ids.map(path => path.endsWith('/SKILL.md')
    ? readManual(root, anchor ? `${path}#${anchor}` : path, {client: 'script', machineId, all})
    : readManual(root, path, {all: true})));
  return {skillId: id, roles: Object.keys(roles).filter(role => roles[role]), unavailableRoles, documents};
}

// Map-set selection belongs to each command. A separate CLI process keeps its
// process-wide set configuration from leaking between reads of different sets.
export const developerMapSet = '030-architecture';
async function mapCommand(set, command, args = []) {
  const {stdout} = await promisify(execFile)(process.execPath,
    [resolve(root, 'dev-map/cli.mjs'), command, ...args, '--set', set], {cwd: root, maxBuffer: 32 * 1024 * 1024});
  return {mapSet: set, ...JSON.parse(stdout)};
}

// Design addresses name nodes/contracts; scanned addresses name declarations.
// Reads never scan. Select `default` explicitly for the original implementation map.
export async function readMaps(keys, options = {}) {
  return Promise.all(keys.map(key => mapCommand(options.set ?? developerMapSet, 'read',
    [key])));
}

// Design regeneration redraws authored maps; its implementation audit is separate.
export async function regenerateMap(index, {set = developerMapSet} = {}) {
  return mapCommand(set, 'regenerate', index ? [index] : []);
}

// Three roles, three readings. A maker reads prose and no map. A builder reads prose — its own
// manual, skill authoring and the component manual for the area — and may walk the map. A
// developer reads shared terms, the full developer context and map `0`; component manuals open as needed.
// A maker's manuals open by client and machine; a builder's and developer's are read whole.
export async function onboarding({role, areas = [], machine: machineId, set = developerMapSet}) {
  if (!['maker', 'builder', 'developer'].includes(role)) throw Error('Choose maker, builder or developer onboarding.');
  const outside = areas.filter(area => Object.hasOwn(outsideAreas, area));
  const targets = [...new Set(areas.filter(area => !Object.hasOwn(developmentAreas, area)))];
  const builderAreaIds = [...new Set(areas.flatMap(area => developmentAreas[area] ?? []))];
  const ids = role === 'maker' ? ONBOARDING
    : role === 'builder' ? ['BUILDERS.md', ...ONBOARDING, 'skills/AUTHORING.md', ...builderAreaIds]
    : ['GLOSSARY.md', 'DEVELOPER-CONTEXT.md', ...new Set(outside.flatMap(area => outsideAreas[area]))];
  const mapKeys = role === 'maker' ? [] : [...(role === 'developer' ? ['0'] : []), ...targets];
  const [context, environment, maps] = await Promise.all([contextPacket(ids, role === 'maker' ? {machineId} : {all: true}),
    environmentStatus(), mapKeys.length ? readMaps(mapKeys, {set}) : []]);
  return {role, environment, ...context, maps, ...(mapKeys.length ? {mapSet: set} : {}),
    nextStep: role === 'maker' ? 'Tell the person environment.sync.summary in one line. Reuse the returned context and choose individual skill manuals when an edit needs them. The digest indexes gated sections; read one by name when its gate applies.'
      : role === 'builder' ? 'Tell the person environment.sync.summary in one line. Reuse the returned context. Builders author guidance, recipe helpers, assets, examples and diagnostics using published APIs. Core skills and shared capability/contract changes require the developer role. The component manual for the area you consume owns its behaviour, contracts and limits; read the one for the code you touch. The dev maps own structure: walk them from 0, or from a node you name with --area, for what calls what, with read-map ADDRESS. Maps give source ranges for direct file reads; run regenerate [INDEX] after an edit. Skills keep their own authoring references.'
      : `Focus next work on plans/0.3.2.md; plans/0.3.1.md retains inherited contracts. Reuse this developer context. Continue in map set ${set}: pass --set ${set} to map commands. 0.3.2 retains 030-architecture for product work and 030-deployment for installation/service work, including installed-release selection. Map reads return visible relationships and source locations, never code. Read files at those ranges only for implementation internals; leaf addresses are not map reads. Link/contract addresses return complete interfaces. Design maps express intent, not proven implementation; the original scanned map requires --set default. Design regenerate redraws; audit and audit-check assess implementation and freshness. Open component manuals as needed.`};
}
