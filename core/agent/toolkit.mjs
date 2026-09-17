// Small compositions of the owning manual, print and Studio APIs.
// Heavy geometry/Studio imports stay behind the commands that need them.
import {readFile, access} from 'node:fs/promises';
import {resolve, dirname, relative, isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {readGuidance} from './manuals.mjs';
import {SKILL_IDS} from '../../skills/catalog.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const developmentAreas = {
  geometry: ['maps/reference/geometry.md'], regions: ['maps/reference/regions.md'],
  path: ['maps/reference/motion.md'], print: ['maps/reference/lifecycle.md'],
  machine: ['maps/reference/machine.md', 'maps/reference/output.md'],
  studio: ['maps/reference/studio.md'], mcp: ['adapters/mcp/DEVELOP.md', 'adapters/mcp/README.md'],
  skills: ['skills/AUTHORING.md'], tests: ['maps/reference/testing.md'], setup: ['SETUP.md'], agent: ['maps/reference/agent.md']
};
const areaMaps = {geometry: ['3_geometry'], regions: ['4_regions'], path: ['5_motion'],
  print: ['1_lifecycle', '2_generation'], machine: ['6_output', '8_machine'], studio: ['7_studio'], agent: ['9_agent']};
const json = async path => JSON.parse(await readFile(path, 'utf8'));

export async function contextPacket(ids) {
  const documents = await Promise.all([...new Set(ids)].map(async id => {
    const {guidanceId, path, text, links} = await readGuidance(root, id);
    return {guidanceId, path, sha256: createHash('sha256').update(text).digest('hex'), text, links};
  }));
  return {documents};
}

async function environmentStatus() {
  const manifest = await json(resolve(root, 'package.json'));
  const missingDependencies = [];
  for (const name of Object.keys(manifest.dependencies)) {
    try {
      await access(fileURLToPath(import.meta.resolve(name === '@modelcontextprotocol/sdk'
        ? '@modelcontextprotocol/sdk/server/index.js' : name)));
    } catch { missingDependencies.push(name); }
  }
  return {node: process.version, nodeSupported: Number(process.versions.node.split('.')[0]) >= 22,
    missingDependencies, setupCheck: 'Not run by onboarding. Reuse prior evidence for this environment; follow SETUP.md on first use.',
    clientPermissions: 'Not inspected; follow studio/README.md#studio-agent-permissions.'};
}

export async function readSkill(id, {maker = false, builder = false, developer = false} = {}) {
  if (!SKILL_IDS.includes(id)) throw Error(`Unknown skill: ${id}. Known skills: ${SKILL_IDS.join(', ')}.`);
  const roles = {maker, builder, developer};
  if (!Object.values(roles).some(Boolean)) roles.maker = true;
  const files = {maker: 'SKILL.md', builder: 'BUILDER.md', developer: 'DEVELOPER.md'};
  const ids = [], unavailableRoles = [];
  for (const role of Object.keys(roles).filter(role => roles[role])) {
    const path = `skills/${id}/${files[role]}`;
    try { await access(resolve(root, path)); }
    catch (error) {
      if (error.code !== 'ENOENT' || role === 'maker') throw error;
      unavailableRoles.push(role);
      continue;
    }
    ids.push(path);
  }
  return {skillId: id, roles: Object.keys(roles).filter(role => roles[role]), unavailableRoles,
    ...await contextPacket(ids)};
}

export async function readMaps(keys, options = {}) {
  const {loadModel, regionContext} = await import('../../scripts/dev-map/model.mjs');
  const model = await loadModel(), regions = new Map();
  for (const key of keys) {
    const region = regionContext(model, key, options);
    regions.set(region.page, region);
  }
  return [...regions.values()];
}

export async function onboarding({role, areas = []}) {
  if (!['maker', 'builder', 'developer'].includes(role)) throw Error('Choose maker, builder or developer onboarding.');
  for (const area of areas) if (!Object.hasOwn(developmentAreas, area)) throw Error(`Unknown development area: ${area}.`);
  const areaIds = areas.filter(area=>!areaMaps[area]&&area!=='tests').flatMap(area => developmentAreas[area]);
  const ids = role === 'maker' ? ['MAKERS.md', 'skills/README.md', 'core/print/USAGE.md']
    : role === 'builder' ? ['BUILDERS.md', 'MAKERS.md', 'skills/README.md', 'core/print/USAGE.md', 'skills/AUTHORING.md', ...areaIds]
    : ['DEVELOPER-CONTEXT.md#orientation', 'BUILDERS.md', ...areaIds];
  const mapKeys = role === 'maker' ? [] : [...(role === 'developer'||areas.includes('tests') ? ['0_system'] : []), ...areas.flatMap(area => areaMaps[area] ?? [])];
  const [context, environment, maps] = await Promise.all([contextPacket(ids), environmentStatus(), mapKeys.length ? readMaps(mapKeys) : []]);
  return {role, environment, ...context, maps,
    nextStep: 'Reuse the returned context. For core or Studio, read the affected map page and its map-owned contract sections with read-map PAGE --section ID#heading. Use --inventory for file ownership and --evidence for detailed impact evidence. Skills and adapters keep separate authoring references; skill-only builders read consumed map contracts without implementation maps. Maker workflow and skill manuals are selective reads for developers.'};
}

