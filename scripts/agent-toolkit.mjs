#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {createInterface} from 'node:readline';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {onboarding, readSkill, readMaps, regenerateMap, contextPacket, preview, showPrint, beginWork, waitForRequests, readStudioEvents, respondToRequest, recordRequestActivity, inspectFailure, developmentAreas} from '../core/agent/toolkit.mjs';

const string = {type: 'string'}, boolean = {type: 'boolean'}, many = {type: 'string', multiple: true};
const schemas = {
  'maker-onboarding': {},
  'builder-onboarding': {area: many},
  'developer-onboarding': {area: many},
  'read-skill': {maker: boolean, builder: boolean, developer: boolean},
  'read-guidance': {},
  'read-map': {code: boolean},
  'regenerate': {},
  'start-tour': {library: string, 'start-at-layer': string, 'no-open': boolean,'agent-owner':string},
  'open-print': {library: string, 'no-open': boolean, studio: string, 'agent-owner': string},
  'create-preview': {library: string, recipe: string, stl: string, kind: string, machine: string, units: string, 'no-open': boolean, studio: string, 'agent-owner': string},
  'begin-studio-work': {library: string, instruction: string, request: string, kind: string, 'include-geometry': boolean,'studio-instance':string,'agent-owner':string},
  'wait-for-studio-request': {library: string, after: many, 'wait-ms': string, claim: boolean,'studio-instance':string,'agent-owner':string,studio:string},
  'read-studio-events': {studio: string, 'agent-owner': string, 'wait-ms': string, history: boolean},
  'respond-to-studio-request': {library: string, status: string, message: string, 'result-stage': string,'studio-instance':string,'agent-owner':string},
  'record-request-activity': {library:string,'studio-instance':string,'agent-owner':string},
  'inspect-generation-failure': {library: string, request: string, 'include-geometry': boolean}
};
export const help = {
  commands: {
    'maker-onboarding': 'Maker guidance, complete skill digest and print tools; choose follow-up reads for the task.',
    'builder-onboarding [--area AREA]': 'Builder and maker context, skill authoring and digest; each --area adds its component manual and, for a region of the map, that region page.',
    'developer-onboarding [--area AREA]': 'The developer orientation and map page 0 — no component manuals; each --area adds that region page (path or index) or an outside area’s references.',
    'read-map INDEX|DECLARATION [--code]': 'Read one stored page: 0 for the regions, N for a region, N.F for a file, N.F.E… or a declaration path for a function page. --code returns that page’s own source span with line numbers; it is refused on 0 and on a region page. Reads the store; it never scans.',
    'regenerate [INDEX]': 'Scan the source and write the stored map. No index, or 0, generates everything; a region or page index regenerates that region.',
    'read-skill ID [--maker] [--builder] [--developer]': 'Read only the selected skill roles; defaults to maker. Missing optional manuals are reported in unavailableRoles.',
    'read-guidance PATH#HEADING': 'Read one published manual or section chosen for the task.',
    'start-tour [--start-at-layer 12] [--no-open] [--agent-owner ID]': 'Fresh tour copies, live Studio, browser dispatch and participation context. --agent-owner resumes the agent owner of an earlier launch on this new Studio.',
    'open-print DIRECTORY [--no-open] [--studio URL] [--agent-owner ID]': 'Open saved geometry/toolpath and return current recipe/review state. With the live Studio URL and agentOwnerId from studio-ready it shows the print in that Studio and exits instead of launching another; --agent-owner alone launches a new Studio under that resumed owner.',
    'create-preview DIRECTORY [--recipe FILE | --stl FILE] [--machine ID] [--units auto|mm|inch] [--no-open] [--studio URL] [--agent-owner ID]': 'Create/import unapproved geometry, open Studio and report assumptions. With --studio and --agent-owner the new print is shown in that live Studio instead of a new one; --agent-owner alone launches a new Studio under that resumed owner.',
    'begin-studio-work [DIRECTORY] [--instruction TEXT | --request ID] [--kind edit|guidance] [--include-geometry]': 'Start/claim work first, then read recipe, revision, confirmations and tour instruction.',
    'wait-for-studio-request [--studio URL --agent-owner ID] [--claim] [--wait-ms 25000] [--after ID]': 'Bounded wait for Studio requests and delivered Studio events, optional claim, and next cursor. With the live Studio URL and agentOwnerId from studio-ready it reads the owning agent’s event queue and calculation progress across processes.',
    'read-studio-events --studio URL --agent-owner ID [--wait-ms 0] [--history]': 'Read and clear queued Studio events (what the person did) plus current toolpath calculation progress from a live owned Studio.',
    'respond-to-studio-request ID [--status working|completed|failed|waiting|cancelled] [--result-stage geometry|toolpath] [--message TEXT]': 'Record a prepared result or resolve the matching request through the shared coordination API.',
    'record-request-activity ID': 'Record actual request-specific agent/tool activity without resuming work or changing its target. Never run as an idle heartbeat.',
    'inspect-generation-failure DIRECTORY [--request ID] [--include-geometry]': 'Saved errors/requests, checked state or invalid recipe, generation guidance and skill links.'
  },
  developmentAreas: Object.keys(developmentAreas),
  notes: ['--area takes a map region path or index (read-map 0 lists them), or one of the areas above.',
    'Map indexes are regenerated and may change. Say the index and the name when talking about a page; write the declaration path when something must keep pointing at it.',
    '--library DIRECTORY selects a print/request library (default: this checkout’s Prints).',
    'Relaunching a Studio with --agent-owner ID, the agentOwnerId from an earlier studio-ready line, resumes that owner so its in-flight requests stay visible. The relaunch always gets a new Studio instance.',
    '--area and --after may repeat where accepted. Skill manuals are individual follow-up reads.',
    'Studio commands stay in the managed command session. Read studio-ready before waiting for completion.',
    'Reuse your live Studio and browser tab by default: later open-print/create-preview calls pass --studio URL --agent-owner ID. Launch another instance only when the person asks, or for a compelling reason you tell them.',
    'For the shared launcher permission use node studio/server.mjs --toolkit start-tour|open-print|create-preview ...',
    'Output is newline-delimited JSON: studio-ready for a live preview, then result; failures contain stage and partial results.']
};

