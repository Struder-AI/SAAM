// The map scorer: how well each map reads, by the measures the owner reviews maps with. The maps
// are the top map and every cluster; a leaf opens as code and is no map. Each map gets a badness
// per measure and their sum, and the tree's energy is the mean over its maps: the quality of the
// maps, however many there are. The cluster solver (solve.mjs) lowers it.
//
// A map's members are the boxes it draws, homes and repeats. Each member stands for the leaves
// nested under it, and links between leaves (calls, data between calls, indirect links) are
// lifted onto the members holding their two ends.
//   size      boxes drawn; 6 to 16 reads well, and each box outside that range costs 0.1
//   crossing  of the links touching what is nested in this map, the share whose other end no box
//             on it holds; a repeat of that end keeps the link on the map
//   islands   groups of members with no link between them; one is right
//   backflow  of the links between members, the share against the best left-to-right order;
//             loops make some unavoidable, so it is scored, never forbidden
// A leaf with UBIQUITOUS or more callers (`requireThat`) is drawn everywhere and would dominate
// crossing, so crossing is also reported without links to such leaves.
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {storeDir,readIndex} from './store.mjs';
import {TOP,drawMap,flowOrder,treeAccess,linkSet,placeTree} from './tree.mjs';

export const SIZE={min:6,max:16,per:0.1};
export const UBIQUITOUS=20;

// How many call links reach each leaf.
export function callersOf(links) {
  const callers=new Map();
  for(const {to,kind} of links)if(kind==='call')callers.set(to,(callers.get(to)??0)+1);
  return callers;
}

// One map's score from what it draws (tree.mjs drawMap).
export function scoreDrawn(drawn,callers) {
  const pairs=new Map();
  for(const {from,to} of drawn.lifted)pairs.set(`${from}
${to}`,[from,to]);
  const ubiquitous=drawn.crossing.filter(c=>(callers.get(c.outside)??0)>=UBIQUITOUS).length;
  return rateMap(drawn.members,[...pairs.values()],{crossing:drawn.crossing.length,
    crossingPlain:drawn.crossing.length-ubiquitous,touching:drawn.touching,touchingPlain:drawn.touching-ubiquitous});
}

// A map's score from its members, the member pairs linked on it, and the links touching its
// content and leaving it.
export function rateMap(members,edges,{crossing,crossingPlain,touching,touchingPlain}) {
  // Islands: members joined by any link in either direction.
  const parent=new Map(members.map(m=>[m,m]));
  const find=m=>parent.get(m)===m?m:find(parent.get(m));
  for(const [a,b] of edges)parent.set(find(a),find(b));
  const islands=new Set(members.map(find)).size;
  const order=flowOrder(members,edges);
  const backward=edges.filter(([a,b])=>order.get(a)>order.get(b)).length;
  const nodes=members.length;
  const badness={
    size:SIZE.per*Math.max(0,SIZE.min-nodes,nodes-SIZE.max),
    crossing:touching?crossing/touching:0,
    islands:members.length>1?(islands-1)/(members.length-1):0,
    backflow:edges.length?backward/edges.length:0
  };
  return {nodes,crossing:{links:crossing,of:touching,withoutUbiquitous:touchingPlain?crossingPlain/touchingPlain:0},
    islands,backflow:{links:backward,of:edges.length},badness,score:Object.values(badness).reduce((a,b)=>a+b,0)};
}

// Every map of a tree scored: the top map and each cluster, and the mean.
export function scoreTree(tree,links) {
  const access=treeAccess(tree),set=linkSet(links),callers=callersOf(links);
  const scores=[TOP,...tree.clusters.keys()].map(map=>({map,...scoreDrawn(drawMap(map,access,set),callers)}));
  return {energy:scores.reduce((sum,s)=>sum+s.score,0)/scores.length,scores};
}

// The stored tree, its leaves and links, as the solver and scorer read them.
export async function readModel({repo}) {
  const held=await readIndex(storeDir(repo));
  if(!held)throw Error(`No stored map at ${storeDir(repo)}. Run: node scripts/agent-toolkit.mjs regenerate`);
  const leaves=new Set(Object.keys(held.leaves));
  return {held,leaves,links:held.links,tree:placeTree(held.tree,leaves,held.links)};
}

const round=v=>Math.round(v*1000)/1000;
export async function scoreMaps({repo}) {
  const {held,tree,links}=await readModel({repo});
  const {energy,scores}=scoreTree(tree,links);
  const index=id=>id===TOP?TOP:held.treeIndex[id];
  const rows=scores.map(s=>({index:index(s.map),kind:s.map===TOP?'top':'cluster',
    label:s.map===TOP?'top map':tree.clusters.get(s.map).label??'[needs label]',nodes:s.nodes,
    repeats:tree.repeats.get(s.map)?.size??0,
    crossing:{...s.crossing,withoutUbiquitous:round(s.crossing.withoutUbiquitous)},islands:s.islands,backflow:s.backflow,
    badness:Object.fromEntries(Object.entries(s.badness).map(([k,v])=>[k,round(v)])),score:round(s.score)}))
    .sort((a,b)=>b.score-a.score);
  return {generated:held.generated,links:links.length,leaves:Object.keys(held.leaves).length,maps:rows.length,energy:round(energy),scores:rows};
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
<p>Store ${esc(result.generated)} · ${result.leaves} leaves · ${result.maps} maps · ${result.links} links · energy -${result.energy}, the mean map score. Each part is a penalty from 0 (ideal), and a map's score is their sum; the viewer shows each map's score in its bar.
Size: ${SIZE.per} per box outside ${SIZE.min}–${SIZE.max}. Crossing: share of links touching this map's nested content whose other end no box on it holds (and without leaves called from ${UBIQUITOUS}+ places).
Islands: groups of members with no link between them. Backflow: share of links between members against the best left-to-right order. Click a heading to sort; an index opens the map.</p>
<p>${['top','cluster'].map(k=>`<label><input type="checkbox" checked data-filter="${k}"> ${k}</label>`).join('')}</p>
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
