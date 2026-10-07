#!/usr/bin/env node
// Builds installable SAAM ZIPs: the tracked application files, production
// dependencies, a pinned Node runtime, release.json and the platform installer.
// Alpha builds are unsigned: the macOS launcher uses its menu-bar application
// and bundled Node is the official notarized build.
//
//   node packaging/build.mjs --version 0.1.0 --relay-url https://relay.example.com [--platform win-x64,darwin-arm64,darwin-x64]
//   [--update-host https://github.com/Struder-AI/SAAM/releases/download] [--node-version v24.19.0 | --node <node binary for one platform>]
//   [--mesh-repair DIR] [--modules DIR] [--out dist]
//   [--review --review-file packaging/application.mjs --review-file packaging/release-service.mjs]
// Each platform (all three by default) builds into <out>/<platform>/. --update-host is the release
// folder this build accepts updates from (see packaging/update.mjs); without it the build never offers an update.
// --mesh-repair applies to the platform its helper targets.
//
// Nothing is installed from the network. Dependencies come once per run from an installed
// node_modules (--modules, default this checkout's), checked against package-lock.json; Node
// runtimes come from build/node-runtime/<version>/, checked against nodejs.org's SHASUMS256
// each build, and an official archive is fetched only when that cache lacks it.
//
// The ZIP holds one folder: the Windows double-click installer, README.txt, the application as one
// archive (app.tar, so unpacking the ZIP writes a handful of files rather than
// thousands) and app/, which holds only release.json and the installer scripts
// at the path an installed SAAM's update runs them from
// (app/packaging/<os>/install.*). The installer unpacks app.tar straight into the
// installation. An uncompressed tar in the deflated ZIP unpacked faster, with
// Explorer then tar.exe, than a stored app.tar.gz, at the same download size.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {cp,mkdir,rm,writeFile,readFile,copyFile,mkdtemp,readdir,stat} from 'node:fs/promises';
import {builtinModules} from 'node:module';
import {tmpdir} from 'node:os';
import {resolve,dirname,join,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {zipSync} from 'fflate';
import {executablePlatform,packageNativeRepair} from './native-repair.mjs';
import {orchestratorContract} from '../core/application/runtime-selection.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const PLATFORMS={
  'win-x64':{os:'windows',archive:'zip',binary:'node.exe',installer:'Install SAAM.cmd',scripts:['install.ps1','common.ps1']},
  'darwin-arm64':{os:'macos',archive:'tar.gz',binary:'bin/node',scripts:['install.sh']},
  'darwin-x64':{os:'macos',archive:'tar.gz',binary:'bin/node',scripts:['install.sh']}
};
// Tracked files a maker's installation does not need: development maps and
// tooling, tests, the relay service and this packager.
const EXCLUDED=[/^dev-map(-OLD)?\//,/^relay\//,/^tools\//,/^scripts\/bench\//,/^\.(claude|codex|github)\//,/^core\/tests\//,
  /^skills\/[^/]+\/tests\//,/^[^/]+\.html$/,/^result\.json$/,/^plans\//,/^adapters\/mcp\//,
  /^packaging\/(build\.mjs|README\.md|INSTALL\.md|windows\/|macos\/)/];

// SAAM imports manifold-3d's root (core/geom/solid.mjs): manifold.js, which loads manifold.wasm.
// Its other files and all its dependencies serve the manifoldCAD tooling (glTF and 3MF export,
// sharp, esbuild, its CLI), so the package ships only these files and none of its dependencies.
const PACKAGE_FILES={'manifold-3d':['package.json','LICENSE','manifold.js','manifold.wasm']};

function run(command,args,options={}){
  const result=spawnSync(command,args,{stdio:'inherit',...options});
  if(result.status!==0)throw Error(`${command} ${args.join(' ')} failed (${result.status??result.error?.message}).`);
  return result;
}
// Windows' own bsdtar reads and writes ZIP; a GNU tar earlier on PATH does not.
const TAR=process.platform==='win32'?resolve(process.env.SystemRoot??'C:/Windows','System32','tar.exe'):'tar';
// On a Mac, keep Finder metadata (._ files) out of the archives.
const TAR_ENV={...process.env,COPYFILE_DISABLE:'1'};
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const readJson=async path=>JSON.parse(await readFile(path,'utf8'));
const nameOf=path=>path.slice(path.lastIndexOf('node_modules/')+'node_modules/'.length);

async function measure(folder){
  let files=0,bytes=0;
  for(const entry of await readdir(folder,{recursive:true,withFileTypes:true}))
    if(entry.isFile()){files++;bytes+=(await stat(join(entry.parentPath,entry.name))).size;}
  return {files,bytes};
}
const describe=({files,bytes})=>`${files} files, ${(bytes/1e6).toFixed(1)} MB`;

