import {readFile,readdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {parse} from 'acorn';
import {sourceFiles,extractGraph} from './graph.mjs';
import {resourceFiles} from './reference.mjs';

const run=promisify(execFile);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const optional=async path=>readFile(path).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
const inScope=file=>/^(core|studio)\/.+\.mjs$/.test(file)&&!file.includes('/tests/')&&!file.endsWith('.test.mjs');

export async function inputSnapshot(repo) {
  const files=await sourceFiles(repo);
  files.push(...await resourceFiles(repo,['core','studio','maps','skills','adapters']));
  const tooling=await readdir(resolve(repo,'scripts/dev-map')).catch(e=>{if(e.code==='ENOENT')return [];throw e;});
  files.push(...tooling.filter(n=>/\.(mjs|py)$/.test(n)).map(n=>`scripts/dev-map/${n}`));
  for(const path of ['scripts/dev-map.mjs','package.json','package-lock.json'])if(await optional(resolve(repo,path)))files.push(path);
  const inputs=Object.fromEntries(await Promise.all([...new Set(files)].sort().map(async file=>[file,hash(await readFile(resolve(repo,file)))])));
  return {signature:hash(JSON.stringify(inputs)),inputs};
}

export async function buildFreshness(repo,snapshot) {
  const bytes=await optional(resolve(repo,'dev-map/build.json'));
  if(!bytes)return {fresh:false,reason:'No recorded build.'};
  let previous;try{previous=JSON.parse(bytes);}catch{return {fresh:false,reason:'Invalid build manifest.'};}
  if(previous.signature!==snapshot.signature) {
    const files=[...new Set([...Object.keys(snapshot.inputs),...Object.keys(previous.inputs??{})])].filter(f=>snapshot.inputs[f]!==previous.inputs?.[f]);
    return {fresh:false,reason:'Build inputs changed.',files};
  }
  if(!previous.outputs?.['index.html']||!previous.outputs?.['context.json'])return {fresh:false,reason:'Incomplete build manifest.'};
  const changed=[];
  for(const [file,digest] of Object.entries(previous.outputs)) {
    if(!/^[\w.-]+$/.test(file))return {fresh:false,reason:'Invalid output path in build manifest.'};
    const content=await optional(resolve(repo,'dev-map',file));
    if(!content||hash(content)!==digest)changed.push(file);
  }
  return changed.length?{fresh:false,reason:'Generated outputs missing or changed.',files:changed}:{fresh:true};
}

export async function recordBuild(repo,snapshot,outputs) {
  const current=await inputSnapshot(repo);
  if(current.signature!==snapshot.signature)throw Error('Map inputs changed during the build. Rebuild before presenting this viewer.');
  const digests=Object.fromEntries(await Promise.all(outputs.map(async file=>[file,hash(await readFile(resolve(repo,'dev-map',file)))])));
  await writeFile(resolve(repo,'dev-map/build.json'),JSON.stringify({schema:1,...snapshot,outputs:digests},null,2)+'\n');
}

// ASTs retain automatic-semicolon-insertion behavior while ignoring formatting.
// Declaration fragments need their original syntactic context reconstructed.
function syntaxHash(text) {
  for(const candidate of [text,`(${text})`,`const ${text};`,`({${text}})`,`class MapFragment {${text}}`]) {
    try {return hash(JSON.stringify(parse(candidate,{ecmaVersion:'latest',sourceType:'module'}),(k,v)=>['start','end','loc','raw'].includes(k)?undefined:typeof v==='bigint'?String(v):v));}catch{}
  }
  return hash(text);
}
const named=d=>d.anchor&&!d.ambiguousAnchor&&!d.anchor.includes('<callback@');

export async function compareChanges(model,before) {
  const inventory=new Map(model.coverage.inventory.map(d=>[d.anchor,d]));
  const changes=[];
  for(const [file,oldText] of before) {
    if(!inScope(file))continue;
    const current=model.graph.files.find(f=>f.file===file);
    const currentDeclarations=model.graph.declarations.filter(d=>d.file===file);
    const newText=current?await model.readSource(file):null;
    if(oldText!==null&&newText!==null&&syntaxHash(oldText)===syntaxHash(newText))continue;
    const old=oldText===null?[]:(await extractGraph({files:[file],readSource:async()=>oldText})).declarations;
    const eligible=d=>named(d)&&(d.callable||inventory.get(d.anchor)?.status==='direct');
    const oldBy=new Map(old.filter(eligible).map(d=>[d.anchor,d]));
    const newBy=new Map(currentDeclarations.filter(eligible).map(d=>[d.anchor,d]));
    const declarations=[];
    for(const anchor of new Set([...oldBy.keys(),...newBy.keys()])) {
      const a=oldBy.get(anchor),b=newBy.get(anchor);
      if(a&&b&&syntaxHash(a.text)===syntaxHash(b.text))continue;
      const represented=inventory.get(anchor);
      declarations.push({anchor,change:!a?'added':!b?'removed':'modified',line:b?.line??a.line,
        representation:represented?.status??'removed',
        uses:represented?.occurrences??[],enclosing:represented?.enclosing.map(e=>e.occurrences).flat()??[]});
    }
    const anchored=model.pages.flatMap(p=>p.nodes.filter(n=>n.src===file).map(n=>({page:p.key,address:n.num})));
    const responsibility=model.resources?.find(r=>r.file===file)?.responsibility;
    changes.push({file,change:oldText===null?'added':newText===null?'removed':'modified',declarations,mappedUses:anchored,
      ...(responsibility?{responsibility}:{}),
      moduleReview:'Review changed module-level code, callbacks, contracts and unresolved dispatch as well as the listed named declarations.'});
  }
  return {changes,limits:'This is a change-focused review list, not an accuracy certificate. Existing coverage gaps remain visible in containment; no baseline is treated as approval.'};
}

export async function changedSince(model,repo,ref='HEAD') {
  const git=async args=>(await run('git',args,{cwd:repo,maxBuffer:32*1024*1024})).stdout;
  const revision=(await git(['rev-parse','--verify','--end-of-options',`${ref}^{commit}`])).trim();
  const changed=(await git(['diff','--no-renames','--name-only','-z',revision,'--','core','studio','maps'])).split('\0');
  const untracked=(await git(['ls-files','--others','--exclude-standard','-z','--','core','studio','maps'])).split('\0');
  const oldFiles=new Set((await git(['ls-tree','-r','--name-only','-z',revision,'--','core','studio'])).split('\0'));
  const before=new Map();
  for(const file of [...new Set([...changed,...untracked])].filter(inScope).sort())before.set(file,oldFiles.has(file)?await git(['show',`${revision}:${file}`]):null);
  return {base:revision,authoredMaps:[...new Set([...changed,...untracked])].filter(f=>/^maps\/\d.*\.md$/.test(f)).sort(),
    referenceChanges:[...new Set([...changed,...untracked])].filter(f=>/^maps\/reference\/.+\.md$/.test(f)).sort(),
    resourceChanges:[...new Set([...changed,...untracked])].filter(f=>/^(core|studio)\//.test(f)&&!f.endsWith('.mjs')).sort().map(file=>{
      const resource=model.resources?.find(r=>r.file===file);
      return {file,owner:resource?.owner??'removed',...(resource?.responsibility?{responsibility:resource.responsibility}:{})};
    }),
    ...await compareChanges({...model,readSource:file=>readFile(resolve(repo,file),'utf8')},before)};
}

export function changesText(report) {
  const lines=[`Map review since ${report.base??'supplied source'}: ${report.changes.length} changed core/Studio modules.`];
  if(report.authoredMaps?.length)lines.push(`Authored regions changed: ${report.authoredMaps.join(', ')}. Review grouping, labels, boundary and shared contracts.`);
  if(report.referenceChanges?.length)lines.push(`Map-owned contracts changed: ${report.referenceChanges.join(', ')}.`);
  for(const r of report.resourceChanges??[])lines.push(`Resource changed: ${r.file} — owner ${r.owner}. ${r.responsibility?r.responsibility.read+'. ':''}Review its contract and consumers; language extraction is not required for ownership.`);
  for(const file of report.changes) {
    lines.push(`\n${file.change}: ${file.file}`);
    if(file.responsibility)lines.push(`  Change contract: ${file.responsibility.read}`);
    for(const d of file.declarations) {
      const uses=d.uses.length?d.uses:d.enclosing;
      lines.push(`  ${d.change}: ${d.anchor} — ${d.representation}${uses.length?` (${uses.map(u=>u.address).join(', ')})`:''}`);
    }
    lines.push(`  ${file.moduleReview}`);
  }
  lines.push(report.limits);
  return lines.join('\n');
}
