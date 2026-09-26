#!/usr/bin/env node
// Builds an installable SAAM ZIP for one platform: the tracked application
// files, production dependencies, a pinned Node runtime, release.json and the
// platform installer. Alpha builds are unsigned: the macOS installer runs from
// Terminal and the bundled Node is the official notarized build.
//
//   node packaging/build.mjs --platform win-x64 --version 0.1.0 --relay-url https://relay.example.com
//   [--update-host https://releases.example.com] [--node-version v24.19.0 | --node <node binary for that platform>] [--out dist]
// --update-host is the only origin this build accepts updates from; without it the
// build never offers an update.
//
// The ZIP holds one folder: the installer, README.txt, the application as one
// archive (app.tar, so unpacking the ZIP writes a handful of files rather than
// thousands) and app/, which holds only release.json and the installer scripts
// at the path an installed SAAM's update runs them from
// (app/packaging/<os>/install.*). The installer unpacks app.tar straight into the
// installation. An uncompressed tar in the deflated ZIP unpacked faster, with
// Explorer then tar.exe, than a stored app.tar.gz, at the same download size.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cp,mkdir,rm,writeFile,readFile,copyFile,mkdtemp,readdir,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const PLATFORMS={
  'win-x64':{os:'windows',archive:'zip',binary:'node.exe',installer:'Install SAAM.cmd',scripts:['install.ps1','common.ps1']},
  'darwin-arm64':{os:'macos',archive:'tar.gz',binary:'bin/node',installer:'install.sh',scripts:['install.sh']},
  'darwin-x64':{os:'macos',archive:'tar.gz',binary:'bin/node',installer:'install.sh',scripts:['install.sh']}
};
// Tracked files a maker's installation does not need: development maps and
// tooling, tests, the relay service and this packager.
const EXCLUDED=[/^dev-map(-OLD)?\//,/^relay\//,/^tools\//,/^scripts\/bench\//,/^\.(claude|codex|github)\//,/^core\/tests\//,
  /^skills\/[^/]+\/tests\//,/^[^/]+\.html$/,/^result\.json$/,/^packaging\/(build\.mjs|windows\/|macos\/)/];

// manifold-3d depends on these for its manifoldCAD tooling (glTF and 3MF export
// with sharp's image processing, the esbuild bundler, source maps and its CLI).
// SAAM imports only manifold-3d itself (core/geom/solid.mjs), whose manifold.js
// and manifold.wasm use none of them, so the build removes them after npm ci:
// about 700 files and 40 MB. `*` ends a name prefix (sharp's per-platform
// binaries). Before removing anything the build checks package-lock.json that
// only manifold-3d or another listed package needs each one, and fails otherwise.
const MANIFOLD_EXTRAS=['@emnapi/runtime','@gltf-transform/core','@gltf-transform/extensions','@gltf-transform/functions',
  '@img/colour','@img/sharp-*','@jridgewell/resolve-uri','@jridgewell/sourcemap-codec','@jridgewell/trace-mapping',
  '@jscadui/3mf-export','@nodable/entities','@types/ndarray','anynum','commander','convert-source-map','cwise-compiler',
  'detect-libc','esbuild-wasm','fast-xml-builder','fast-xml-parser','fflate','iota-array','is-buffer','is-unsafe',
  'ktx-parse','magic-string','ndarray','ndarray-lanczos','ndarray-ops','ndarray-pixels','path-expression-matcher',
  'property-graph','semver','sharp','strnum','uniq','xml-naming'];

function run(command,args,options={}){
  const result=spawnSync(command,args,{stdio:'inherit',shell:process.platform==='win32'&&/\.cmd$/.test(command),...options});
  if(result.status!==0)throw Error(`${command} ${args.join(' ')} failed (${result.status??result.error?.message}).`);
  return result;
}
// Windows' own bsdtar reads and writes ZIP; a GNU tar earlier on PATH does not.
const TAR=process.platform==='win32'?resolve(process.env.SystemRoot??'C:/Windows','System32','tar.exe'):'tar';
// On a Mac, keep Finder metadata (._ files) out of the archives.
const TAR_ENV={...process.env,COPYFILE_DISABLE:'1'};
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');

async function measure(folder){
  let files=0,bytes=0;
  for(const entry of await readdir(folder,{recursive:true,withFileTypes:true}))
    if(entry.isFile()){files++;bytes+=(await stat(join(entry.parentPath,entry.name))).size;}
  return {files,bytes};
}
const describe=({files,bytes})=>`${files} files, ${(bytes/1e6).toFixed(1)} MB`;

// The installed package paths (package-lock keys) that MANIFOLD_EXTRAS names,
// after checking that nothing outside the list needs them.
function manifoldExtras(lock){
  const packages=lock.packages,nameOf=path=>path.slice(path.lastIndexOf('node_modules/')+'node_modules/'.length);
  const listed=path=>MANIFOLD_EXTRAS.some(entry=>entry.endsWith('*')?nameOf(path).startsWith(entry.slice(0,-1)):nameOf(path)===entry);
  // Node's resolution: the nearest node_modules/<name> from the requiring package outwards.
  const resolveFrom=(from,name)=>{
    for(let base=from;;base=base.slice(0,Math.max(base.lastIndexOf('/node_modules/'),0))){
      const path=(base?base+'/':'')+'node_modules/'+name;
      if(packages[path])return path;
      if(!base)return null;
    }
  };
  // Everything the application needs, with manifold-3d's own dependencies left out.
  const needed=new Set(),pending=[''];
  while(pending.length){
    const path=pending.pop();if(needed.has(path))continue;needed.add(path);
    if(path==='node_modules/manifold-3d')continue;
    const entry=packages[path];
    for(const name of Object.keys({...entry.dependencies,...entry.optionalDependencies,...(path?entry.peerDependencies:{})})){
      const found=resolveFrom(path,name);if(found)pending.push(found);
    }
  }
  const clash=[...needed].filter(path=>path&&listed(path));
  if(clash.length)throw Error(`Not removing ${clash.join(', ')}: another dependency needs it. Update MANIFOLD_EXTRAS in packaging/build.mjs.`);
  const production=Object.keys(packages).filter(path=>path&&!packages[path].dev);
  const unlisted=production.filter(path=>!needed.has(path)&&!listed(path));
  if(unlisted.length)console.warn(`Only manifold-3d needs ${unlisted.join(', ')}, which MANIFOLD_EXTRAS does not list; they stay in the build.`);
  return production.filter(listed);
}

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
    'node-version':{type:'string',default:process.version},node:{type:'string'},out:{type:'string',default:'dist'},'update-host':{type:'string'}}});
  const platform=values.platform,target=PLATFORMS[platform];
  if(!target)throw Error(`Choose --platform: ${Object.keys(PLATFORMS).join(', ')}.`);
  if(!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(values.version??''))throw Error('Give --version as major.minor.patch.');
  const relayUrl=new URL(values['relay-url']??'').origin;
  if(!relayUrl.startsWith('https://')&&!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(relayUrl))throw Error('The relay URL must be https (or loopback for a local test build).');
  const updateHost=values['update-host']?new URL(values['update-host']).origin:null;
  if(updateHost&&!updateHost.startsWith('https://'))throw Error('The update host must be https.');
  // stage/app is the application; stage/<top> becomes the ZIP.
  const top=`SAAM-${values.version}-${platform}`,out=resolve(root,values.out),app=resolve(out,'stage','app'),folder=resolve(out,'stage',top);
  await rm(resolve(out,'stage'),{recursive:true,force:true});await mkdir(app,{recursive:true});await mkdir(folder,{recursive:true});

  const tracked=spawnSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).stdout.split('\0').filter(Boolean);
  const files=tracked.filter(file=>!EXCLUDED.some(pattern=>pattern.test(file)));
  for(const file of files){await mkdir(dirname(resolve(app,file)),{recursive:true});await copyFile(resolve(root,file),resolve(app,file));}
  await cp(resolve(root,'packaging',target.os),resolve(app,'packaging',target.os),{recursive:true});
  console.log(`Copied ${files.length} tracked files.`);

  run(process.platform==='win32'?'npm.cmd':'npm',['ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],{cwd:app});
  const modules=resolve(app,'node_modules'),installed=await measure(modules);
  for(const path of manifoldExtras(JSON.parse(await readFile(resolve(app,'package-lock.json'),'utf8'))))
    await rm(resolve(app,path),{recursive:true,force:true});
  // Command shims for npm scripts; an installed SAAM runs none.
  await rm(resolve(modules,'.bin'),{recursive:true,force:true});
  console.log(`node_modules: ${describe(installed)} installed, ${describe(await measure(modules))} kept.`);

  const runtime=resolve(app,'runtime');
  if(values.node){await mkdir(runtime,{recursive:true});await copyFile(resolve(values.node),resolve(runtime,target.binary.split('/').pop()));
    console.warn('Bundled the given node binary; it must be built for',platform+'.');}
  else await fetchNode(values['node-version'],platform,runtime);

  const release={version:values.version,relayUrl,platform,updateHost,node:values.node?'supplied':values['node-version'],builtAt:new Date().toISOString()};
  const releaseJson=JSON.stringify(release,null,2)+'\n';
  await writeFile(resolve(app,'release.json'),releaseJson);
  console.log(`Application: ${describe(await measure(app))}.`);
  run(TAR,['-cf',resolve(folder,'app.tar'),'-C',app,'.'],{env:TAR_ENV});

  // The installer and what it needs before app.tar is unpacked.
  await copyFile(resolve(root,'packaging',target.os,target.installer),resolve(folder,target.installer));
  await copyFile(resolve(root,'packaging',target.os,'README.txt'),resolve(folder,'README.txt'));
  const scripts=resolve(folder,'app','packaging',target.os);await mkdir(scripts,{recursive:true});
  for(const script of target.scripts)await copyFile(resolve(root,'packaging',target.os,script),resolve(scripts,script));
  await writeFile(resolve(folder,'app','release.json'),releaseJson);

  const zip=resolve(out,`${top}.zip`);await rm(zip,{force:true});
  run(TAR,['-a','-cf',zip,'-C',resolve(out,'stage'),top],{env:TAR_ENV});
  console.log(`Built ${zip}: ${((await stat(zip)).size/1e6).toFixed(1)} MB (${JSON.stringify(release)}).`);
  // To offer this build as an update, host the ZIP under the update host and add
  // this entry to the relay's LATEST_RELEASE assets (see relay/wrangler.jsonc).
  console.log('LATEST_RELEASE asset:',JSON.stringify({[platform]:{url:(updateHost??'https://<update host>')+'/<path>/'+top+'.zip',sha256:sha256(await readFile(zip))}}));
}

main().catch(error=>{console.error('Build failed:',error.message);process.exitCode=1;});
