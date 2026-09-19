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
  if (options.generated) {
    if (options.section || options.node || options.inventory) throw Error('--generated accepts only --evidence and --tests.');
    const {loadProjection, generatedContext, importingTests} = await import('../../scripts/dev-map/projection.mjs');
    const projection = await loadProjection();
    return Promise.all(keys.map(async key => ({...generatedContext(projection, key, options), ...(options.tests ? {tests: await importingTests(projection, key)} : {})})));
  }
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
    toolpathApproved: programChecked ? state.toolpathApproved : null,
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

// Resolve or create the print a preview command names; shared by a fresh launch
// and a switch of the print shown in an already-owned Studio.
async function preparePrint({command, target, libraryRoot, recipe, stl, machine, units, partial}) {
  if (command === 'create-preview') {
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
  } else {
    const {printDirectory} = await import('../../studio/server.mjs');
    partial.directory = await printDirectory(resolve(target));
  }
}
function validatePreview({command, target, recipe, stl, kind, units}) {
  if (kind !== 'shell') throw Error('Only shell/mesh prints are supported.');
  if (recipe && stl) throw Error('Choose either --recipe or --stl.');
  if (!['auto', 'mm', 'inch'].includes(units)) throw Error('Units must be auto, mm or inch.');
  if (command !== 'start-tour' && !target) throw Error('Supply a print directory.');
}
const reuseGuidance = studio => ({default: 'Reuse this Studio and its browser tab to show another print; launch another instance only when the person asks, or for a compelling reason you state to them.',
  command: `node scripts/agent-toolkit.mjs open-print|create-preview DIRECTORY --studio ${studio.url} --agent-owner ${studio.agentOwnerId}`,
  live: 'This managed session also accepts {"command":"open-print"|"create-preview","target":DIRECTORY} on stdin.'});

// Show another print in an already-owned Studio: `open` is the live server's
// serialized openPrint, or absent to reach the Studio URL from another process.
export async function showPrint({command, target, library, recipe, stl, kind = 'shell', machine, units = 'auto', studio, ownerId, open}) {
  if (!['open-print', 'create-preview'].includes(command)) throw Error('Only open-print and create-preview reuse a Studio.');
  validatePreview({command, target, recipe, stl, kind, units});
  if (!open && !studio) throw Error('Supply the Studio URL from studio-ready.');
  if (!open && !ownerId) throw Error('Supply the agent owner ID (agentOwnerId from studio-ready) with --agent-owner.');
  const partial = {command};
  let stage = 'prepare';
  try {
    await preparePrint({command, target, libraryRoot: libraryPath(library), recipe, stl, machine, units, partial});
    stage = 'open-in-studio';
    if (open) partial.studio = {...await open(partial.directory), reused: true};
    else {
      const response = await fetch(new URL('/api/agent-open', studio), {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({owner: ownerId, path: partial.directory})}), body = await response.json();
      if (!response.ok) throw Error(body.error ?? 'Studio refused to open the print.');
      partial.studio = {url: new URL(studio).origin, instanceId: body.instanceId, agentOwnerId: body.ownerId, directory: body.directory, reused: true};
    }
    stage = 'context';
    if (stl) partial.assumptions.units = (await readPrint(partial.directory, {includeGeometry: true, programChecked: false})).plan.geometry.source;
    partial.print = await readPrint(partial.directory);
    return partial;
  } catch (error) {throw new ToolkitError(stage, error, partial);}
}