// Windows cannot set Unix modes on disk, so the Mac ZIP records them itself.
async function writeMacZip(folder,zip){
  const entries={};
  for(const entry of await readdir(folder,{recursive:true,withFileTypes:true})){
    const path=join(entry.parentPath,entry.name),name=relative(dirname(folder),path).replaceAll('\\','/');
    const directory=entry.isDirectory(),mode=directory?0o40755:0o100644;
    entries[name+(directory?'/':'')]=[directory?new Uint8Array():await readFile(path),{os:3,attrs:(mode<<16)>>>0}];
  }
  await writeFile(zip,zipSync(entries));
}

// The production dependencies, copied from an installed node_modules into `into`: every package
// the application's dependencies reach through package-lock.json, except manifold-3d's own.
// Each installed copy must carry the lock's version and, where npm recorded it, its integrity.
async function dependencySet(lock,source,into){
  const packages=lock.packages,hidden=await readJson(join(source,'.package-lock.json')).then(record=>record.packages).catch(()=>null);
  if(!hidden)console.warn(`No ${join(source,'.package-lock.json')}: installed integrity not checked.`);
  // Node's resolution: the nearest node_modules/<name> from the requiring package outwards.
  const resolveFrom=(from,name)=>{
    for(let base=from;;base=base.slice(0,Math.max(base.lastIndexOf('/node_modules/'),0))){
      const path=(base?base+'/':'')+'node_modules/'+name;
      if(packages[path])return path;
      if(!base)return null;
    }
  };
  const needed=new Set(),pending=[''];
  while(pending.length){
    const path=pending.pop();if(needed.has(path))continue;needed.add(path);
    if(PACKAGE_FILES[nameOf(path)])continue;
    const entry=packages[path];
    for(const name of Object.keys({...entry.dependencies,...entry.optionalDependencies,...(path?entry.peerDependencies:{})})){
      const found=resolveFrom(path,name);if(found)pending.push(found);
    }
  }
  needed.delete('');
  for(const path of needed){
    const entry=packages[path],name=nameOf(path);
    const from=join(source,path.slice('node_modules/'.length)),to=join(into,path.slice('node_modules/'.length));
    if(entry.os||entry.cpu)throw Error(`${path} is platform-specific; it cannot come from this host's node_modules.`);
    if(!existsSync(from)){if(entry.optional)continue;throw Error(`${from} is missing: run npm ci in the checkout that supplies --modules.`);}
    const version=(await readJson(join(from,'package.json'))).version;
    if(version!==entry.version)throw Error(`${path} is ${version}; package-lock.json needs ${entry.version}.`);
    const installed=hidden?.[path];
    if(hidden&&(!installed||installed.version!==entry.version||installed.integrity!==entry.integrity))throw Error(`${path} was not installed from package-lock.json's ${entry.version} (integrity differs).`);
    if(PACKAGE_FILES[name]){await mkdir(to,{recursive:true});for(const file of PACKAGE_FILES[name])await copyFile(join(from,file),join(to,file));}
    else await cp(from,to,{recursive:true,filter:file=>!relative(from,file).split(sep).includes('node_modules')});
  }
  return needed.size;
}

// Every bare import in the application's own code must resolve to a file in its node_modules.
async function checkImports(app,files){
  const pattern=/(?:^|[^\w$.])(?:import|export)\s+(?:[^'"`;]*?\sfrom\s*)?['"]([^'"\n]+)['"]|(?:^|[^\w$.])import\s*\(\s*['"]([^'"\n]+)['"]\s*\)|(?:^|[^\w$.])require\s*\(\s*['"]([^'"\n]+)['"]\s*\)/gm;
  const missing=new Set();
  for(const file of files.filter(file=>/\.(m?js|cjs)$/.test(file))){
    for(const match of (await readFile(resolve(app,file),'utf8')).matchAll(pattern)){
      const specifier=match[1]??match[2]??match[3];
      if(/^(\.|\/|[a-z]+:)/.test(specifier)||builtinModules.includes(specifier))continue;
      const parts=specifier.split('/'),name=parts.slice(0,specifier.startsWith('@')?2:1).join('/'),subpath=['.',...parts.slice(name.split('/').length)].join('/');
      const folder=resolve(app,'node_modules',name),manifest=await readJson(join(folder,'package.json')).catch(()=>null);
      let exports=manifest?.exports,target=null;
      if(manifest&&exports===undefined)target=subpath==='.'?manifest.main??'index.js':subpath;
      else if(manifest){
        if(typeof exports==='string'||!Object.keys(exports).some(key=>key.startsWith('.')))exports={'.':exports};
        target=exports[subpath];
      }
      while(target&&typeof target==='object')target=target.import??target.node??target.default;
      if(!target||!existsSync(join(folder,target)))missing.add(`${specifier} (${file})`);
    }
  }
  if(missing.size)throw Error(`The dependency set lacks imports: ${[...missing].join(', ')}.`);
}

