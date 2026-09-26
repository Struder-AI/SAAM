#!/usr/bin/env node
// Builds an installable SAAM ZIP for one platform: the tracked application
// files, production dependencies, a pinned Node runtime, release.json and the
// platform installer. Alpha builds are unsigned: the macOS installer runs from
// Terminal and the bundled Node is the official notarized build.
//
//   node packaging/build.mjs --platform win-x64 --version 0.1.0 --relay-url https://relay.example.com
//   [--node-version v24.19.0 | --node <path to a node binary for that platform>] [--out dist]
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cp,mkdir,rm,writeFile,copyFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const PLATFORMS={
  'win-x64':{os:'windows',archive:'zip',binary:'node.exe',installer:'Install SAAM.cmd'},
  'darwin-arm64':{os:'macos',archive:'tar.gz',binary:'bin/node',installer:'install.sh'},
  'darwin-x64':{os:'macos',archive:'tar.gz',binary:'bin/node',installer:'install.sh'}
};
// Tracked files a maker's installation does not need: development maps and
// tooling, tests, the relay service and this packager.
const EXCLUDED=[/^dev-map(-OLD)?\//,/^relay\//,/^tools\//,/^scripts\/bench\//,/^\.(claude|codex|github)\//,/^core\/tests\//,
  /^skills\/[^/]+\/tests\//,/^[^/]+\.html$/,/^result\.json$/,/^packaging\/(build\.mjs|windows\/|macos\/)/];

function run(command,args,options={}){
  const result=spawnSync(command,args,{stdio:'inherit',shell:process.platform==='win32'&&/\.cmd$/.test(command),...options});
  if(result.status!==0)throw Error(`${command} ${args.join(' ')} failed (${result.status??result.error?.message}).`);
  return result;
}
// Windows' own bsdtar reads and writes ZIP; a GNU tar earlier on PATH does not.
const TAR=process.platform==='win32'?resolve(process.env.SystemRoot??'C:/Windows','System32','tar.exe'):'tar';
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');

// The official Node build for the platform, checked against the release's SHASUMS256.
async function fetchNode(version,platform,into){
  const {archive,binary}=PLATFORMS[platform],name=`node-${version}-${platform}`,file=`${name}.${archive}`;
  const base=`https://nodejs.org/dist/${version}/`;
  const sums=await(await fetch(base+'SHASUMS256.txt')).text();
  const expected=sums.split('\n').map(line=>line.trim().split(/\s+/)).find(([,entry])=>entry===file)?.[0];
  if(!expected)throw Error(`No published checksum for ${file}.`);
  const response=await fetch(base+file);if(!response.ok)throw Error(`Download of ${file} failed: ${response.status}.`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(sha256(bytes)!==expected)throw Error(`Checksum mismatch for ${file}.`);
  const scratch=await mkdtemp(join(tmpdir(),'saam-node-'));
  try{
    await writeFile(join(scratch,file),bytes);
    run(TAR,['-xf',file,`${name}/${binary}`,`${name}/LICENSE`],{cwd:scratch});
    await mkdir(into,{recursive:true});
    await copyFile(join(scratch,name,binary),join(into,binary.split('/').pop()));
    await copyFile(join(scratch,name,'LICENSE'),join(into,'LICENSE'));
  }finally{await rm(scratch,{recursive:true,force:true});}
}

async function main(){
  const {values}=parseArgs({options:{platform:{type:'string'},version:{type:'string'},'relay-url':{type:'string'},
    'node-version':{type:'string',default:process.version},node:{type:'string'},out:{type:'string',default:'dist'}}});
  const platform=values.platform,target=PLATFORMS[platform];
  if(!target)throw Error(`Choose --platform: ${Object.keys(PLATFORMS).join(', ')}.`);
  if(!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(values.version??''))throw Error('Give --version as major.minor.patch.');
  const relayUrl=new URL(values['relay-url']??'').origin;
  if(!relayUrl.startsWith('https://')&&!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(relayUrl))throw Error('The relay URL must be https (or loopback for a local test build).');
  const top=`SAAM-${values.version}-${platform}`,out=resolve(root,values.out),stage=resolve(out,'stage',top),app=resolve(stage,'app');
  await rm(resolve(out,'stage'),{recursive:true,force:true});await mkdir(app,{recursive:true});

  const tracked=spawnSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).stdout.split('\0').filter(Boolean);
  const files=tracked.filter(file=>!EXCLUDED.some(pattern=>pattern.test(file)));
  for(const file of files){await mkdir(dirname(resolve(app,file)),{recursive:true});await copyFile(resolve(root,file),resolve(app,file));}
  await cp(resolve(root,'packaging',target.os),resolve(app,'packaging',target.os),{recursive:true});
  console.log(`Copied ${files.length} tracked files.`);

  run(process.platform==='win32'?'npm.cmd':'npm',['ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],{cwd:app});

  const runtime=resolve(app,'runtime');
  if(values.node){await mkdir(runtime,{recursive:true});await copyFile(resolve(values.node),resolve(runtime,target.binary.split('/').pop()));
    console.warn('Bundled the given node binary; it must be built for',platform+'.');}
  else await fetchNode(values['node-version'],platform,runtime);

  const release={version:values.version,relayUrl,platform,node:values.node?'supplied':values['node-version'],builtAt:new Date().toISOString()};
  await writeFile(resolve(app,'release.json'),JSON.stringify(release,null,2)+'\n');
  await copyFile(resolve(root,'packaging',target.os,target.installer),resolve(stage,target.installer));
  await copyFile(resolve(root,'packaging',target.os,'README.txt'),resolve(stage,'README.txt'));

  const zip=resolve(out,`${top}.zip`);await rm(zip,{force:true});
  run(TAR,['-a','-cf',zip,'-C',resolve(out,'stage'),top]);
  console.log(`Built ${zip} (${JSON.stringify(release)}).`);
}

main().catch(error=>{console.error('Build failed:',error.message);process.exitCode=1;});
