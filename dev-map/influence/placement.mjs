// Authored placement (plans/dev-maps.md milestone 5): where the owner put boxes by dragging them
// in the viewer, and the names label passes give solved clusters, kept as authored data in the
// repository and drawn over the solved layout and generated labels.
//
// Map 0's authored nodes and actors stand where the authored design set places them: its
// architecture.json `layout["0"].positions`, keyed there by authored index (`external:ID` for an
// actor). Every other placed box is in the influence set's layout.json:
//   {"schema":1,"maps":{MAP:{BOX:{"x":N,"y":N}}},"labels":{ID:TEXT},"clusters":{ID:{"leaves":N,"minhash":HEX}}}
// MAP is the page's path (`0`, `@cluster/ID`) and BOX the box's identity on it, never an index:
//   @cluster/ID            a cluster by its identity (`NODE/~HEX`, `NODE/library`), carried
//                          across re-solves by leaf overlap (cluster-identity.mjs), or map 0's
//                          node (`@cluster/NODE`)
//   FILE::NAME[ #K]        a leaf, by its file and label (#K among same-named leaves in a file,
//                          by source order), so moving code inside a file keeps its place
//   @channel::NAME         an actor channel
//   b:IDENTITY             the boundary box for the box with that identity on an enclosing map
//   list:NAME              a marker box standing for a list
// `labels` names a solved cluster by its identity (ID as above, without `@cluster/`); a cluster
// without one shows its generated label. `clusters` holds the signature of each cluster the maps or
// labels name, so a checkout without the earlier model still matches them to the clusters it
// solves; regenerate keeps it current and migrates a key of the solver's old numbering
// (`@cluster/NODE/3`) to its cluster's identity. A box without a position is placed by the solver.
// A position whose map or box is no longer drawn, or a label whose cluster is not, is kept in the
// file and reported (build, check, the viewer's map 0 list), never dropped.
import {readFileSync,writeFileSync,renameSync,rmSync} from 'node:fs';
import {resolve,relative} from 'node:path';
import {layoutClusters,renameLayout} from './cluster-identity.mjs';

export const TOP='0';
const order=(a,b)=>a<b?-1:a>b?1:0;
const offsetOf=key=>Number(key.slice(key.lastIndexOf(':')+1));

// ---- identities -----------------------------------------------------------------------------
const leafIds=new WeakMap();
export function leafIdentities(model) {
  if(leafIds.has(model))return leafIds.get(model);
  const groups=new Map();
  for(const r of Object.values(model.leaves)){const name=`${r.file??'@channel'}::${r.label}`;(groups.get(name)??groups.set(name,[]).get(name)).push(r.key);}
  const ids=new Map();
  for(const [name,keys] of groups)keys.sort((a,b)=>offsetOf(a)-offsetOf(b)).forEach((key,k)=>ids.set(key,keys.length>1?`${name} #${k+1}`:name));
  leafIds.set(model,ids);return ids;
}
// Each drawn box of a stored page (its components, boundary boxes and markers), drawing id to
// identity.
export function pageIdentities(model,page,markers=[]) {
  const leaf=leafIdentities(model),of=path=>path.startsWith('@cluster/')?path:leaf.get(path)??path;
  const ids={};
  for(const c of page.components)ids[c.index]=of(c.path);
  for(const p of page.ports)ids[p.port]=`b:${of(p.path)}`;
  for(const m of markers)ids[m.id]=m.id;
  return ids;
}

