import {applyExtensionEdit} from './extension-edits.mjs';
// Every command uses the same print bundle; Studio previews the checked export.
import {readFile,access} from 'node:fs/promises';
import {resolve} from 'node:path';
import {root,initBundle,loadBundle,generateBundle,generateToolpath,restoreRevision,adjustBundle,deliver,checkPathBundle,migrateBundle,bundleInstance,recoverBundleInstance} from './bundle.mjs';
import {changeMachine,rememberSetup,adjustSettings} from '../machine/bundle-settings.mjs';
import {SETTINGS_FIELDS} from '../machine/settings.mjs';
import {createSTLBundle,setSTLUnits} from './import-stl.mjs';
import {repairSTLFiles} from './repair-stl.mjs';
import {createBlobFieldBundle,updateBlobFieldBundle} from '../agent/blob-field.mjs';
import {intersectRequest,combineGeometry} from './geometry-tools.mjs';
import {starterGeometry} from '../../examples/prints/starter-geometry.mjs';
import {defaults} from './plan.mjs';
import {skinAssignment} from '../../skills/draped-skin/scripts/prepare.mjs';
import {machineHint} from '../agent/layers.mjs';
const readJson=async file=>JSON.parse(await readFile(file,'utf8'));
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  const args=process.argv.slice(2),revisionIndex=args.indexOf('--revision');
  const expectedRevision=revisionIndex<0?undefined:args[revisionIndex+1];
  if(revisionIndex>=0)args.splice(revisionIndex,2);
  const [command, target, argument,extra,last] = args;
  const bundleDirectory = () => resolve(target ?? 'Prints/shell-part');
  const report = state => JSON.stringify({
    bundle: state.dir, skills: state.skills, revision: state.revision, geometryHash:state.geometryHash,
    toolpathApproved: state.toolpathApproved, history:state.history,artifacts:state.artifacts,
    program: state.program?.summary ?? null, programError: state.programError ?? null,
    outputAvailability: state.outputAvailability ?? null, machineConfiguration: state.machineConfiguration ?? null,
    surfaceDomain: state.pathSummary?.surfaceDomain ?? null, limitations: state.limitations
  }, null, 2);

  const run = async () => {
    if(revisionIndex>=0&&(!expectedRevision||!['undo','redo','adjust','text','heat-set','blob-field-update','combine','change-machine','stl-units'].includes(command)))throw new Error('--revision requires a revision hash and an edit, undo or redo command.');
    if (command === 'init') {
      const plan = argument&&argument!=='--machine' ? await readJson(resolve(argument)) : undefined;
      const machineId=argument==='--machine'?extra:extra==='--machine'?last:extra;
      const directory = await initBundle(bundleDirectory(), plan,{machineId});
      console.log(`Bundle created at ${directory}`);
      console.log(`Open it for review with: npm run studio -- ${directory}`);
      console.log('Nothing is approved yet; review the geometry and generate freely, then confirm the exact settings/toolpath together in Studio before export.');
      const hint=await machineHint(root,{to:machineId});if(hint)console.log(hint);
    } else if(command==='undo'||command==='redo') {
      console.log(report(await restoreRevision(bundleDirectory(),{direction:command,expectedRevision})));
    } else if(command==='toolpath') {
      console.log(report(await generateToolpath(bundleDirectory())));
    } else if(command==='migrate') {
      console.log(JSON.stringify(await migrateBundle(bundleDirectory()),null,2));
    } else if(command==='instance-status') {
      const instance=await bundleInstance(bundleDirectory());
      console.log(JSON.stringify(instance?{instanceId:instance.instanceId,ownerId:instance.ownerId,pid:instance.pid,startedAt:instance.startedAt}:null,null,2));
    } else if(command==='recover-instance') {
      console.log(JSON.stringify(await recoverBundleInstance(bundleDirectory()),null,2));
    } else if(command==='blob-field-create'||command==='blob-field-update') {
      if(!argument)throw new Error('Use blob-field-create|blob-field-update <print-directory> <blob-field-request.json> [machine-id | --revision <revision>].');
      const request=await readJson(resolve(argument));
      const state=command==='blob-field-create'?await createBlobFieldBundle(bundleDirectory(),request,{machineId:extra}):await updateBlobFieldBundle(bundleDirectory(),request,{expectedRevision});
      console.log(report(state));
    } else if(command==='text') {
      if(!argument)throw new Error('Use text <print-directory> <text-request.json> [--revision <revision>].');
      const state=await applyExtensionEdit(bundleDirectory(),'text',await readJson(resolve(argument)),{expectedRevision});
      console.log(report(state));
    } else if(command==='intersect') {
      if(!argument)throw new Error('Use intersect <print-directory> <intersect-request.json>.');
      console.log(JSON.stringify(await intersectRequest(bundleDirectory(),await readJson(resolve(argument))),null,2));
    } else if(command==='combine') {
      if(!argument)throw new Error('Use combine <print-directory> <combine-request.json> --revision <revision>.');
      console.log(report(await combineGeometry(bundleDirectory(),await readJson(resolve(argument)),{expectedRevision})));
    } else if(command==='heat-set') {
      if(!argument)throw new Error('Use heat-set <print-directory> <heat-set-request.json> [--revision <revision>].');
      const state=await applyExtensionEdit(bundleDirectory(),'heat-set-inserts',await readJson(resolve(argument)),{expectedRevision});
      console.log(report(state));
    } else if(command==='repair-stl') {
      if(!argument||!['mm','inch'].includes(extra))throw new Error('Use repair-stl <new-repair-directory> <source.stl> <mm|inch> [options.json].');
      const options=last?await readJson(resolve(last)):{};
      console.log(JSON.stringify(await repairSTLFiles(bundleDirectory(),resolve(argument),{...options,units:extra,progress:event=>console.error(JSON.stringify(event))}),null,2));
    } else if(command==='import-stl') {
      if(!argument||extra!==undefined&&!['auto','mm','inch'].includes(extra))throw new Error('Use import-stl <print-directory> <source.stl> [auto|mm|inch] [machine-id].');
      const controller=new AbortController(),cancel=()=>controller.abort(new DOMException('Import cancelled.','AbortError'));
      process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
      try{await createSTLBundle(bundleDirectory(),resolve(argument),{units:extra,machineId:last,signal:controller.signal,progress:event=>console.error(JSON.stringify(event))});}
      finally{process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);}
      const imported=await loadBundle(bundleDirectory(),{program:false});
      console.log('STL imported in '+imported.plan.geometry.source.units+(imported.plan.geometry.source.unitsInferred?' (assumed from size)':'')+'; open Studio for geometry review. Nothing is approved.');
    } else if(command==='stl-units') {
      console.log(report(await setSTLUnits(bundleDirectory(),argument,{expectedRevision})));
    } else if(command==='check-path') {
      console.log(JSON.stringify(await checkPathBundle(bundleDirectory()),null,2));
    } else if (command === 'demo') {
      const directory = bundleDirectory();
      try { await access(resolve(directory, 'plan.json')); } catch { const plan=defaults();plan.geometry=starterGeometry();plan.slices.assignments.push(skinAssignment({id:'skin'}));await initBundle(directory,plan,{machineId:'ultimaker-s5'}); }
      const checks = await generateBundle(directory, { development: true });
      console.log(`Development generation only; no human approvals created.`);
      console.log(`  ${checks.moves} moves, about ${checks.estimatedMinutes} minutes`);
      console.log(`Print: ${directory}`);
      console.log(`Open Studio with: npm run studio -- ${directory}`);
    } else if (command === 'change-machine') {
      const state=await changeMachine(bundleDirectory(),argument,{expectedRevision});
      console.log(report(state));
      const hint=await machineHint(root,{to:argument});if(hint)console.log(hint);
    } else if (command === 'generate') {
      console.log(JSON.stringify(await generateBundle(bundleDirectory()), null, 2));
    } else if (command === 'adjust') {
      if (!argument) throw new Error('Supply a JSON patch file after the print directory.');
      const patch=await readJson(resolve(argument));
      const state=Object.keys(patch).every(key=>SETTINGS_FIELDS.includes(key))
        ?await adjustSettings(bundleDirectory(),patch,{expectedRevision})
        :await adjustBundle(bundleDirectory(),patch,{expectedRevision});
      console.log(report(state));
    } else if (command === 'remember-setup') {
      console.log(await rememberSetup(bundleDirectory()));
    } else if (command === 'deliver') {
      console.log(await deliver(bundleDirectory()));
    } else if (command === 'check') {
      const directory = bundleDirectory();
      const state=await loadBundle(directory);
      console.log(report(state));
      if(state.programError)process.exitCode=1;
    } else {
      console.error('       cli.mjs init|migrate|demo|generate|check|deliver|remember-setup [print-directory] [plan.json]');
      console.error('       cli.mjs undo|redo <print-directory> --revision <revision>');
      console.error('       cli.mjs toolpath <print-directory> (save completed SAAMpath without export)');
      console.error('       cli.mjs instance-status|recover-instance <print-directory>');
      console.error('       cli.mjs adjust <print-directory> <patch.json> [--revision <revision>]');
      console.error('       cli.mjs change-machine <print-directory> <machine-id> [--revision <revision>]');
      console.error('       cli.mjs text <print-directory> <text-request.json> [--revision <revision>]');
      console.error('       cli.mjs blob-field-create <print-directory> <blob-field-request.json> [machine-id]');
      console.error('       cli.mjs blob-field-update <print-directory> <blob-field-request.json> --revision <revision>');
      console.error('       cli.mjs heat-set <print-directory> <heat-set-request.json> [--revision <revision>]');
      console.error('       cli.mjs intersect <print-directory> <intersect-request.json>');
      console.error('       cli.mjs combine <print-directory> <combine-request.json> --revision <revision>');
      console.error('       cli.mjs stl-units <print-directory> <mm|inch> [--revision HASH]');
      console.error('       cli.mjs import-stl <print-directory> <source.stl> [auto|mm|inch] [machine-id]');
      console.error('       cli.mjs repair-stl <new-repair-directory> <source.stl> <mm|inch> [options.json]');
      console.error('       cli.mjs check-path <print-directory> (software compatibility only)');
      console.error('       cli.mjs init <bundle-directory> <plan.json> [--machine <machine-id>]');
      process.exitCode = 1;
    }
  };
  run().catch(error => { console.error(error.message); process.exitCode = 1; });
}
