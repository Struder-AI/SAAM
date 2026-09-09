// Every command uses the same print bundle; Studio previews the checked export.
import {readFile,access} from 'node:fs/promises';
import {resolve} from 'node:path';
import {initBundle,loadBundle,generateBundle,adjustBundle,rememberSetup,deliver,upgradeBundle} from './bundle.mjs';
const readJson=async file=>JSON.parse(await readFile(file,'utf8'));
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  const [command, target, argument] = process.argv.slice(2);
  const bundleDirectory = () => resolve(target ?? 'Prints/shell-part');
  const report = state => JSON.stringify({
    print: state.dir, skills: state.skills, revision: state.revision,
    geometryApproved: state.geometryApproved, planApproved: state.planApproved, toolpathApproved: state.toolpathApproved,
    program: state.program?.summary ?? null, programError: state.programError ?? null,
    nonplanarLimit: state.pathSummary?.nonplanarLimit ?? null, limitations: state.limitations
  }, null, 2);

  const run = async () => {
    if (command === 'init') {
      const plan = argument ? await readJson(resolve(argument)) : undefined;
      const directory = await initBundle(bundleDirectory(), plan);
      console.log(`Print created at ${directory}`);
      console.log(`Open it for review with: npm run studio -- ${directory}`);
      console.log('Nothing is approved yet; the three approvals are made by a person in Studio.');
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
      process.exitCode = 1;
    }
  };
  run().catch(error => { console.error(error.message); process.exitCode = 1; });
}
