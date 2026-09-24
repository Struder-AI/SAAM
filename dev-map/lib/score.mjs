// The map scorer: how well each stored map reads, by the measures the owner reviews maps with.
// It reads the store and changes nothing. Each map gets a badness per measure and their sum; the
// whole tree's energy is the sum over its maps, the one number a clustering solver would
// minimise over every map at once.
//
// A map's members are the distinct nodes it draws; a node's own map also counts the node itself,
// whose call links are drawn from it. Each member stands for its own code and everything nested
// under it. Links between nodes (calls, data between calls, indirect links) are lifted onto the
// members that hold their two ends.
//   size      distinct nodes drawn; 6 to 16 reads well
//   crossing  of the links touching what is nested in this map, the share with one end outside it
//   islands   groups of members with no link between them; one is right
//   backflow  of the links between members, the share against the best left-to-right order;
//             loops make some unavoidable, so it is scored, never forbidden
// A node with UBIQUITOUS or more callers (`requireThat`) is drawn everywhere and would dominate
// crossing, so crossing is also reported without links to such nodes.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {storeDir,readIndex} from './store.mjs';
import {destinationFor} from './destination.mjs';

export const SIZE={min:6,max:16};
export const UBIQUITOUS=20;
const nodeOf=box=>String(box).split('@')[0];
const inside=(at,holder)=>holder==='0'||at===holder||at.startsWith(`${holder}.`);

// Every node with its own code, by index, and the file records that hold them.
export async function readNodes(repo) {
  const dir=storeDir(repo),held=await readIndex(dir);
  if(!held)throw Error(`No stored map at ${dir}. Run: node scripts/agent-toolkit.mjs regenerate`);
  const records=new Map(),nodes=new Map();
  for(const [at,{file}] of Object.entries(held.nodes)) {
    if(!records.has(file))records.set(file,JSON.parse(await readFile(resolve(dir,'files',held.records[file]),'utf8')));
    const page=records.get(file).pages[at];
    if(page)nodes.set(at,page);
  }
  return {held,nodes,records};
}

// Links between nodes, once per pair and kind: each call a node makes, each value passed from
// one call's result into another call (directly or through operators), each indirect link.
export function nodeLinks(nodes) {
  const seen=new Set(),links=[];
  const add=(from,to,kind)=>{
    const key=`${from}>${to}>${kind}`;
    if(from===to||!nodes.has(from)||!nodes.has(to)||seen.has(key))return;
    seen.add(key);links.push({from,to,kind});
  };
  for(const [at,page] of nodes) {
    for(const box of page.components??[])if(box.kind!=='group'&&box.via===undefined)add(at,box.index,'call');
    for(const link of page.couplings??[])if(link.index)
      link.direction==='in'?add(link.index,at,link.kind):add(at,link.index,link.kind);
    const next=new Map();
    for(const wire of page.wires??[])if(wire.kind==='data')
      (next.get(wire.from)??next.set(wire.from,[]).get(wire.from)).push(wire.to);
    const isBox=id=>nodes.has(nodeOf(id));
    for(const start of next.keys()) {
      if(!isBox(start))continue;
      const stack=[...next.get(start)],passed=new Set();
      while(stack.length) {
        const at2=stack.pop();
        if(passed.has(at2))continue;
        passed.add(at2);
        if(isBox(at2))add(nodeOf(start),nodeOf(at2),'data');
        else if(/^op\d/.test(at2))stack.push(...next.get(at2)??[]);
      }
    }
  }
  return links;
}

// Every map: the top map, regions, clusters and each node whose view is a map.
export function storedMaps(held,nodes) {
  const maps=[{index:'0',kind:'top',label:'top map',members:held.root.regions.map(r=>r.index)}];
  for(const page of Object.values(held.regionPages))
    maps.push({index:page.index,kind:'region',label:page.path,members:(page.components??[]).map(c=>c.index)});
  for(const page of Object.values(held.groupPages??{}))
    maps.push({index:page.index,kind:'cluster',label:page.label??page.path,members:(page.components??[]).map(c=>c.index)});
  for(const [at,page] of nodes)if(destinationFor(page)==='graph')
    maps.push({index:at,kind:'node',label:page.path,self:true,members:(page.components??[]).map(c=>c.index)});
  return maps.map(map=>{
    const members=[...new Set(map.members)].filter(at=>at!==map.index);
    return {...map,members,repeats:members.filter(at=>!at.startsWith(`${map.index}.`)&&map.index!=='0').length};
  });
}