// The official Node runtime for the platform, copied into `into`. build/node-runtime/<version>/ caches
// nodejs.org's SHASUMS256.txt and each official archive; every build checks them against it. win-x64 may
// instead be seeded from this host's own Node when it is that version and its node.exe carries the
// published win-x64/node.exe checksum (LICENSE from another verified archive of the version).
async function nodeRuntime(version,platform,into){
  const cache=resolve(root,'build','node-runtime',version),sumsFile=join(cache,'SHASUMS256.txt');
  await mkdir(cache,{recursive:true});
  if(!existsSync(sumsFile)){
    const response=await fetch(`https://nodejs.org/dist/${version}/SHASUMS256.txt`);
    if(!response.ok)throw Error(`No SHASUMS256.txt for Node ${version}: ${response.status}.`);
    await writeFile(sumsFile,await response.text());
  }
  const sums=new Map((await readFile(sumsFile,'utf8')).split('\n').map(line=>line.trim().split(/\s+/).reverse()));
  const archiveOf=async target=>{
    const file=`node-${version}-${target}.${PLATFORMS[target].archive}`,path=join(cache,file),expected=sums.get(file);
    if(!expected)throw Error(`No published checksum for ${file}.`);
    if(!existsSync(path)){
      const response=await fetch(`https://nodejs.org/dist/${version}/${file}`);if(!response.ok)throw Error(`Download of ${file} failed: ${response.status}.`);
      const bytes=Buffer.from(await response.arrayBuffer());
      if(sha256(bytes)!==expected)throw Error(`Checksum mismatch for ${file}.`);
      await writeFile(path,bytes);console.log(`Fetched ${file} into ${cache}.`);
    }
    if(sha256(await readFile(path))!==expected)throw Error(`Cached ${path} does not match SHASUMS256.txt.`);
    return {path,name:`node-${version}-${target}`};
  };
  const extract=async({path,name},entries)=>{
    const scratch=await mkdtemp(join(tmpdir(),'saam-node-'));
    try{
      run(TAR,['-xf',path,...entries.map(entry=>`${name}/${entry}`)],{cwd:scratch});
      await mkdir(into,{recursive:true});
      for(const entry of entries)await copyFile(join(scratch,name,entry),join(into,entry.split('/').pop()));
    }finally{await rm(scratch,{recursive:true,force:true});}
  };
  const {binary}=PLATFORMS[platform];
  if(platform==='win-x64'&&!existsSync(join(cache,`node-${version}-win-x64.zip`))){
    const seeded=join(cache,'win-x64'),exe=join(seeded,'node.exe'),expected=sums.get('win-x64/node.exe');
    if(!existsSync(exe)&&process.platform==='win32'&&process.version===version&&sha256(await readFile(process.execPath))===expected){
      await mkdir(seeded,{recursive:true});await copyFile(process.execPath,exe);
      await extract(await archiveOf('darwin-arm64'),['LICENSE']).then(()=>copyFile(join(into,'LICENSE'),join(seeded,'LICENSE')));
      console.log(`Seeded ${seeded} from ${process.execPath}.`);
    }
    if(existsSync(exe)){
      if(!expected||sha256(await readFile(exe))!==expected)throw Error(`Cached ${exe} does not match win-x64/node.exe in SHASUMS256.txt.`);
      await mkdir(into,{recursive:true});await copyFile(exe,join(into,'node.exe'));await copyFile(join(seeded,'LICENSE'),join(into,'LICENSE'));
      return;
    }
  }
  await extract(await archiveOf(platform),[binary,'LICENSE']);
}

