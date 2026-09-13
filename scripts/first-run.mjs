// Idempotent first-use setup. This file intentionally imports only Node built-ins
// before npm ci completes so it also works in a fresh clone.
import {access,mkdir,readFile,writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline/promises';

export const TOUR=[
  ['1 · Describe the part','Tell your AI agent what you want to make, what it must fit or do, and any dimensions that matter.'],
  ['2 · Inspect geometry','SAAM Studio shows the proposed shape before manufacturing choices are locked. Ask for changes until it is right, then approve it yourself.'],
  ['3 · Review the process','Your agent composes printing skills and machine settings. Warnings and unsupported requests stay visible instead of being guessed away.'],
  ['4 · Review the toolpath','Inspect print moves, travel, layers and machine source. Software checks do not certify physical safety or create approval for you.'],
  ['5 · Export exactly what you reviewed','After your approval, SAAM delivers the same checked machine-program bytes shown in Studio. It never starts hardware automatically.']
];

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const markerFile=resolve(root,'.saam','first-run.json');
const exists=async path=>{try{await access(path,constants.F_OK);return true;}catch{return false;}};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const setupNeeded=({marker,lockHash,nodeModules})=>!marker||marker.packageLockSha256!==lockHash||!nodeModules;

async function loadMarker(){try{return JSON.parse(await readFile(markerFile,'utf8'));}catch{return null;}}
async function saveMarker(marker){await mkdir(dirname(markerFile),{recursive:true});await writeFile(markerFile,JSON.stringify(marker,null,2)+'\n');}
async function run(command,args){
  await new Promise((done,reject)=>{
    const child=spawn(command,args,{cwd:root,stdio:'inherit'});
    child.once('error',reject);child.once('exit',code=>code===0?done():reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`)));
  });
}
async function showTour({pause=process.stdin.isTTY}={}){
  const prompt=pause?createInterface({input:process.stdin,output:process.stdout}):null;
  try{
    for(const [title,body] of TOUR){console.log(`\n${title}\n${body}`);if(prompt)await prompt.question('Press Enter to continue… ');}
    console.log('\nYou are ready. Describe a part in ordinary language whenever you want to begin.');
  }finally{prompt?.close();}
}

export async function firstRun({args=process.argv.slice(2)}={}){
  const major=Number(process.versions.node.split('.')[0]);
  if(major<22)throw new Error(`Node.js 22 or newer is required; found ${process.version}. Install an active LTS release from https://nodejs.org/ and run this command again.`);
  const lockHash=hash(await readFile(resolve(root,'package-lock.json'))),prior=await loadMarker();
  let marker=prior??{version:1,tour:'pending'};
  if(setupNeeded({marker:prior,lockHash,nodeModules:await exists(resolve(root,'node_modules'))})){
    console.log('Preparing SAAM for first use…');
    await run(process.platform==='win32'?'npm.cmd':'npm',['ci']);
    const {checkSetup}=await import('./setup-check.mjs');
    const check=await checkSetup();
    marker={...marker,version:1,packageLockSha256:lockHash,setupCheckedAt:new Date().toISOString(),runtime:{node:check.node,platform:check.platform,arch:check.arch}};
    await saveMarker(marker);
  }else console.log('SAAM setup is already current.');

  if(args.includes('--skip-tour')){
    marker={...marker,tour:'skipped',tourUpdatedAt:new Date().toISOString()};await saveMarker(marker);
    console.log('Guided tour skipped. Run npm run first-run -- --tour whenever you want it.');return marker;
  }
  if(args.includes('--tour')){
    await showTour();marker={...marker,tour:'completed',tourUpdatedAt:new Date().toISOString()};await saveMarker(marker);return marker;
  }
  if(marker.tour==='pending'){
    if(process.stdin.isTTY){
      const prompt=createInterface({input:process.stdin,output:process.stdout});
      const answer=(await prompt.question('Take the five-step guided tour now? [Y/n] ')).trim().toLowerCase();prompt.close();
      if(answer===''||answer==='y'||answer==='yes')return firstRun({args:['--tour']});
      marker={...marker,tour:'skipped',tourUpdatedAt:new Date().toISOString()};await saveMarker(marker);
      console.log('Tour skipped. Run npm run first-run -- --tour whenever you want it.');
    }else console.log('Optional guided tour: npm run first-run -- --tour\nSkip it permanently: npm run first-run -- --skip-tour');
  }
  return marker;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{await firstRun();}catch(error){console.error(`SAAM first-run setup failed: ${error.message}`);process.exitCode=1;}
}