// The order that puts the fewest links backwards, by the greedy rule of Eades, Lin and Smyth:
// take sinks to the end and sources to the front, else the member sending most more than it
// receives. Ties go by index, so the order members are listed in does not change the score.
const byAt=(a,b)=>a.localeCompare(b,undefined,{numeric:true});
function flowOrder(unordered,edges) {
  const members=[...unordered].sort(byAt);
  const out=new Map(members.map(m=>[m,new Set()])),into=new Map(members.map(m=>[m,new Set()]));
  for(const [a,b] of edges){out.get(a).add(b);into.get(b).add(a);}
  const left=new Set(members),front=[],back=[];
  const drop=m=>{left.delete(m);for(const b of out.get(m))into.get(b).delete(m);for(const a of into.get(m))out.get(a).delete(m);};
  while(left.size) {
    let moved=true;
    while(moved){moved=false;
      for(const m of left)if(!out.get(m).size){back.unshift(m);drop(m);moved=true;}
      for(const m of left)if(!into.get(m).size){front.push(m);drop(m);moved=true;}}
    if(!left.size)break;
    const best=[...left].reduce((a,b)=>out.get(b).size-into.get(b).size>out.get(a).size-into.get(a).size?b:a);
    front.push(best);drop(best);
  }
  return new Map([...front,...back].map((m,i)=>[m,i]));
}

// A map is scored from what it draws, so a drawing that is not stored (a solver's proposal) is
// scored the same way. By default a member holds the nodes nested under its index and the map's
// content is what is nested under the map's index; a proposal passes `covers` (member → the
// indexes it holds) and `inside` (node → whether it is nested in this map) instead.
export function scoreMap(map,links,callers) {
  const members=map.self?[map.index,...map.members]:map.members;
  const inMap=map.inside??(at=>inside(at,map.index));
  const prefixes=members.flatMap(m=>(map.covers?.get(m)??[m]).map(p=>[p,m]));
  // The member holding a node: the one holding the deepest index it is nested under.
  const holder=at=>{
    let found=null,depth=-1;
    for(const [p,m] of prefixes)if((at===p||at.startsWith(`${p}.`))&&p.length>depth){found=m;depth=p.length;}
    return found;
  };
  let crossing=0,crossingPlain=0,touching=0,touchingPlain=0;
  const between=new Set();
  for(const {from,to} of links) {
    // A link between two drawn boxes is on this map, whichever map the boxes are nested in.
    const x=holder(from),y=holder(to);
    if(x&&y&&x!==y)between.add(`${x}>${y}`);
    const a=inMap(from),b=inMap(to);
    if(!a&&!b)continue;
    const outer=a?to:from,ubiquitous=a!==b&&(callers.get(outer)??0)>=UBIQUITOUS;
    touching++;if(!ubiquitous)touchingPlain++;
    if(a!==b){crossing++;if(!ubiquitous)crossingPlain++;}
  }
  return rateMap(map,members,[...between].map(pair=>pair.split('>')),{crossing,crossingPlain,touching,touchingPlain});
}

// A map's score from what its links were counted to be: `edges`, the member pairs linked on it,
// and the links touching its content and leaving it.
export function rateMap(map,members,edges,{crossing,crossingPlain,touching,touchingPlain}) {
  // Islands: members joined by any link in either direction.
  const parent=new Map(members.map(m=>[m,m]));
  const find=m=>parent.get(m)===m?m:find(parent.get(m));
  for(const [a,b] of edges)parent.set(find(a),find(b));
  const islands=new Set(members.map(find)).size;
  const order=flowOrder(members,edges);
  const backward=edges.filter(([a,b])=>order.get(a)>order.get(b)).length;
  const nodes=map.members.length;
  const badness={
    size:nodes<SIZE.min?Math.min(1,(SIZE.min-nodes)/(SIZE.min-1)):nodes>SIZE.max?Math.min(1,(nodes-SIZE.max)/SIZE.max):0,
    crossing:touching?crossing/touching:0,
    islands:members.length>1?(islands-1)/(members.length-1):0,
    backflow:edges.length?backward/edges.length:0
  };
  const round=v=>Math.round(v*1000)/1000;
  return {index:map.index,kind:map.kind,label:map.label,nodes,repeats:map.repeats,
    crossing:{links:crossing,of:touching,withoutUbiquitous:touchingPlain?round(crossingPlain/touchingPlain):0},
    islands,backflow:{links:backward,of:edges.length},
    badness:Object.fromEntries(Object.entries(badness).map(([k,v])=>[k,round(v)])),
    score:round(Object.values(badness).reduce((a,b)=>a+b,0))};
}