function libraryPath(library) { return resolve(library ?? resolve(root, 'Prints')); }
function relativePrint(library, directory) {
  const id = relative(library, directory).replaceAll('\\', '/');
  if (!id || id === '..' || id.startsWith('../') || isAbsolute(id)) throw Error('Choose a print inside the selected --library directory.');
  return id;
}
function printSummary(state, {includeGeometry = false, programChecked = true} = {}) {
  const plan = structuredClone(state.plan);
  if (!includeGeometry) delete plan.geometry;
  return {directory: state.dir, kind: state.kind, revision: state.revision, geometryHash:state.geometryHash,
    plan, planComplete: includeGeometry,
    geometry: {boundsMm: state.geometry?.boundsMm, nativeFile: state.geometry?.nativeFile},
    machine: {id: state.machine.id, name: state.machine.name}, skills: state.skills,
    approvals: {geometry: state.geometryApproved, settings: state.planApproved,
      toolpath: programChecked ? state.toolpathApproved : null},
    generation: {record: state.review.generation, programChecked,
      current: programChecked ? Boolean(state.program) && !state.programError : null,
      programError: state.programError ?? null, summary: state.program?.summary ?? null},
    outputAvailability: state.outputAvailability ?? null,
    machineConfiguration: state.machineConfiguration ?? null, limitations: state.limitations};
}
async function readPrint(directory, options = {}) {
  const {bundleFor, readStableBundle} = await import('../../studio/server.mjs');
  const bundle = await bundleFor(directory);
  const {state} = await readStableBundle(bundle, directory, {program: options.programChecked === false ? false : 'source'});
  return printSummary(state, options);
}

export class ToolkitError extends Error {
  constructor(stage, error, partial) {
    super(error.message, {cause: error}); this.stage = stage; this.partial = partial;
  }
}