function attachLiveControl(opened,input,write){
  if(!input?.on)return()=>{};
  const lines=createInterface({input,terminal:false});let queue=Promise.resolve();
  lines.on('line',line=>{queue=queue.then(async()=>{
    let message;
    try{message=JSON.parse(line);}catch(error){write({ok:false,event:'agent-response',error:'Invalid live command JSON: '+error.message});return;}
    const {id,command}=message,base={requests:opened.agent.requests,studioInstanceId:opened.result.studio.instanceId};
    try{
      let result;
      if(command==='begin-studio-work')result=await beginWork({...base,target:message.target??opened.result.directory,instruction:message.instruction,requestId:message.requestId,includeGeometry:Boolean(message.includeGeometry),kind:message.kind});
      else if(command==='respond-to-studio-request')result=await respondToRequest({...base,requestId:message.requestId,status:message.status,message:message.message,resultStage:message.resultStage});
      else if(command==='record-request-activity')result=await recordRequestActivity({...base,requestId:message.requestId,target:message.target});
      else if(command==='read-studio-events')result=await readStudioEvents({events:opened.agent.events,server:opened.server,history:Boolean(message.history)});
      else if(command==='wait-for-studio-request')result=await waitForRequests({...base,server:opened.server,after:message.after??[],waitMs:message.waitMs??25000,claim:Boolean(message.claim)});
      else if(command==='open-print'||command==='create-preview')result=await showPrint({...message,command,library:opened.result.listener.library,
        open:async directory=>{await opened.server.openPrint(directory);opened.result.directory=opened.result.studio.directory=opened.agent.session().directory;return opened.result.studio;}});
      else if(command==='get-studio-session')result=opened.agent.session();
      else if(command==='close-studio'){result=opened.agent.session();await opened.server.shutdown();}
      else throw Error('Unknown live Studio command.');
      write({ok:true,event:'agent-response',id,command,result});
    }catch(error){write({ok:false,event:'agent-response',id,command,error:error.message});}
  }).catch(error=>write({ok:false,event:'agent-response',error:error.message}));});
  opened.server.once('close',()=>lines.close());return()=>lines.close();
}

