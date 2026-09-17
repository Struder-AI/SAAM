#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {onboarding, readSkill, readMaps, contextPacket, preview, beginWork, waitForRequests, respondToRequest, recordRequestActivity, inspectFailure, developmentAreas} from '../core/agent/toolkit.mjs';

const string = {type: 'string'}, boolean = {type: 'boolean'}, many = {type: 'string', multiple: true};
const schemas = {
  'maker-onboarding': {},
  'builder-onboarding': {area: many},
  'developer-onboarding': {area: many},
  'read-skill': {maker: boolean, builder: boolean, developer: boolean},
  'read-guidance': {},
  'read-map': {},
  'start-tour': {library: string, 'start-at-layer': string, 'no-open': boolean},
  'open-print': {library: string, 'no-open': boolean},
  'create-preview': {library: string, recipe: string, stl: string, kind: string, machine: string, units: string, 'no-open': boolean},
  'begin-studio-work': {library: string, instruction: string, request: string, kind: string, 'include-geometry': boolean},
  'wait-for-studio-request': {library: string, after: many, 'wait-ms': string, claim: boolean},
  'respond-to-studio-request': {library: string, status: string, message: string, 'result-stage': string},
  'record-request-activity': {library:string},
  'inspect-generation-failure': {library: string, request: string, 'include-geometry': boolean}
};
export const help = {
  commands: {
    'maker-onboarding': 'Maker guidance, complete skill digest and print tools; choose follow-up reads for the task.',
    'builder-onboarding [--area AREA]': 'Builder orientation (includes maker context), core architecture, skill authoring and digest, and selected area references.',
    'developer-onboarding [--area AREA]': 'Developer orientation, system map, skill digest and selected area maps/contracts; work map-first.',
    'read-map PAGE': 'Read the owning region, shared contracts and calculated other-use references from current source.',
    'read-skill ID [--maker] [--builder] [--developer]': 'Read only the selected skill roles; defaults to maker. Missing optional manuals are reported in unavailableRoles.',
    'read-guidance PATH#HEADING': 'Read one published manual or section chosen for the task.',
    'start-tour [--start-at-layer 12] [--no-open]': 'Fresh tour copies, live Studio, browser dispatch and participation context.',
    'open-print DIRECTORY [--no-open]': 'Open saved geometry/toolpath and return current recipe/review state.',
    'create-preview DIRECTORY [--recipe FILE | --stl FILE] [--kind shell|wedge] [--machine ID] [--units auto|mm|inch] [--no-open]': 'Create/import unapproved geometry, open Studio and report assumptions.',
    'begin-studio-work [DIRECTORY] [--instruction TEXT | --request ID] [--kind edit|guidance] [--include-geometry]': 'Start/claim work first, then read recipe, revision, confirmations and tour instruction.',
    'wait-for-studio-request [--claim] [--wait-ms 25000] [--after ID]': 'Bounded wait, optional claim, and next cursor.',
    'respond-to-studio-request ID [--status working|completed|failed|waiting|cancelled] [--result-stage geometry|toolpath] [--message TEXT]': 'Record a prepared result or resolve the matching request through the shared coordination API.',
    'record-request-activity ID': 'Record actual request-specific agent/tool activity without resuming work or changing its target. Never run as an idle heartbeat.',
    'inspect-generation-failure DIRECTORY [--request ID] [--include-geometry]': 'Saved errors/requests, checked state or invalid recipe, generation guidance and skill links.'
  },
  developmentAreas: Object.keys(developmentAreas),
  notes: ['--library DIRECTORY selects a print/request library (default: this checkout’s Prints).',
    '--area and --after may repeat where accepted. Skill manuals are individual follow-up reads.',
    'Studio commands stay in the managed command session. Read studio-ready before waiting for completion.',
    'For the shared launcher permission use node studio/server.mjs --toolkit start-tour|open-print|create-preview ...',
    'Output is newline-delimited JSON: studio-ready for a live preview, then result; failures contain stage and partial results.']
};

export async function runCLI(args = process.argv.slice(2), {write = value => console.log(JSON.stringify(value))} = {}) {
  const [command, ...rest] = args;
  let liveServer;
  try {
    if (!command || ['help', '--help', '-h'].includes(command)) {write({ok: true, ...help}); return;}
    if (!Object.hasOwn(schemas, command)) throw Error(`Unknown command: ${command}. Use --help.`);
    const {values: v, positionals} = parseArgs({args: rest, options: schemas[command], allowPositionals: true, strict: true});
    const needsTarget = ['read-skill', 'read-guidance', 'read-map', 'open-print', 'create-preview', 'inspect-generation-failure', 'respond-to-studio-request','record-request-activity'].includes(command);
    const permitsTarget = needsTarget || command === 'begin-studio-work';
    if (positionals.length > (permitsTarget ? 1 : 0) || needsTarget && !positionals.length) throw Error('Unexpected or missing positional argument. Use --help.');
    if (command === 'create-preview' && v.units && !v.stl) throw Error('--units applies only to --stl.');
    const options = {command, target: positionals[0], library: v.library, recipe: v.recipe, stl: v.stl,
      kind: v.kind, machine: v.machine, units: v.units, noOpen: v['no-open'],
      startAtLayer: v['start-at-layer'] === undefined ? 12 : Number(v['start-at-layer']),
      instruction: v.instruction, requestId: v.request, includeGeometry: v['include-geometry']};
    let result;
    if (command.endsWith('-onboarding')) result = await onboarding({role: command.replace('-onboarding', ''), areas: v.area});
    else if (command === 'read-skill') result = await readSkill(positionals[0], v);
    else if (command === 'read-guidance') result = await contextPacket([positionals[0]]);
    else if (command === 'read-map') result = {maps: await readMaps([positionals[0]])};
    else if (['start-tour', 'open-print', 'create-preview'].includes(command)) {
      const opened = await preview({...options, onReady: write});
      result = opened.result; liveServer = opened.server;
      const stop = () => {void liveServer.shutdown();};
      process.on('SIGINT', stop); process.on('SIGTERM', stop);
      liveServer.once('close', () => {process.off('SIGINT', stop); process.off('SIGTERM', stop);});
      liveServer.on('error', error => {write({ok: false, command, stage: 'studio-runtime', error: error.message}); process.exitCode = 1; stop();});
    } else if (command === 'begin-studio-work') result = await beginWork(options);
    else if (command === 'wait-for-studio-request') {
      const waitMs = v['wait-ms'] === undefined ? 25000 : Number(v['wait-ms']);
      if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > 25000) throw Error('--wait-ms must be an integer from 0 to 25000.');
      result = await waitForRequests({library: v.library, after: v.after, claim: v.claim, waitMs});
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
