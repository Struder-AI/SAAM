// Small compositions of the owning manual, print and Studio APIs.
// Heavy geometry/Studio imports stay behind the commands that need them.
import {readFile, access} from 'node:fs/promises';
import {resolve, dirname, relative, isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import {readGuidance} from './manuals.mjs';
import {SKILL_IDS} from '../../skills/catalog.mjs';
import {lifecycleReview} from '../print/review-state.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// Areas outside the map: skills, adapters, setup, the tests and this toolkit are not mapped, so
// they have their own guidance. An `--area` value that names no manual area is a map target: a
// node's index or declaration path.
export const outsideAreas = {
  mcp: ['adapters/mcp/DEVELOP.md', 'adapters/mcp/README.md'],
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

export async function contextPacket(ids) {
  const documents = await Promise.all([...new Set(ids)].map(async id => {
    const {guidanceId, path, text, links} = await readGuidance(root, id);
    return {guidanceId, path, sha256: createHash('sha256').update(text).digest('hex'), text, links};
  }));
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
      await access(fileURLToPath(import.meta.resolve(name === '@modelcontextprotocol/sdk'
        ? '@modelcontextprotocol/sdk/server/index.js' : name)));
    } catch { missingDependencies.push(name); }
  }
  return {node: process.version, nodeSupported: Number(process.versions.node.split('.')[0]) >= 22,
    missingDependencies, sync: await syncStatus(), setupCheck: 'Not run by onboarding. Reuse prior evidence for this environment; follow SETUP.md on first use.',
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

// One page of the stored map per key: an index, or the declaration path that index is for.
// The read never scans. --code returns source; --details retains scanner evidence.
export async function readMaps(keys, options = {}) {
  const {readGenerated, readCode} = await import('../../dev-map/lib/store.mjs');
  const {compactPage, detailedPage} = await import('../../dev-map/lib/agent-view.mjs');
  // --details is the same page the map draws, with the stored evidence kept under it.
  return Promise.all(keys.map(async key => {
    const page = await (options.code ? readCode(key) : readGenerated(key));
    return options.details ? detailedPage(page) : compactPage(page, options);
  }));
}

// Scanning is a choice, and this is the only command that makes it. With no index, or `0`, it
// generates everything; an index is accepted and generates everything too, since any change can
// move what nests where.
export async function regenerateMap() {
  const {generate} = await import('../../dev-map/lib/store.mjs');
  const result = await generate();
  // The person's viewer follows every regenerate, so it always shows the latest stored map.
  const {drawView} = await import('../../dev-map/lib/generated-view.mjs');
  return {...result, view: await drawView()};
}

// Three roles, three readings. A maker reads prose and no map. A builder reads prose — its own
// manual, skill authoring and the component manual for the area — and may walk the map. A
// developer reads the map from `0` and one orientation file, and opens a manual when the work calls for it.
export async function onboarding({role, areas = []}) {
  if (!['maker', 'builder', 'developer'].includes(role)) throw Error('Choose maker, builder or developer onboarding.');
  const outside = areas.filter(area => Object.hasOwn(outsideAreas, area));
  const targets = [...new Set(areas.filter(area => !Object.hasOwn(developmentAreas, area)))];
  const builderAreaIds = [...new Set(areas.flatMap(area => developmentAreas[area] ?? []))];
  const ids = role === 'maker' ? ['MAKERS.md', 'skills/DIGEST.md', 'core/print/USAGE.md']
    : role === 'builder' ? ['BUILDERS.md', 'MAKERS.md', 'skills/DIGEST.md', 'core/print/USAGE.md', 'skills/AUTHORING.md', ...builderAreaIds]
    : ['DEVELOPER-CONTEXT.md#orientation', ...new Set(outside.flatMap(area => outsideAreas[area]))];
  const mapKeys = role === 'maker' ? [] : [...(role === 'developer' ? ['0'] : []), ...targets];
  if (mapKeys.length) {
    const {readIndex, storeDir} = await import('../../dev-map/lib/store.mjs');
    if (!await readIndex(storeDir(root))) await regenerateMap();
  }
  const [context, environment, maps] = await Promise.all([contextPacket(ids), environmentStatus(), mapKeys.length ? readMaps(mapKeys) : []]);
  return {role, environment, ...context, maps,
    nextStep: role === 'maker' ? 'Tell the person environment.sync.summary in one line. Reuse the returned context and choose individual skill manuals when an edit needs them.'
      : role === 'builder' ? 'Tell the person environment.sync.summary in one line. Reuse the returned context. The component manual for the area you are changing owns its behaviour, contracts and limits; read the one for the code you touch. The dev maps own structure: walk them from 0, or from a node you name with --area, for what calls what, with read-map INDEX|DECLARATION and --code, and run regenerate [INDEX] after an edit. Skills and adapters keep their own authoring references.'
      : 'Reuse the returned context. Walk the dev maps from the returned top map: every map numbers the nodes it homes under itself, down to leaves; a declaration’s map shows what it calls, and a repeat box names its node’s home. Read a node with read-map INDEX|DECLARATION, and its source with --code. After an edit run regenerate [INDEX] and read again. Indexes are for talking about a node, not for writing down; the declaration path is the durable name. Skills and adapters keep their own authoring references. The dev maps and DEVELOPER-CONTEXT.md are your orientation; open a component manual when the work calls for it, as when a change needs it rewritten.'};
}

function libraryPath(library) { return resolve(library ?? resolve(root, 'Prints')); }
function relativePrint(library, directory) {
  const id = relative(library, directory).replaceAll('\\', '/');
  if (!id || id === '..' || id.startsWith('../') || isAbsolute(id)) throw Error('Choose a print inside the selected --library directory.');
  return id;
}
export function printSummary(state, {includeGeometry = false, programChecked = true} = {}) {
  const plan = structuredClone(state.plan);
  if (!includeGeometry) delete plan.geometry;
  const lifecycle=lifecycleReview(state,{programChecked});
  return {directory: state.dir, kind: state.kind, revision: state.revision, geometryHash:state.geometryHash,
    plan, planComplete: includeGeometry,
    geometry: {boundsMm: state.geometry?.boundsMm, nativeFile: state.geometry?.nativeFile},
    machine: {id: state.machine.id, name: state.machine.name}, skills: state.skills,
    toolpathApproved: lifecycle.toolpathApproved,
    generation: {record: state.review.generation, programChecked,
      current: lifecycle.current,
      programError: state.programError ?? null, summary: state.program?.summary ?? null},
    outputAvailability: state.outputAvailability ?? null,
    machineConfiguration: state.machineConfiguration ?? null, limitations: state.limitations};
}
async function readPrint(directory, options = {}) {
  const {bundleFor,readStableBundle} = await import('../../studio/adapter-resolution.mjs');
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
async function preparePrint({command, target, libraryRoot, recipe, stl, machine, units}) {
  const prepared={};
  try {
  if (command === 'create-preview') {
    prepared.directory = resolve(target);
    relativePrint(libraryRoot, prepared.directory);
    // Custom libraries also isolate remembered machine defaults, as MCP does.
    const setupFile = libraryRoot === resolve(root, 'Prints') ? undefined
      : resolve(libraryRoot, '.machine-setups', `${machine ?? 'ultimaker-s5'}.json`);
    const options = {machineId: machine, setupFile};
    if (stl) {
      const {importSTLBundle} = await import('../print/import-stl.mjs');
      await importSTLBundle(prepared.directory, resolve(stl), {...options, units});
    } else {
      const adapter = await import('../print/bundle.mjs');
      await adapter.initBundle(prepared.directory, recipe ? await json(resolve(recipe)) : undefined, options);
    }
    prepared.created = true;
    prepared.assumptions = {recipe: recipe ? resolve(recipe) : null, sourceSTL: stl ? resolve(stl) : null,
      setup: recipe ? 'Supplied recipe' : 'Compatible remembered setup, otherwise machine defaults'};
  } else {
    const {printDirectory} = await import('../../studio/server.mjs');
    prepared.directory = await printDirectory(resolve(target));
  }
  return {prepared};
  } catch(error) {return {prepared,error};}
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
  let partial = {command};
  let stage = 'prepare';
  try {
    const preparation=await preparePrint({command, target, libraryRoot: libraryPath(library), recipe, stl, machine, units});
    partial={...partial,...preparation.prepared};
    if(preparation.error)throw preparation.error;
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

async function preparePreviewPrint(options,tour){
  if(options.command!=='start-tour')return preparePrint(options);
  let prepared={};
  try{
    const fresh=await tour.action('fresh');
    prepared={directory:fresh.directory,created:true};
    await tour.setStartAt({layer:options.startAtLayer});
    return {prepared};
  }catch(error){return {prepared,error};}
}

async function readPreviewPrint(directory){
  const {bundleFor}=await import('../../studio/adapter-resolution.mjs');
  // First-screen startup needs geometry, never slicing or program interpretation.
  const initial=await (await bundleFor(directory)).loadBundle(directory,{program:false});
  return {print:printSummary(initial,{programChecked:false}),sourceUnits:initial.plan.geometry.source};
}

function subscribePreview(server,agentRequests,studioEvents,{onRequest,onEvents}){
  const session=server.agentSession();
  const stopRequests=agentRequests.subscribe(request=>{
    if(request.source==='studio'&&request.studioInstanceId===session.instanceId)onRequest({studio:server.agentSession(),request});
  });
  server.once('close',stopRequests);
  const stopEvents=studioEvents.subscribe(events=>onEvents({studio:server.agentSession(),events}));
  server.once('close',()=>{stopEvents();studioEvents.close();});
  return session;
}

async function listenPreview(server,directory,ownerId,session){
  await new Promise((done,reject)=>{
    const failed=error=>reject(error);
    server.once('error',failed);
    server.listen(0,'127.0.0.1',()=>{server.off('error',failed);done();});
  });
  return {url:`http://127.0.0.1:${server.address().port}`,pid:process.pid,
    directory,instanceId:session.instanceId,agentOwnerId:ownerId,browserOpenRequested:false};
}

function previewListener(libraryRoot,studio,ownerId){
  return {mode:'live',event:'studio-request',events:'studio-events',studioInstanceId:studio.instanceId,agentOwnerId:ownerId,
    control:'Send newline-delimited JSON commands to this managed session stdin: read-studio-events returns and clears queued Studio events with calculation progress; wait-for-studio-request waits on requests and delivered events.',
    command:'wait-for-studio-request',library:libraryRoot,after:[],claim:true,waitMs:25000,
    fallback:{command:'wait-for-studio-request',studio:studio.url,agentOwner:ownerId,library:libraryRoot,after:[],claim:true,waitMs:25000,
      read:{command:'read-studio-events',studio:studio.url,agentOwner:ownerId}}};
}

async function closePreview(server,agentRequests,studioEvents){
  if(server)await server.shutdown();
  else {agentRequests.close();studioEvents.close();}
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
  const libraryRoot = libraryPath(library),ownerId=resumeOwner??randomUUID();
  let partial={command};
  const {createAgentRequests}=await import('../../studio/agent-requests.mjs');
  const {createStudioEvents}=await import('../../studio/studio-events.mjs');
  const studioEvents=createStudioEvents();
  const agentRequests=createAgentRequests(libraryRoot,{ownerId,events:studioEvents});
  let stage = 'prepare', server;
  try {
    const {createStudio} = await import('../../studio/server.mjs');
    const {createTour} = await import('../../studio/tour.mjs');
    const tour = createTour(libraryRoot,{ownerId,agentRequests});
    const preparation=await preparePreviewPrint({command,target,libraryRoot,recipe,stl,machine,units,startAtLayer},tour);
    const prepared=preparation.prepared;
    partial={...partial,...prepared};
    if(preparation.error)throw preparation.error;
    stage = 'read-print';
    const initial=await readPreviewPrint(prepared.directory);
    partial.print=initial.print;
    if (stl) partial.assumptions.units = initial.sourceUnits;
    stage = 'launch-studio';
    server = createStudio(prepared.directory, {libraryRoot,agentOwnerId:ownerId,agentRequests,closeAgentRequests:true,studioEvents});
    const session=subscribePreview(server,agentRequests,studioEvents,{onRequest,onEvents});
    const studio=await listenPreview(server,prepared.directory,ownerId,session);
    partial.studio=studio;
    partial.reuse = reuseGuidance(studio);
    onReady({event: 'studio-ready', command, studio: {...partial.studio},
      nextStep: 'Open studio.url now with the client browser integration. Keep this managed command session alive; consume the result context after the viewer is open.'});
    stage = 'open-browser';
    if (!noOpen && process.env.SAAM_NO_AUTO_OPEN !== '1') {
      const {openBrowser} = await import('../../studio/browser.mjs');
      partial.studio.browserOpenRequested = await openBrowser(partial.studio.url);
    }
    stage = 'context';
    partial.listener=previewListener(libraryRoot,studio,ownerId);
    if (command === 'start-tour') {
      partial.tour = await tour.info();
      [partial.context, partial.sync] = await Promise.all([
        contextPacket(['MAKERS.md', 'examples/prints/README.md#maker-agent-participation']), syncStatus()]);
      partial.nextStep = 'Include sync.summary as one line in your first chat message. Use the returned participation context directly; no maker-onboarding or repeated manual reads are needed. Keep the returned listener active, let Studio lead lesson one, and choose individual skill reads when an edit needs them.';
    } else {
      partial.print = await readPrint(partial.directory);
    }
    return {result: partial, server,agent:{requests:agentRequests,events:studioEvents,ownerId,session:server.agentSession}};
  } catch (error) {
    await closePreview(server,agentRequests,studioEvents);
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
    const tour = await createTour(libraryRoot,{ownerId,agentRequests:requests}).info();
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
    const store=createAgentRequests(libraryPath(library),{ownerId});
    result={requests:await store.selectQueued(polled.requests,{after,claim,studioInstanceId}),events:polled.events,generation:polled.generation};
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
      const document=await json(resolve(directory,'plan.json')),{bundle:_bundle,...plan}=document;
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