// The caller owns this live server. No detached process or global session registry.
export async function preview({command, target, library, recipe, stl, kind = 'shell', machine,
  units = 'auto', startAtLayer = 12, noOpen = false, ownerId: resumeOwner, onReady = () => {},onRequest=()=>{},onEvents=()=>{}}) {
  if (!['start-tour', 'open-print', 'create-preview'].includes(command)) throw Error('Unknown preview command.');
  validatePreview({command, target, recipe, stl, kind, units});
  if (!Number.isInteger(startAtLayer) || startAtLayer < 1) throw Error('Start layer must be a positive integer.');
  if (command !== 'start-tour' && !target) throw Error('Supply a print directory.');
  // A relaunch may resume the agent owner it reports in studio-ready, so the
  // requests and events of the previous run stay visible to the same agent.
  // It always mints a fresh instance; it never attaches to a running server.
  if(resumeOwner!==undefined&&!/^[A-Za-z0-9_-]{8,200}$/.test(resumeOwner))
    throw Error('--agent-owner must be the agentOwnerId reported by an earlier studio-ready line.');
  const libraryRoot = libraryPath(library), partial = {command},ownerId=resumeOwner??randomUUID();
  const {createAgentRequests}=await import('../../studio/agent-requests.mjs');
  const {createStudioEvents}=await import('../../studio/studio-events.mjs');
  const studioEvents=createStudioEvents();
  const agentRequests=createAgentRequests(libraryRoot,{ownerId,events:studioEvents});
  let stage = 'prepare', server,stopRequests=()=>{},stopEvents=()=>{};
  try {
    const {bundleFor, createStudio} = await import('../../studio/server.mjs');
    const {createTour} = await import('../../studio/tour.mjs');
    const tour = createTour(libraryRoot,{ownerId,agentRequests});
    if (command === 'start-tour') {
      const fresh = await tour.action('fresh');
      partial.directory = fresh.directory;
      partial.created = true;
      await tour.setStartAt({layer: startAtLayer});
    } else await preparePrint({command, target, libraryRoot, recipe, stl, machine, units, partial});
    stage = 'read-print';
    // First-screen startup needs geometry, never slicing or program interpretation.
    const initial = await (await bundleFor(partial.directory)).loadBundle(partial.directory, {program: false});
    partial.print = printSummary(initial, {programChecked: false});
    if (stl) partial.assumptions.units = initial.plan.geometry.source;
    stage = 'launch-studio';
    server = createStudio(partial.directory, {libraryRoot,agentOwnerId:ownerId,agentRequests,closeAgentRequests:true,studioEvents});
    const session=server.agentSession();
    stopRequests=agentRequests.subscribe(request=>{
      if(request.source==='studio'&&request.studioInstanceId===session.instanceId)onRequest({studio:server.agentSession(),request});
    });
    server.once('close',stopRequests);
    stopEvents=studioEvents.subscribe(events=>onEvents({studio:server.agentSession(),events}));
    server.once('close',()=>{stopEvents();studioEvents.close();});
    await new Promise((done, reject) => {
      const failed = error => reject(error);
      server.once('error', failed);
      server.listen(0, '127.0.0.1', () => {server.off('error', failed); done();});
    });
    partial.studio = {url: `http://127.0.0.1:${server.address().port}`, pid: process.pid,
      directory: partial.directory,instanceId:session.instanceId,agentOwnerId:ownerId,browserOpenRequested: false};
    partial.reuse = reuseGuidance(partial.studio);
    onReady({event: 'studio-ready', command, studio: {...partial.studio},
      nextStep: 'Open studio.url now with the client browser integration. Keep this managed command session alive; consume the result context after the viewer is open.'});
    stage = 'open-browser';
    if (!noOpen && process.env.SAAM_NO_AUTO_OPEN !== '1') {
      const {openBrowser} = await import('../../studio/browser.mjs');
      partial.studio.browserOpenRequested = await openBrowser(partial.studio.url);
    }
    stage = 'context';
    partial.listener = {mode:'live',event:'studio-request',events:'studio-events',studioInstanceId:session.instanceId,agentOwnerId:ownerId,
      control:'Send newline-delimited JSON commands to this managed session stdin: read-studio-events returns and clears queued Studio events with calculation progress; wait-for-studio-request waits on requests and delivered events.',
      command:'wait-for-studio-request',library:libraryRoot,after:[],claim:true,waitMs:25000,
      fallback:{command:'wait-for-studio-request',studio:partial.studio.url,agentOwner:ownerId,library:libraryRoot,after:[],claim:true,waitMs:25000,
        read:{command:'read-studio-events',studio:partial.studio.url,agentOwner:ownerId}}};
    if (command === 'start-tour') {
      partial.tour = await tour.info();
      partial.context = await contextPacket(['MAKERS.md', 'examples/prints/README.md#maker-agent-participation']);
      partial.nextStep = 'Use the returned participation context directly; no maker-onboarding or repeated manual reads are needed. Keep the returned listener active, let Studio lead lesson one, and choose individual skill reads when an edit needs them.';
    } else {
      partial.print = await readPrint(partial.directory);
    }
    return {result: partial, server,agent:{requests:agentRequests,events:studioEvents,ownerId,session:server.agentSession}};
  } catch (error) {
    if (server) await server.shutdown();
    else {agentRequests.close();studioEvents.close();}
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

// A live Studio URL serves the owning agent's event queue across processes; the
// JSON journal alone carries neither Studio events nor calculation progress.
async function pollStudio({studio,ownerId,waitMs=0,instance,after=[],history=false}){
  if(!studio)throw Error('Supply the Studio URL from studio-ready.');
  if(!ownerId)throw Error('Supply the agent owner ID (agentOwnerId from studio-ready) with --agent-owner.');
  const params=new URLSearchParams({owner:ownerId,wait:String(Math.min(25000,Math.max(0,waitMs)))});
  if(instance)params.set('instance',instance);if(after.length)params.set('after',after.join(','));if(history)params.set('history','1');
  const response=await fetch(new URL('/api/agent-events?'+params,studio)),body=await response.json();
  if(!response.ok)throw Error(body.error??'Studio refused the event read.');
  return body;
}
export async function waitForRequests({library, after = [], waitMs = 25000, claim = false,requests:providedRequests,studioInstanceId,ownerId,studio,server}) {
  const {createAgentRequests} = await import('../../studio/agent-requests.mjs');
  let result;
  if(studio&&!providedRequests){
    const polled=await pollStudio({studio,ownerId,waitMs,instance:studioInstanceId,after});
    const queued=polled.requests.filter(request=>!after.includes(request.id));
    const store=claim&&queued.length?createAgentRequests(libraryPath(library),{ownerId}):null;
    result={requests:store?await Promise.all(queued.map(request=>store.update(request.id,{status:'working'}))):queued,events:polled.events,generation:polled.generation};
  } else {
    result = await (providedRequests??createAgentRequests(libraryPath(library),{ownerId})).wait({after, waitMs, claim,studioInstanceId});
    if(server)result.generation=[server.generationStatus()].filter(Boolean);
  }
  return {...result, after: [...new Set([...after, ...result.requests.map(request => request.id)])]};
}

export async function readStudioEvents({studio,ownerId,waitMs=0,history=false,events,server}){
  if(events)return {events:events.drain(),generation:server?[server.generationStatus()].filter(Boolean):[],...(history?{recent:events.history()}:{})};
  const polled=await pollStudio({studio,ownerId,waitMs,history});
  return {events:polled.events,generation:polled.generation,...(history?{recent:polled.recent}:{})};
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