export async function scoreMaps({repo}) {
  const {held,nodes}=await readNodes(repo);
  const links=nodeLinks(nodes),callers=new Map();
  for(const {from,to,kind} of links)if(kind==='call')callers.set(to,(callers.get(to)??0)+1);
  const scores=storedMaps(held,nodes).map(map=>scoreMap(map,links,callers)).sort((a,b)=>b.score-a.score);
  const energy=Math.round(scores.reduce((sum,s)=>sum+s.score,0)*100)/100;
  return {generated:held.generated,links:links.length,maps:scores.length,energy,scores};
}

const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

// A page beside the viewer ranking every map, each linked to its drawing, for the owner to check
// the ranking against their own reading.
export function scorePage(result) {
  const pct=v=>`${Math.round(v*100)}%`;
  const neg=v=>v>0?`-${v.toFixed(2)}`:'0';
  const rows=result.scores.map(s=>`<tr data-kind="${s.kind}"><td class="n">${neg(s.score)}</td>`
    +`<td><a href="index.html#${esc(s.index)}" target="map">${esc(s.index)}</a></td><td>${s.kind}</td><td class="label">${esc(s.label)}</td>`
    +`<td class="n">${s.nodes}</td><td class="n">${s.repeats}</td>`
    +`<td class="n" title="${s.crossing.links} of ${s.crossing.of}">${pct(s.badness.crossing)}</td><td class="n">${pct(s.crossing.withoutUbiquitous)}</td>`
    +`<td class="n">${s.islands}</td><td class="n" title="${s.backflow.links} of ${s.backflow.of}">${pct(s.badness.backflow)}</td>`
    +`<td class="n">${neg(s.badness.size)}</td></tr>`).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Map scores</title><style>
:root{--bg:#fbfbfa;--fg:#1f2328;--muted:#656d76;--line:#d8dee4;--hover:#eef2f6;--accent:#0b62c4}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#15181c;--fg:#e6e8eb;--muted:#9aa4af;--line:#30363d;--hover:#1f252c;--accent:#6cb0ff}}
:root[data-theme="dark"]{--bg:#15181c;--fg:#e6e8eb;--muted:#9aa4af;--line:#30363d;--hover:#1f252c;--accent:#6cb0ff}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif}
h1{font-size:18px;margin:0 0 4px}p{color:var(--muted);margin:0 0 12px;max-width:70ch}
.wrap{overflow-x:auto}table{border-collapse:collapse;width:100%}th,td{padding:4px 8px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}
th{cursor:pointer;position:sticky;top:0;background:var(--bg)}tr:hover td{background:var(--hover)}td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
td.label{white-space:normal;word-break:break-all}a{color:var(--accent)}label{margin-right:12px}
</style></head><body><h1>Map scores</h1>
<p>Store ${esc(result.generated)} · ${result.maps} maps · ${result.links} node links · energy -${result.energy}. Each part is a penalty from 0 (ideal) to -1, and a map's score is their sum; the viewer shows each map's score in its bar.
Size: nodes drawn outside ${SIZE.min}–${SIZE.max}. Crossing: share of links touching this map's nested content that leave it (and without nodes called from ${UBIQUITOUS}+ places).
Islands: groups of members with no link between them. Backflow: share of links between members against the best left-to-right order. Click a heading to sort; an index opens the map.</p>
<p>${['top','region','cluster','node'].map(k=>`<label><input type="checkbox" checked data-filter="${k}"> ${k}</label>`).join('')}</p>
<div class="wrap"><table><thead><tr><th class="n">score</th><th>map</th><th>kind</th><th>label</th><th class="n">nodes</th><th class="n">repeats</th>
<th class="n">crossing</th><th class="n">w/o ubiquitous</th><th class="n">islands</th><th class="n">backflow</th><th class="n">size</th></tr></thead>
<tbody>${rows}</tbody></table></div>
<script>
const body=document.querySelector('tbody');
document.querySelectorAll('th').forEach((th,col)=>th.onclick=()=>{
  const rows=[...body.rows],num=th.classList.contains('n'),dir=th.dataset.dir==='d'?1:-1;th.dataset.dir=dir<0?'d':'a';
  const val=r=>num?parseFloat(r.cells[col].textContent)||0:r.cells[col].textContent;
  rows.sort((a,b)=>num?dir*(val(a)-val(b)):dir*String(val(a)).localeCompare(val(b),undefined,{numeric:true}));body.append(...rows);});
document.querySelectorAll('[data-filter]').forEach(box=>box.onchange=()=>{
  const on=new Set([...document.querySelectorAll('[data-filter]:checked')].map(b=>b.dataset.filter));
  for(const r of body.rows)r.hidden=!on.has(r.dataset.kind);});
</script></body></html>
`;
}

export async function writeScorePage({repo,out}) {
  const result=await scoreMaps({repo});
  await writeFile(resolve(out,'scores.html'),scorePage(result));
  return result;
}