export async function runCLI(args = process.argv.slice(2), {write = value => console.log(JSON.stringify(value)),input=process.stdin} = {}) {
  const [command, ...rest] = args;
  let liveServer;
  try {
    if (!command || ['help', '--help', '-h'].includes(command)) {write({ok: true, ...help}); return;}
    if (!Object.hasOwn(schemas, command)) throw Error(`Unknown command: ${command}. Use --help.`);
    const {values: v, positionals} = parseArgs({args: rest, options: schemas[command], allowPositionals: true, strict: true});
    const needsTarget = ['read-skill', 'read-guidance', 'read-map', 'open-print', 'create-preview', 'inspect-generation-failure', 'respond-to-studio-request','record-request-activity'].includes(command);
    const permitsTarget = needsTarget || ['begin-studio-work', 'regenerate'].includes(command);
    if (positionals.length > (permitsTarget ? 1 : 0) || needsTarget && !positionals.length) throw Error('Unexpected or missing positional argument. Use --help.');
    if (command === 'create-preview' && v.units && !v.stl) throw Error('--units applies only to --stl.');
    const options = {command, target: positionals[0], library: v.library, recipe: v.recipe, stl: v.stl,
      kind: v.kind, machine: v.machine, units: v.units, noOpen: v['no-open'],
      startAtLayer: v['start-at-layer'] === undefined ? 12 : Number(v['start-at-layer']),
      instruction: v.instruction, requestId: v.request, includeGeometry: v['include-geometry'],studioInstanceId:v['studio-instance'],ownerId:v['agent-owner']};
    let result;
    if (command.endsWith('-onboarding')) result = await onboarding({role: command.replace('-onboarding', ''), areas: v.area});
    else if (command === 'read-skill') result = await readSkill(positionals[0], v);
    else if (command === 'read-guidance') result = await contextPacket([positionals[0]]);
    else if (command === 'read-map') result = {maps: await readMaps([positionals[0]], v)};
    else if (command === 'regenerate') result = await regenerateMap(positionals[0]);
    else if (['open-print', 'create-preview'].includes(command) && v.studio) result = await showPrint({...options, studio: v.studio});
    else if (['start-tour', 'open-print', 'create-preview'].includes(command)) {
      const opened = await preview({...options, onReady: write,onRequest:event=>write({ok:true,event:'studio-request',command,...event}),onEvents:event=>write({ok:true,event:'studio-events',command,...event})});
      result = opened.result; liveServer = opened.server;
      attachLiveControl(opened,input,write);
      const stop = () => {void liveServer.shutdown();};
      process.on('SIGINT', stop); process.on('SIGTERM', stop);
      liveServer.once('close', () => {process.off('SIGINT', stop); process.off('SIGTERM', stop);});
      liveServer.on('error', error => {write({ok: false, command, stage: 'studio-runtime', error: error.message}); process.exitCode = 1; stop();});
    } else if (command === 'begin-studio-work') result = await beginWork(options);
    else if (command === 'wait-for-studio-request') {
      const waitMs = v['wait-ms'] === undefined ? 25000 : Number(v['wait-ms']);
      if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > 25000) throw Error('--wait-ms must be an integer from 0 to 25000.');
      result = await waitForRequests({library: v.library, after: v.after, claim: v.claim, waitMs,studioInstanceId:v['studio-instance'],ownerId:v['agent-owner'],studio:v.studio});
    } else if (command === 'read-studio-events') {
      const waitMs = v['wait-ms'] === undefined ? 0 : Number(v['wait-ms']);
      if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > 25000) throw Error('--wait-ms must be an integer from 0 to 25000.');
      result = await readStudioEvents({studio: v.studio, ownerId: v['agent-owner'], waitMs, history: v.history});
    } else if (command === 'respond-to-studio-request') result = await respondToRequest({library: v.library, requestId: positionals[0], status: v.status, message: v.message, resultStage: v['result-stage']});
    else if(command==='record-request-activity')result=await recordRequestActivity({library:v.library,requestId:positionals[0]});
    else result = await inspectFailure(options);
    write({ok: true, event: 'result', command, ...result});
    return liveServer;
  } catch (error) {
    write({ok: false, command, stage: error.stage ?? 'command', error: error.message, partial: error.partial ?? null});
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runCLI();
