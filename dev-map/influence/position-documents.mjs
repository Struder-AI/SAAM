// Position document values; no filesystem or browser dependencies.
const order=(a,b)=>a<b?-1:a>b?1:0;
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
export function layoutText({maps,labels={},clusters={}}) {
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
// Pure document edits shared by server and static-file authoring. File owners perform writes.
export function positionDocuments({architecture,layout,map,set,initial={}}) {
  if(typeof map!=='string'||!map||!set||typeof set!=='object'||Array.isArray(set))throw Error('Expected a map and box-position record.');
  if(!initial||typeof initial!=='object'||Array.isArray(initial))throw Error('Initial placement is a box-position record.');
  const arch=JSON.parse(architecture),own=structuredClone(layout),keyOf=new Map();
  if(own.schema!==1||!own.maps||typeof own.maps!=='object'||Array.isArray(own.maps))throw Error('Expected a schema-1 layout file.');
  for(const n of arch.nodes)if(!String(n.index).includes('.'))keyOf.set('@cluster/'+n.id,String(n.index));
  for(const id of Object.keys(arch.actors??{}))keyOf.set('@cluster/external:'+id,'external:'+id);
  const positions=structuredClone(arch.layout?.['0']?.positions??{});
  let archChanged=false,ownChanged=false;
  if(map!=='0')for(const [box,raw] of Object.entries(initial)) {
    const boxes=own.maps[map]??={};
    if(boxes[box]!==undefined)continue;
    const p=point(raw,map+' '+box);if(p===null)continue;
    boxes[box]=p;ownChanged=true;
  }
  for(const [box,raw] of Object.entries(set)) {
    const p=point(raw,map+' '+box),key=map==='0'?keyOf.get(box):undefined;
    if(key!==undefined) {
      if(p===null)throw Error(box+' is an authored map-0 node; it keeps a position.');
      positions[key]={...positions[key],...p};archChanged=true;continue;
    }
    const boxes=own.maps[map]??={};
    if(p===null)delete boxes[box];else boxes[box]=p;
    if(!Object.keys(boxes).length)delete own.maps[map];ownChanged=true;
  }
  return {architecture:archChanged?withLayout(architecture,{...arch.layout,'0':{...arch.layout?.['0'],positions}}):null,
    layout:ownChanged?own:null};
}
// The saved positions by stable identities, including map 0's authored defaults.
export function documentPositions({architecture,layout}) {
  const arch=JSON.parse(architecture),maps=structuredClone(layout.maps),zero=maps['0']??={},ids=new Map();
  for(const n of arch.nodes)if(!String(n.index).includes('.'))ids.set(String(n.index),'@cluster/'+n.id);
  for(const id of Object.keys(arch.actors??{}))ids.set('external:'+id,'@cluster/external:'+id);
  for(const [key,p] of Object.entries(arch.layout?.['0']?.positions??{}))if(ids.has(key))zero[ids.get(key)]=p;
  if(!Object.keys(zero).length)delete maps['0'];
  return maps;
}