// ---- reading ----------------------------------------------------------------------------------
function readArchitecture(authoredDir) {
  const file=resolve(authoredDir,'architecture.json'),text=readFileSync(file,'utf8'),json=JSON.parse(text);
  // Map 0's authored boxes: a top-level node by index, an actor as `external:ID`.
  const keyOf=new Map(),identOf=new Map();
  for(const n of json.nodes)if(!String(n.index).includes('.')){keyOf.set(`@cluster/${n.id}`,String(n.index));identOf.set(String(n.index),`@cluster/${n.id}`);}
  for(const id of Object.keys(json.actors??{})){keyOf.set(`@cluster/external:${id}`,`external:${id}`);identOf.set(`external:${id}`,`@cluster/external:${id}`);}
  return {file,text,json,keyOf,identOf};
}
export function readLayoutFile(file) {
  let text;
  try{text=readFileSync(file,'utf8');}catch(error){if(error.code==='ENOENT')return {maps:{},clusters:{}};throw error;}
  const json=JSON.parse(text);
  if(json.schema!==1||typeof json.maps!=='object')throw Error(`${file}: expected {"schema":1,"maps":{…}}.`);
  json.labels??={};json.clusters??={};
  for(const [id,text] of Object.entries(json.labels))if(typeof text!=='string'||!text.trim())throw Error(`${file}: label ${id} is not text.`);
  return json;
}
// The cluster identities a layout names: by its maps' paths and boxes, and by its labels.
export const namedClusters=layout=>new Set([...layoutClusters(layout.maps),...Object.keys(layout.labels)]);
// A layout with cluster identities renamed (a legacy key migrating: cluster-identity.mjs).
export const renamedLayout=(layout,names)=>({...layout,maps:renameLayout(layout.maps,names).maps,
  labels:Object.fromEntries(Object.entries(layout.labels).map(([id,text])=>[names.get(id)??id,text]))});
// Every authored position, MAP → BOX → {x,y}: map 0's from architecture.json, the rest from
// layout.json. Architecture keys naming no node or actor are returned as `unknown`.
export function readPlacement({authored,layout}) {
  const arch=readArchitecture(authored),own=readLayoutFile(layout);
  const maps=structuredClone(own.maps),unknown=[];
  const zero=maps[TOP]??={};
  for(const [key,point] of Object.entries(arch.json.layout?.[TOP]?.positions??{})) {
    const ident=arch.identOf.get(key);
    if(ident)zero[ident]=point;else unknown.push({map:TOP,box:key,file:arch.file});
  }
  if(!Object.keys(zero).length)delete maps[TOP];
  return {maps,unknown};
}

// The authored positions a set of drawn pages takes: for each page index, drawing id → point,
// and every position whose map or box is not drawn.
export function placePages(pages,maps,unknown=[]) {
  const byPath=new Map(pages.map(p=>[p.path,p])),positions=new Map(),missing=[...unknown];
  let applied=0;
  for(const [map,boxes] of Object.entries(maps)) {
    const page=byPath.get(map);
    if(!page){for(const box of Object.keys(boxes))missing.push({map,box,why:'map not drawn'});continue;}
    const drawn=new Map(Object.entries(page.idents).map(([id,ident])=>[ident,id])),at={};
    for(const [box,point] of Object.entries(boxes)) {
      const id=drawn.get(box);
      if(id===undefined){missing.push({map,box,why:'box not on this map'});continue;}
      at[id]=point;applied++;
    }
    positions.set(page.index,at);
  }
  return {positions,missing,applied};
}