async function main(){
  const {values}=parseArgs({options:{platform:{type:'string',multiple:true},version:{type:'string'},'relay-url':{type:'string'},
    'node-version':{type:'string',default:process.version},node:{type:'string'},out:{type:'string',default:'dist'},'update-host':{type:'string'},'mesh-repair':{type:'string'},
    modules:{type:'string'},review:{type:'boolean',default:false},'review-file':{type:'string',multiple:true}}});
  const platforms=values.platform?.flatMap(value=>value.split(','))??Object.keys(PLATFORMS);
  for(const platform of platforms)if(!PLATFORMS[platform])throw Error(`Choose --platform from ${Object.keys(PLATFORMS).join(', ')}.`);
  if(values.node&&platforms.length!==1)throw Error('--node supplies one platform\'s runtime: give one --platform.');
  if(!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(values.version??''))throw Error('Give --version as major.minor.patch.');
  const relayUrl=new URL(values['relay-url']??'').origin;
  if(!relayUrl.startsWith('https://')&&!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(relayUrl))throw Error('The relay URL must be https (or loopback for a local test build).');
  // The release folder updates come from, e.g. https://github.com/Struder-AI/SAAM/releases/download:
  // an installed SAAM accepts only <update host>/v<version>/SAAM-<version>-<platform>.zip.
  const updateHost=values['update-host']?(({origin,pathname})=>origin+pathname.replace(/\/+$/,''))(new URL(values['update-host'])):null;
  if(updateHost&&!updateHost.startsWith('https://')&&!(values.review&&/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(?:\/|$)/.test(updateHost)))
    throw Error('The update host must be https (or loopback in a review build).');
  const out=resolve(root,values.out),relativeOut=relative(root,out).replaceAll('\\','/');
  if(!relativeOut||relativeOut==='..'||relativeOut.startsWith('../'))throw Error('The output directory must be inside the repository, not the repository root.');
  const outputPrefix=relativeOut+'/';
  const tracked=spawnSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).stdout.split('\0').filter(Boolean);
  const untracked=spawnSync('git',['ls-files','-z','--others','--exclude-standard'],{cwd:root,encoding:'utf8'}).stdout.split('\0').filter(Boolean);
  const selected=values['review-file']??[];
  if(selected.length&&!values.review)throw Error('--review-file requires --review.');
  const platformFile=file=>platforms.some(platform=>file.startsWith(`packaging/${PLATFORMS[platform].os}/`));
  for(const file of selected)if(!untracked.includes(file)||(EXCLUDED.some(pattern=>pattern.test(file))&&!platformFile(file)))
    throw Error(`Review source must be an untracked application file: ${file}`);
  const unpacked=untracked.filter(file=>!file.startsWith(outputPrefix)&&(!EXCLUDED.some(pattern=>pattern.test(file))||platformFile(file))&&!selected.includes(file));
  if(unpacked.length)throw Error(`Untracked application files need explicit --review-file selections: ${unpacked.join(', ')}`);
  const dirty=spawnSync('git',['status','--porcelain','--untracked-files=no'],{cwd:root,encoding:'utf8'}).stdout.trim();
  if(dirty&&!values.review)throw Error('Release builds require a clean tracked snapshot. Use --review for an isolated candidate build.');
  if(values.review)console.warn(`Review build from on-disk source; selected untracked files: ${selected.join(', ')||'(none)'}. Do not publish this artifact.`);
  // Packages copy on-disk bytes. A file checked out before .gitattributes still reads clean to
  // git status with other line endings, which breaks hashed data such as the Wing airfoils.
  const stale=spawnSync('git',['ls-files','--eol','-z'],{cwd:root,encoding:'utf8'}).stdout.split('\0').filter(Boolean).flatMap(line=>{
    const [,index,disk]=/^i\/(\S*)\s+w\/(\S*)/.exec(line),expected=index==='lf'&&/\beol=crlf\b/.test(line)?'crlf':index;
    return disk&&disk!==expected?[line.slice(line.indexOf('\t')+1)]:[];});
  if(stale.length)throw Error(`${stale.length} files on disk have line endings other than .gitattributes gives (e.g. ${stale.slice(0,3).join(', ')}); build from a fresh checkout.`);
  const files=[...tracked,...selected].filter(file=>existsSync(resolve(root,file))&&!EXCLUDED.some(pattern=>pattern.test(file)));
  const helper=values['mesh-repair']&&resolve(values['mesh-repair']);
  const helperFor=platform=>helper&&existsSync(join(helper,'saam-mesh-repair'+(platform==='win-x64'?'.exe':'')))?helper:undefined;
  if(helper&&!platforms.some(helperFor))throw Error(`${helper} holds no native helper for ${platforms.join(', ')}.`);

  const modules=resolve(out,'modules');
  await rm(modules,{recursive:true,force:true});
  const count=await dependencySet(await readJson(resolve(root,'package-lock.json')),resolve(values.modules??resolve(root,'node_modules')),modules);
  console.log(`Dependencies: ${count} packages, ${describe(await measure(modules))}.`);

  for(const platform of platforms){
    const target=PLATFORMS[platform],base=resolve(out,platform);
    // stage/app is the application; stage/<top> becomes the ZIP.
    const top=`SAAM-${values.version}-${platform}`,app=resolve(base,'stage','app'),folder=resolve(base,'stage',top);
    await rm(resolve(base,'stage'),{recursive:true,force:true});await mkdir(app,{recursive:true});await mkdir(folder,{recursive:true});
    for(const file of files){await mkdir(dirname(resolve(app,file)),{recursive:true});await copyFile(resolve(root,file),resolve(app,file));}
    await cp(resolve(root,'packaging',target.os),resolve(app,'packaging',target.os),{recursive:true});
    console.log(`${platform}: copied ${files.length} tracked files.`);
    const nativeRepair=await packageNativeRepair({root,app,platform,artifact:helperFor(platform)});
    console.log('Native mesh repair:',nativeRepair.available?'included for '+platform:nativeRepair.reason);
    await cp(modules,resolve(app,'node_modules'),{recursive:true});
    await checkImports(app,files);

    const runtime=resolve(app,'runtime');
    if(values.node){
      const binary=resolve(values.node),bytes=await readFile(binary);
      if(executablePlatform(bytes)!==platform)throw Error(`The supplied Node binary does not target ${platform}.`);
      const license=resolve(dirname(binary),'LICENSE');
      if(!existsSync(license))throw Error('The supplied Node binary needs its adjacent LICENSE file.');
      await mkdir(runtime,{recursive:true});
      await copyFile(binary,resolve(runtime,target.binary.split('/').pop()));
      await copyFile(license,resolve(runtime,'LICENSE'));
    }
    else await nodeRuntime(values['node-version'],platform,runtime);

    const release={version:values.version,contract:orchestratorContract,relayUrl,platform,updateHost,node:values.node?'supplied':values['node-version'],nativeRepair,builtAt:new Date().toISOString(),...(values.review?{reviewBuild:true}:{})};
    const releaseJson=JSON.stringify(release,null,2)+'\n';
    await writeFile(resolve(app,'release.json'),releaseJson);
    console.log(`Application: ${describe(await measure(app))}.`);
    // The package is accepted only when its own modules pass the setup check in a disposable home,
    // on its own Node when this host can run it.
    const host=(process.platform==='win32'?'win':process.platform)+'-'+process.arch,home=resolve(base,'stage','home');
    if(host!==platform)console.warn(`Setup check: this ${host} host runs the ${platform} package's modules on its own Node ${process.version}.`);
    run(host===platform?resolve(runtime,target.binary.split('/').pop()):process.execPath,['scripts/setup-check.mjs'],{cwd:app,env:{...process.env,SAAM_DATA:home}});
    await rm(home,{recursive:true,force:true});
    run(TAR,['-cf',resolve(folder,'app.tar'),'-C',app,'.'],{env:TAR_ENV});

    // What installation needs before app.tar is unpacked. macOS has no double-click
    // installer: an agent installs it (a browser download meets Gatekeeper).
    if(target.installer)await copyFile(resolve(root,'packaging',target.os,target.installer),resolve(folder,target.installer));
    await copyFile(resolve(root,'packaging',target.os,'README.txt'),resolve(folder,'README.txt'));
    const scripts=resolve(folder,'app','packaging',target.os);await mkdir(scripts,{recursive:true});
    for(const script of target.scripts)await copyFile(resolve(root,'packaging',target.os,script),resolve(scripts,script));
    await writeFile(resolve(folder,'app','release.json'),releaseJson);

    const zip=resolve(base,`${top}.zip`);await rm(zip,{force:true});
    if(target.os==='macos')await writeMacZip(folder,zip);
    else run(TAR,['-a','-cf',zip,'-C',resolve(base,'stage'),top],{env:TAR_ENV});
    const digest=sha256(await readFile(zip));
    await writeFile(zip+'.sha256',`${digest}  ${top}.zip\n`);
    console.log(`Built ${zip}: ${((await stat(zip)).size/1e6).toFixed(1)} MB (${JSON.stringify(release)}).`);
    // To offer this build as an update, host the ZIP under the update host and add
    // this entry to the relay's LATEST_RELEASE assets (see relay/wrangler.jsonc).
    console.log('LATEST_RELEASE asset:',JSON.stringify({[platform]:{url:(updateHost??'https://<update host>')+`/v${values.version}/${top}.zip`,sha256:digest}}));
  }
  await rm(modules,{recursive:true,force:true});
  await copyFile(resolve(root,'packaging','INSTALL.md'),resolve(out,'INSTALL.md'));
}

main().catch(error=>{console.error('Build failed:',error.message);process.exitCode=1;});
