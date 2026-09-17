import {readdir, readFile, lstat} from 'node:fs/promises';
import {resolve, posix} from 'node:path';
import {createHash} from 'node:crypto';
import {readGuidance, guidanceSection} from '../../core/agent/manuals.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const safe = path => !posix.isAbsolute(path) && !path.split('/').some(p=>!p||p==='..'||p==='.') && !/[\\:*?<>|]/.test(path);

export function representationRequirement(file) {
  if (/^(skills|adapters)\//.test(file)) return {expectation:'outside-scope',label:'Map representation not required',reason:'Separate component guidance; shared core/Studio calls remain impact evidence.'};
  if (file.includes('/tests/') || /\.test\.[^.]+$/.test(file)) return {expectation:'verification-only',label:'No implementation box required',reason:'Verification evidence; link from the owning map contract.'};
  if (/\.(mjs|js|cjs|ts|tsx|jsx|cpp|c|h|hpp|py|wasm|rs|go|java|cs)$/.test(file)) return {expectation:'required',label:'Map representation required',reason:'Core/Studio implementation: explain responsibilities and behavior in the map and its contracts. Helpers may be enclosed; ownership alone is insufficient.'};
  return {expectation:'reference-only',label:'No implementation box required',reason:'Supporting asset, build input or documentation: retain an owning map reference and explain relevant constraints.'};
}

export async function resourceFiles(repo, roots=['core','studio']) {
  const files=[];
  async function walk(path) {
    const stat=await lstat(resolve(repo,path)).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
    if(!stat||stat.isSymbolicLink())return;
    if(stat.isDirectory()) {
      for(const entry of await readdir(resolve(repo,path)))if(!['node_modules','.local','build','dist','__pycache__'].includes(entry))await walk(`${path}/${entry}`);
    } else if(stat.isFile())files.push(path);
  }
  for(const path of roots)await walk(path);
  return [...new Set(files)].sort();
}

export async function loadReferences(repo, regions) {
  const references=[],scopes=[];
  for(const region of regions) {
    for(const row of region.references) {
      const [id,path,purpose]=row;
      if(row.length!==3||!/^[a-z][a-z0-9-]*$/.test(id)||!safe(path)||!path.startsWith('maps/')||!purpose)throw Error(`${region.source}: invalid map reference ${row.join(' | ')}`);
      if(references.some(r=>r.id===id||r.path===path))throw Error(`Duplicate map reference ${id}: contracts have one owner.`);
      const doc=await readGuidance(repo,path);
      references.push({id,path,purpose,owner:region.pages[0].key,source:region.source,text:doc.text,
        sha256:digest(doc.text),headings:doc.headings,links:doc.links});
    }
    for(const [path,purpose] of region.scopes) {
      if(!safe(path.replace(/\/$/,''))||!purpose)throw Error(`${region.source}: invalid ownership path ${path}`);
      if(scopes.some(s=>s.path===path))throw Error(`Duplicate ownership rule ${path}`);
      scopes.push({path,purpose,owner:region.pages[0].key,source:region.source});
    }
  }
  for(const file of await resourceFiles(repo,['maps/reference'])) {
    if(file.endsWith('.md')&&!references.some(r=>r.path===file))throw Error(`Map reference has no owning region: ${file}`);
  }
  const documents=new Map(references.map(r=>[r.path,r]));
  for(const reference of references)for(const link of reference.links) {
    const [path,heading]=link.guidanceId.split('#');
    if(!documents.has(path))documents.set(path,await readGuidance(repo,path));
    if(heading&&!documents.get(path).headings.some(h=>h.guidanceId.split('#')[1]===heading))
      throw Error(`${reference.path}: missing contract link ${link.guidanceId}`);
  }
  // The most specific rule assigns a file's maintenance owner. Map occurrences
  // still expose all other uses; ownership does not claim semantic coverage.
  const files=await resourceFiles(repo);
  const resources=[];
  for(const file of files) {
    const rule=scopes.filter(s=>s.path.endsWith('/')?file.startsWith(s.path):file===s.path).sort((a,b)=>b.path.length-a.path.length)[0];
    if(scopes.length&&!rule)throw Error(`No dev-map owner for ${file}. Assign its responsibility in a saam-scope block.`);
    if(!rule)continue;
    const kind=file.includes('/tests/')?'verification':file.endsWith('.md')?'reference':file.endsWith('.mjs')?'implementation':'support';
    resources.push({file,kind,...rule,path:undefined,requirement:representationRequirement(file),sha256:digest(await readFile(resolve(repo,file)))});
  }
  for(const reference of references)resources.push({file:reference.path,kind:'contract',owner:reference.owner,source:reference.source,purpose:reference.purpose,requirement:representationRequirement(reference.path),sha256:reference.sha256});
  const outside=await resourceFiles(repo,['skills','adapters']),known=new Set(outside);
  const externalResources=outside.map(file=>{
    const [domain,component]=file.split('/'),base=`${domain}/${component}`;
    const guidance=[`${base}/BUILDER.md`,`${base}/DEVELOP.md`,`${base}/SKILL.md`,`${base}/README.md`,`${domain}/README.md`].find(path=>known.has(path));
    return {file,requirement:representationRequirement(file),...(guidance?{guidance}:{})};
  });
  const responsibilities=[];
  for(const region of regions)for(const row of region.responsibilities??[]) {
    const [id,fileList,contract,checkList]=row;
    if(row.length!==4||!/^[a-z][a-z0-9-]*$/.test(id)||responsibilities.some(r=>r.id===id))throw Error(`${region.source}: invalid or duplicate responsibility ${id}`);
    const files=fileList.split(',').map(s=>s.trim()),verification=checkList.split(',').map(s=>s.trim());
    if(new Set(files).size!==files.length)throw Error(`${id}: duplicate implementation file`);
    const [refId,heading]=contract.split('#'),reference=references.find(r=>r.id===refId);
    if(!reference||!heading)throw Error(`${id}: responsibility needs a map-owned contract section`);
    const text=referenceSection(reference,heading);
    for(const field of ['Contract','Failures','Change together','Verification'])if(!text.includes(`**${field}.**`))throw Error(`${id}: missing ${field} in ${contract}`);
    for(const file of files) {
      const resource=resources.find(r=>r.file===file);
      if(!safe(file)||!resource||resource.requirement.expectation!=='required')throw Error(`${id}: not an implementation resource: ${file}`);
      if(resource.source!==region.source)throw Error(`${id}: ${file} belongs to ${resource.owner}`);
      if(resource.responsibility)throw Error(`${file}: duplicate responsibility`);
      if(!text.includes(`](../../${file})`))throw Error(`${contract}: missing source link for ${file}`);
    }
    for(const check of verification) {
      if(!safe(check)||!check.endsWith('.test.mjs')||!text.includes(`](../../${check})`))throw Error(`${id}: missing verification link ${check}`);
      await readFile(resolve(repo,check));
    }
    const entry={id,files,contract,verification,owner:region.pages[0].key,source:region.source,read:`read-map ${region.pages[0].key} --section ${contract}`};
    responsibilities.push(entry);
    for(const file of files)resources.find(r=>r.file===file).responsibility={id,contract,verification,read:entry.read};
  }
  for(const resource of resources)if(resource.requirement.expectation==='required'&&!resource.responsibility)
    throw Error(`No change contract for ${resource.file}. Register its responsibility, invariants, failures, consumers and verification.`);
  return {references,scopes,resources,externalResources,responsibilities};
}

export function referenceSection(reference, anchor) {
  if(!anchor)return reference.text;
  if(!reference.headings.some(h=>h.guidanceId.split('#')[1]===anchor))throw Error(`Unknown section ${reference.id}#${anchor}`);
  return guidanceSection(reference.text, anchor);
}