// The signatures a layout keeps: one for each cluster it names, current where the drawn model has
// it (signatureOf), else as kept.
export function signaturesFor(own,signatureOf=()=>null) {
  const out={};
  for(const id of namedClusters(own)){const s=signatureOf(id)??own.clusters?.[id];if(s?.minhash)out[id]={leaves:s.leaves,minhash:s.minhash};}
  return out;
}
// layout.json ({maps, labels, clusters}) rewritten whole, only when its text changes; returns
// whether it was.
export function writeLayout(file,layout) {
  const text=layoutText(layout);
  let was=null;try{was=readFileSync(file,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
  if(was===text)return false;
  writeAtomic(file,text);return true;
}

// ---- writing ----------------------------------------------------------------------------------
// A file replaced whole or not at all: written beside itself and renamed over. Windows refuses a
// rename over a file another process has open for a moment, so that is retried briefly.
function writeAtomic(file,text) {
  const temp=`${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp,text);
  for(let attempt=0;;attempt++) {
    try{renameSync(temp,file);return;}
    catch(error){
      if(attempt>=40||!['EPERM','EBUSY','EACCES'].includes(error.code)){rmSync(temp,{force:true});throw error;}
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,50);
    }
  }
}
// The text span of a top-level property's value in a JSON document.
function topLevelValue(text,key) {
  let depth=0,i=0;
  const skipString=at=>{let k=at+1;while(text[k]!=='"')k+=text[k]==='\\'?2:1;return k+1;};
  while(i<text.length) {
    const c=text[i];
    if(c==='"') {
      const end=skipString(i);
      if(depth===1&&JSON.parse(text.slice(i,end))===key) {
        let k=end;while(/\s/.test(text[k]))k++;
        if(text[k]===':') {
          k++;while(/\s/.test(text[k]))k++;
          const start=k;let d=0;
          for(;k<text.length;k++) {
            const ch=text[k];
            if(ch==='"'){k=skipString(k)-1;if(d===0){k++;break;}continue;}
            if(ch==='{'||ch==='[')d++;
            else if(ch==='}'||ch===']'){d--;if(d===0){k++;break;}}
            else if(d===0&&(ch===','||/\s/.test(ch)))break;
          }
          return {start,end:k};
        }
      }
      i=end;continue;
    }
    if(c==='{'||c==='[')depth++;else if(c==='}'||c===']')depth--;
    i++;
  }
  return null;
}
// architecture.json with only its `layout` rewritten: the rest of the hand-formatted file stays
// byte for byte, line endings included.
function withLayout(text,layout) {
  const crlf=text.includes('\r\n'),lf=crlf?text.replaceAll('\r\n','\n'):text;
  const value=JSON.stringify(layout,null,2).replaceAll('\n','\n  ');
  const span=topLevelValue(lf,'layout');
  let out;
  if(span)out=lf.slice(0,span.start)+value+lf.slice(span.end);
  else {const close=lf.lastIndexOf('}');out=`${lf.slice(0,close).trimEnd()},\n  "layout": ${value}\n${lf.slice(close)}`;}
  if(JSON.stringify(JSON.parse(out))!==JSON.stringify({...JSON.parse(lf),layout}))throw Error('architecture.json layout splice changed more than the layout.');
  return crlf?out.replaceAll('\n','\r\n'):out;
}
function layoutText({maps,labels={},clusters={}}) {
  const lines=['{',' "schema": 1,',' "about": "Authored box positions and cluster labels on influence maps, by map path and box identity: dev-map/README.md#authored-placement. Map 0\'s authored nodes are placed in the authored set\'s architecture.json.",',' "maps": {'];
  const mapKeys=Object.keys(maps).sort(order);
  mapKeys.forEach((map,i)=>{
    lines.push(`  ${JSON.stringify(map)}: {`);
    const boxes=Object.keys(maps[map]).sort(order);
    boxes.forEach((box,k)=>{const p=maps[map][box];lines.push(`   ${JSON.stringify(box)}: {"x": ${p.x}, "y": ${p.y}}${k<boxes.length-1?',':''}`);});
    lines.push(`  }${i<mapKeys.length-1?',':''}`);
  });
  if(!mapKeys.length)lines[lines.length-1]+='}';else lines.push(' }');
  const named=Object.keys(labels).sort(order);
  if(named.length) {
    lines[lines.length-1]+=',';lines.push(' "labels": {');
    named.forEach((id,k)=>lines.push(`  ${JSON.stringify(id)}: ${JSON.stringify(labels[id])}${k<named.length-1?',':''}`));
    lines.push(' }');
  }
  const ids=Object.keys(clusters).sort(order);
  if(ids.length) {
    lines[lines.length-1]+=',';lines.push(' "clusters": {');
    ids.forEach((id,k)=>{const c=clusters[id];lines.push(`  ${JSON.stringify(id)}: {"leaves": ${c.leaves}, "minhash": ${JSON.stringify(c.minhash)}}${k<ids.length-1?',':''}`);});
    lines.push(' }');
  }
  lines.push('}');
  return lines.join('\n')+'\n';
}
const point=(p,where)=>{
  if(p===null)return null;
  if(!p||![p.x,p.y].every(Number.isFinite))throw Error(`${where}: a position is {"x":N,"y":N} or null.`);
  return {x:p.x,y:p.y};
};
// Positions set on one map, BOX → {x,y} or null (back to solved placement). Map 0's authored
// nodes and actors go to architecture.json, which keeps any other field of a position (such
// as `emphasis`); everything else to layout.json. Returns the files written, repository-relative.
export function writePositions({authored,layout,repo,map,set,initial={},signatureOf}) {
  if(typeof map!=='string'||!map||typeof set!=='object'||!set||Array.isArray(set))throw Error('Expected {"map":PATH,"set":{BOX:{x,y}|null}}.');
  if(typeof initial!=='object'||!initial||Array.isArray(initial))throw Error('Initial placement is a box-position record.');
  const arch=readArchitecture(authored),own=readLayoutFile(layout);
  let archChanged=false,ownChanged=false;
  const positions=structuredClone(arch.json.layout?.[TOP]?.positions??{});
  // The first edit authors the whole displayed map. Fill only absent positions, so a
  // concurrent viewer's newer edits win over the initiating viewer's initial snapshot.
  if(map!==TOP)for(const [box,raw] of Object.entries(initial)) {
    const boxes=own.maps[map]??={};
    if(boxes[box]!==undefined)continue;
    const p=point(raw,`${map} ${box}`);
    if(p===null)continue;
    boxes[box]=p;ownChanged=true;
  }
  for(const [box,raw] of Object.entries(set)) {
    const p=point(raw,`${map} ${box}`);
    const key=map===TOP?arch.keyOf.get(box):undefined;
    if(key!==undefined) {
      if(p===null)throw Error(`${box} is an authored map-0 node; it keeps a position (architecture.json).`);
      positions[key]={...positions[key],...p};archChanged=true;continue;
    }
    const boxes=own.maps[map]??={};
    if(p===null)delete boxes[box];else boxes[box]=p;
    if(!Object.keys(boxes).length)delete own.maps[map];
    ownChanged=true;
  }
  const wrote=[];
  if(archChanged) {
    const layoutValue={...arch.json.layout,[TOP]:{...arch.json.layout?.[TOP],positions}};
    writeAtomic(arch.file,withLayout(arch.text,layoutValue));wrote.push(relative(repo,arch.file).replaceAll('\\','/'));
  }
  if(ownChanged){writeAtomic(layout,layoutText({...own,clusters:signaturesFor(own,signatureOf)}));wrote.push(relative(repo,layout).replaceAll('\\','/'));}
  return wrote;
}
// A submap back to its solved layout: its positions removed from layout.json. Map 0 has no
// solved layout; its nodes keep their architecture.json positions.
export function resetMap({layout,repo,map}) {
  if(map===TOP)throw Error('Map 0 is placed in the authored set; move its boxes back instead.');
  const own=readLayoutFile(layout);
  if(!own.maps[map])return [];
  delete own.maps[map];
  writeAtomic(layout,layoutText({...own,clusters:signaturesFor(own)}));
  return [relative(repo,layout).replaceAll('\\','/')];
}
// An Export layout file from the viewer, {"maps":{MAP:{BOX:{x,y}|null}}}, applied map by map.
export function importLayout({authored,layout,repo,file}) {
  const json=JSON.parse(readFileSync(file,'utf8'));
  if(typeof json.maps!=='object'||!json.maps)throw Error(`${file}: expected {"maps":{MAP:{BOX:{x,y}}}}, as the viewer's Export layout writes.`);
  const wrote=new Set();let positions=0;
  for(const [map,set] of Object.entries(json.maps)){for(const f of writePositions({authored,layout,repo,map,set}))wrote.add(f);positions+=Object.keys(set).length;}
  return {positions,maps:Object.keys(json.maps).length,wrote:[...wrote]};
}