// The caller owns this live server. No detached process or global session registry.
export async function preview({command, target, library, recipe, stl, kind = 'shell', machine,
  units = 'auto', startAtLayer = 12, noOpen = false, onReady = () => {},onRequest=()=>{}}) {
  if (!['start-tour', 'open-print', 'create-preview'].includes(command)) throw Error('Unknown preview command.');
  if (kind !== 'shell') throw Error('Only shell/mesh prints are supported.');
  if (recipe && stl) throw Error('Choose either --recipe or --stl.');
  if (!['auto', 'mm', 'inch'].includes(units)) throw Error('Units must be auto, mm or inch.');
  if (!Number.isInteger(startAtLayer) || startAtLayer < 1) throw Error('Start layer must be a positive integer.');
  if (command !== 'start-tour' && !target) throw Error('Supply a print directory.');
  const libraryRoot = libraryPath(library), partial = {command},ownerId=randomUUID();
  const {createAgentRequests}=await import('../../studio/agent-requests.mjs');
  const agentRequests=createAgentRequests(libraryRoot,{ownerId});
  let stage = 'prepare', server,stopRequests=()=>{};
  try {
    const {bundleFor, createStudio, printDirectory} = await import('../../studio/server.mjs');
    const {createTour} = await import('../../studio/tour.mjs');
    const tour = createTour(libraryRoot,{ownerId,agentRequests});
    if (command === 'start-tour') {
      const fresh = await tour.action('fresh');
      partial.directory = fresh.directory;
      partial.created = true;
      await tour.setStartAt({layer: startAtLayer});
    } else if (command === 'create-preview') {
      partial.directory = resolve(target);
      relativePrint(libraryRoot, partial.directory);
      // Custom libraries also isolate remembered machine defaults, as MCP does.
      const setupFile = libraryRoot === resolve(root, 'Prints') ? undefined
        : resolve(libraryRoot, '.machine-setups', `${machine ?? 'ultimaker-s5'}.json`);
      const options = {machineId: machine, setupFile};
      if (stl) {
        const {importSTLBundle} = await import('../print/import-stl.mjs');
        await importSTLBundle(partial.directory, resolve(stl), {...options, units});
      } else {
        const adapter = await import('../print/bundle.mjs');
        await adapter.initBundle(partial.directory, recipe ? await json(resolve(recipe)) : undefined, options);
      }
      partial.created = true;
      partial.assumptions = {recipe: recipe ? resolve(recipe) : null, sourceSTL: stl ? resolve(stl) : null,
        setup: recipe ? 'Supplied recipe' : 'Compatible remembered setup, otherwise machine defaults'};
    } else partial.directory = await printDirectory(resolve(target));
    stage = 'read-print';
    // First-screen startup needs geometry, never slicing or program interpretation.
    const initial = await (await bundleFor(partial.directory)).loadBundle(partial.directory, {program: false});
    partial.print = printSummary(initial, {programChecked: false});
    if (stl) partial.assumptions.units = initial.plan.geometry.source;
    stage = 'launch-studio';
    server = createStudio(partial.directory, {libraryRoot,agentOwnerId:ownerId,agentRequests,closeAgentRequests:true});
    const session=server.agentSession();
    stopRequests=agentRequests.subscribe(request=>{
      if(request.source==='studio'&&request.studioInstanceId===session.instanceId)onRequest({studio:server.agentSession(),request});
    });
    server.once('close',stopRequests);
    await new Promise((done, reject) => {
      const failed = error => reject(error);
      server.once('error', failed);
      server.listen(0, '127.0.0.1', () => {server.off('error', failed); done();});
    });
    partial.studio = {url: `http://127.0.0.1:${server.address().port}`, pid: process.pid,
      directory: partial.directory,instanceId:session.instanceId,agentOwnerId:ownerId,browserOpenRequested: false};
    onReady({event: 'studio-ready', command, studio: {...partial.studio},
      nextStep: 'Open studio.url now with the client browser integration. Keep this managed command session alive; consume the result context after the viewer is open.'});
    stage = 'open-browser';
    if (!noOpen && process.env.SAAM_NO_AUTO_OPEN !== '1') {
      const {openBrowser} = await import('../../studio/browser.mjs');
      partial.studio.browserOpenRequested = await openBrowser(partial.studio.url);
    }
    stage = 'context';
    if (command === 'start-tour') {
      partial.tour = await tour.info();
      partial.listener = {mode:'live',event:'studio-request',studioInstanceId:session.instanceId,
        control:'Send newline-delimited JSON commands to this managed session stdin.',
        command:'wait-for-studio-request',library:libraryRoot,after:[],claim:true,waitMs:25000,
        fallback:{command:'wait-for-studio-request',library:libraryRoot,after:[],claim:true,waitMs:25000}};
      partial.context = await contextPacket(['MAKERS.md', 'examples/prints/README.md#maker-agent-participation']);
      partial.nextStep = 'Use the returned participation context directly; no maker-onboarding or repeated manual reads are needed. Keep the returned listener active, let Studio lead lesson one, and choose individual skill reads when an edit needs them.';
    } else {
      partial.print = await readPrint(partial.directory);
    }
    return {result: partial, server,agent:{requests:agentRequests,ownerId,session:server.agentSession}};
  } catch (error) {
    if (server) await server.shutdown();
    else agentRequests.close();
    if (partial.studio) partial.studio.closed = true;
    throw new ToolkitError(stage, error, partial);
  }
}

export async function beginWork({target, library, instruction, requestId, includeGeometry = false, kind = 'edit',requests:providedRequests,studioInstanceId,ownerId}) {
  const libraryRoot = libraryPath(library);
  const {createAgentRequests} = await import('../../studio/agent-requests.mjs');
  const requests = providedRequests??createAgentRequests(libraryRoot,{ownerId});
  let directory = target ? resolve(target) : null, record;
  if (requestId) {
    const existing = await requests.get(requestId);
    if (!existing) throw Error('Unknown Studio request.');
    if(studioInstanceId&&existing.studioInstanceId&&existing.studioInstanceId!==studioInstanceId)throw Error('That request belongs to another Studio instance.');
    if (directory && relativePrint(libraryRoot, directory) !== existing.printId) throw Error('That request belongs to another print.');
    if (!['queued', 'working', 'waiting', 'failed'].includes(existing.status)) throw Error('That request is no longer pending.');
    directory = resolve(libraryRoot, existing.printId);
    relativePrint(libraryRoot, directory);
    record = await requests.update(requestId, {status: 'working'});
  } else {
    if (!directory) {
      // Read only target identity before turning the indicator on.
      const progress = await json(resolve(libraryRoot, '.tour-progress.json'));
      if (!progress.active || !progress.selected) throw Error('No active tour print; supply its directory.');
      directory = resolve(libraryRoot, 'tour', progress.selected);
    }
    relativePrint(libraryRoot, directory);
    record = await requests.begin({directory, instruction, kind,studioInstanceId});
  }
  const partial = {request: record};
  try {
    partial.print = await readPrint(directory, {includeGeometry, programChecked:false});
    const {createTour} = await import('../../studio/tour.mjs');
    const tour = await createTour(libraryRoot).info();
    partial.tour = tour.directory === directory ? tour : null;
    return partial;
  } catch (error) {
    partial.request = await requests.update(record.id, {status: 'failed', message: error.message});
    throw new ToolkitError('read-work-context', error, partial);
  }
}

