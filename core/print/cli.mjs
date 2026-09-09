// Every command uses the same print bundle; Studio previews the checked export.
import {readFile,access} from 'node:fs/promises';
import {resolve} from 'node:path';
import {initBundle,loadBundle,generateBundle,adjustBundle,rememberSetup,deliver,upgradeBundle} from './bundle.mjs';
import {loadMachine,toolBounds} from '../machine/profile.mjs';
import {defaults,hash} from './plan.mjs';
import {parseSTL} from '../geom/mesh.mjs';
import {generatePath} from './generate.mjs';
import {rhino} from './geometry.mjs';
const readJson=async file=>JSON.parse(await readFile(file,'utf8'));
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  const [command, target, argument,extra,last] = process.argv.slice(2);
  const bundleDirectory = () => resolve(target ?? 'Prints/shell-part');
  const report = state => JSON.stringify({
    print: state.dir, skills: state.skills, revision: state.revision,
    geometryApproved: state.geometryApproved, planApproved: state.planApproved, toolpathApproved: state.toolpathApproved,
    program: state.program?.summary ?? null, programError: state.programError ?? null,
    nonplanarLimit: state.pathSummary?.nonplanarLimit ?? null, limitations: state.limitations
  }, null, 2);

  const run = async () => {
    if (command === 'init') {
      const plan = argument&&argument!=='--machine' ? await readJson(resolve(argument)) : undefined;
      const machineId=argument==='--machine'?extra:extra==='--machine'?last:extra;
      const directory = await initBundle(bundleDirectory(), plan,{machineId});
      console.log(`Print created at ${directory}`);
      console.log(`Open it for review with: npm run studio -- ${directory}`);
      console.log('Nothing is approved yet; the three approvals are made by a person in Studio.');
    } else if(command==='import-stl') {
      if(!argument||!['mm','inch'].includes(extra))throw new Error('Use import-stl <print-directory> <source.stl> <mm|inch> [machine-id].');
      const sourceBytes=await readFile(resolve(argument)),machine=loadMachine(last),plan=defaults(machine);
      plan.geometry={shape:'mesh',...parseSTL(sourceBytes,{units:extra}),source:{format:'stl',sha256:hash(sourceBytes),units:extra,scale:1}};
      const translationMm=[0,1,2].map(k=>-plan.geometry.vertices.reduce((minimum,p)=>Math.min(minimum,p[k]),Infinity));
      plan.geometry.vertices=plan.geometry.vertices.map(p=>p.map((v,k)=>v+translationMm[k]));
      plan.geometry.source.translationMm=translationMm;
      const bounds=toolBounds(machine,plan.setup.tool);plan.placement={xMm:bounds.min[0]+5,yMm:bounds.min[1]+5};
      plan.skills['draped-skin'].enabled=false;
      await initBundle(bundleDirectory(),plan,{machineId:machine.id,sourceBytes});
      console.log('STL imported in '+extra+' and translated to rest on the bed; open Studio for geometry review. Nothing is approved.');
    } else if(command==='check-path') {
      const state=await loadBundle(bundleDirectory(),{program:false});
      const path=generatePath(state.plan,state.machine,await rhino());
      console.log(JSON.stringify({mode:'development-check-only',...path.summary},null,2));
    } else if (command === 'demo') {
      const directory = bundleDirectory();
      try { await access(resolve(directory, 'plan.json')); } catch { await initBundle(directory); }
      const checks = await generateBundle(directory, { development: true });
      console.log(`Development generation only; no human approvals created.`);
      console.log(`  ${checks.moves} moves, about ${checks.estimatedMinutes} minutes`);
      console.log(`Print: ${directory}`);
      console.log(`Open Studio with: npm run studio -- ${directory}`);
    } else if (command === 'upgrade') {
      await upgradeBundle(bundleDirectory());
      console.log('Machine snapshot upgraded; plan and toolpath require review again.');
    } else if (command === 'generate') {
      console.log(JSON.stringify(await generateBundle(bundleDirectory()), null, 2));
    } else if (command === 'adjust') {
      if (!argument) throw new Error('Supply a JSON patch file after the print directory.');
      const state = await adjustBundle(bundleDirectory(), await readJson(resolve(argument)));
      console.log(JSON.stringify({ revision: state.revision, plan: state.plan }, null, 2));
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
      console.error('       cli.mjs init|demo|generate|check|deliver|upgrade|remember-setup [print-directory] [plan.json]');
      console.error('       cli.mjs adjust <print-directory> <patch.json>');
      console.error('       cli.mjs import-stl <print-directory> <source.stl> <mm|inch> [machine-id]');
      console.error('       cli.mjs check-path <print-directory> (software compatibility only)');
      console.error('       cli.mjs init <print-directory> [plan.json] [--machine <machine-id>]');
      process.exitCode = 1;
    }
  };
  run().catch(error => { console.error(error.message); process.exitCode = 1; });
}