export async function waitForRequests({library, after = [], waitMs = 25000, claim = false,requests:providedRequests,studioInstanceId,ownerId}) {
  const {createAgentRequests} = await import('../../studio/agent-requests.mjs');
  const result = await (providedRequests??createAgentRequests(libraryPath(library),{ownerId})).wait({after, waitMs, claim,studioInstanceId});
  return {...result, after: [...new Set([...after, ...result.requests.map(request => request.id)])]};
}

export async function respondToRequest({library, requestId, status = 'completed', message = '', resultStage,requests:providedRequests,studioInstanceId,ownerId}) {
  if (!['working', 'completed', 'failed', 'cancelled', 'waiting'].includes(status)) throw Error('Choose working, completed, failed, cancelled or waiting.');
  if (resultStage && !['geometry', 'toolpath'].includes(resultStage)) throw Error('Choose geometry or toolpath for the result stage.');
  const {createAgentRequests} = await import('../../studio/agent-requests.mjs');
  const requests=providedRequests??createAgentRequests(libraryPath(library),{ownerId}),record=await requests.get(requestId);
  if(studioInstanceId&&record.studioInstanceId&&record.studioInstanceId!==studioInstanceId)throw Error('That request belongs to another Studio instance.');
  return requests.update(requestId, {status, message, resultStage});
}

export async function recordRequestActivity({library,requestId,target,requests:providedRequests,studioInstanceId,ownerId}){
  const {createAgentRequests}=await import('../../studio/agent-requests.mjs');
  const requests=providedRequests??createAgentRequests(libraryPath(library),{ownerId}),record=await requests.get(requestId);
  if(studioInstanceId&&record.studioInstanceId&&record.studioInstanceId!==studioInstanceId)throw Error('That request belongs to another Studio instance.');
  return requests.activity(requestId,{directory:target&&resolve(target)});
}

export async function inspectFailure({target, library, requestId, includeGeometry = false}) {
  const directory = resolve(target), libraryRoot = libraryPath(library);
  const {createAgentRequests} = await import('../../studio/agent-requests.mjs');
  const store=createAgentRequests(libraryRoot);
  const requests = (requestId?[await store.get(requestId)]:await store.list({printId:store.printId(directory)})).filter(record =>
    resolve(libraryRoot, record.printId) === directory && (!requestId || record.id === requestId));
  if (requestId && !requests.length) throw Error('That request does not belong to this print.');
  const result = {directory, requests};
  let skills;
  try {result.print = await readPrint(directory, {includeGeometry}); skills = result.print.skills;}
  catch (error) {
    // Preserve the validation failure and inspect the recipe even when it cannot load.
    result.validationError = error.message;
    try {
      const plan = await json(resolve(directory, 'plan.json'));
      skills = Object.keys(plan.skills ?? {});
      result.unvalidatedRecipe = {...plan};
      if (!includeGeometry) delete result.unvalidatedRecipe.geometry;
      result.planComplete = includeGeometry;
    } catch (readError) { result.recipeReadError = readError.message; }
  }
  result.context = await contextPacket(['core/print/USAGE.md#check-generate-and-deliver']);
  result.skillReferences = [...new Set(skills ?? [])].filter(id => SKILL_IDS.includes(id))
    .map(id => ({skillId: id, guidanceId: `skills/${id}/SKILL.md`, command: `read-skill ${id}`}));
  result.nextStep = 'Judge which skill limits and linked references explain this failure, then read the selected manuals individually before choosing a correction.';
  result.failureEvidence = 'Requests preserve Studio failure messages. CLI-only failures are not persisted; supply the original error alongside this report. Requests can describe earlier revisions.';
  return result;
}
