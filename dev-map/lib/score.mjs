// The map scorer: how well each map reads, by the measures the owner reviews maps with. The maps
// are the top map and every cluster; a leaf opens as code and is no map. Each map gets a badness
// per measure and their sum, and the tree's energy is the sum over its maps, each weighted by the
// log of the leaves nested in it, per leaf mapped. The sum has a fixed denominator, so a new map
// lowers the energy only by lowering the badness of others. The cluster solver (solve.mjs) lowers it.
//
// A map's members are the boxes it draws: homes, repeats and its external boxes (tree.mjs). Each
// member stands for the leaves nested under it, and links between leaves (calls, data between
// calls, indirect links) are lifted onto the members holding their two ends. Every part is a
// weight times the square of an excess, with no cap, so one bad map outweighs many slightly
// imperfect ones; each weight is the old per-unit weight over the excess where the square equals it:
//   size       0.025 per squared box, homes and repeats, outside 6–20; external boxes do not count
//   interface  0.025 per squared nested leaf beyond 4 that links from outside reach, and the same
//              beyond 4 that link outside: a cluster with a narrow interface is a concept
//   islands    0.2 per squared group of members, beyond the first, with no link between them
//   backflow   0.05 per squared member pair linked against the best left-to-right order; loops
//              make some unavoidable, so it is scored, never forbidden
//   balance    2 × the square of the biggest home box's share of the nested leaves beyond an even
//              share: a map that is one box holding nearly everything is a bottleneck
// Crossing (the share of links touching the map's nested content that no box on it holds) is
// reported, not scored.
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {storeDir,readIndex} from './store.mjs';
import {TOP,drawMap,flowOrder,treeAccess,linkSet,placeTree} from './tree.mjs';

export const SIZE={min:6,max:20,per:0.025};
export const WEIGHT={interface:0.025,interfaceFree:4,island:0.2,backward:0.05,balance:2};
// A map's weight in the energy grows with the log of the leaves nested in it, so a map passed
// through on the way to many leaves counts for more, but no map outweighs the rest.
export const weightOf=leaves=>1+Math.log2(Math.max(1,leaves));
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
  const homes=drawn.homes.length,outside=drawn.outside.map((box,i)=>`external:${i}`);
  drawn.outside.forEach((box,i)=>{for(const m of box.into)pairs.set(`${outside[i]}\n${m}`,[outside[i],m]);
    for(const m of box.from)pairs.set(`${m}\n${outside[i]}`,[m,outside[i]]);});
  return rateMap([...drawn.members,...outside],[...pairs.values()],{inner:drawn.members.length,crossing:drawn.crossing.length,
    crossingPlain:drawn.crossing.length-ubiquitous,touching:drawn.touching,touchingPlain:drawn.touching-ubiquitous,
    entries:drawn.entries.size,exits:drawn.exits.size,
    balance:homes>1&&drawn.nested.size?drawn.largest/drawn.nested.size-1/homes:0});
}

// A map's score from its members, the member pairs linked on it, its interface and balance, and
// the links touching its content and leaving it.
export function rateMap(members,edges,{inner,crossing,crossingPlain,touching,touchingPlain,entries,exits,balance}) {
  // Islands: members joined by any link in either direction.
  const parent=new Map(members.map(m=>[m,m]));
  const find=m=>parent.get(m)===m?m:find(parent.get(m));
  for(const [a,b] of edges)parent.set(find(a),find(b));
  const islands=new Set(members.map(find)).size;
  const order=flowOrder(members,edges);
  const backward=edges.filter(([a,b])=>order.get(a)>order.get(b)).length;
  const square=x=>x*x;
  const badness={
    size:SIZE.per*square(Math.max(0,SIZE.min-inner,inner-SIZE.max)),
    interface:WEIGHT.interface*(square(Math.max(0,entries-WEIGHT.interfaceFree))+square(Math.max(0,exits-WEIGHT.interfaceFree))),
    islands:WEIGHT.island*square(Math.max(0,islands-1)),
    backflow:WEIGHT.backward*square(backward),
    balance:WEIGHT.balance*square(balance)
  };
  return {nodes:inner,externals:members.length-inner,interface:{entries,exits},balance,
    crossing:{links:crossing,of:touching,share:touching?crossing/touching:0,withoutUbiquitous:touchingPlain?crossingPlain/touchingPlain:0},
    islands,backflow:{links:backward,of:edges.length},badness,score:Object.values(badness).reduce((a,b)=>a+b,0)};
}

// Every map of a tree scored: the top map and each cluster, and the energy, their weighted sum
// per leaf.
export function scoreTree(tree,links,externalLinks=[]) {
  const access=treeAccess(tree),set=linkSet(links,externalLinks),callers=callersOf(links);
  const scores=[TOP,...tree.clusters.keys()].map(map=>{const drawn=drawMap(map,access,set);
    return {map,weight:weightOf(drawn.nested.size),...scoreDrawn(drawn,callers)};});
  return {energy:scores.reduce((sum,s)=>sum+s.weight*s.score,0)/Math.max(1,access.leavesOf(TOP).length),scores};
}

// The stored tree, its leaves and links, as the solver and scorer read them.
export async function readModel({repo}) {
  const held=await readIndex(storeDir(repo));
  if(!held)throw Error(`No stored map at ${storeDir(repo)}. Run: node scripts/agent-toolkit.mjs regenerate`);
  const leaves=new Set(Object.keys(held.leaves));
  return {held,leaves,links:held.links,externalLinks:held.externalLinks??[],tree:placeTree(held.tree,leaves,held.links)};
}

const round=v=>Math.round(v*1000)/1000;
export async function scoreMaps({repo}) {
  const {held,tree,links,externalLinks}=await readModel({repo});
  const {energy,scores}=scoreTree(tree,links,externalLinks);
  const index=id=>id===TOP?TOP:held.treeIndex[id];
  const rows=scores.map(s=>({index:index(s.map),kind:s.map===TOP?'top':'cluster',
    label:s.map===TOP?'top map':tree.clusters.get(s.map).label??'[needs label]',nodes:s.nodes,externals:s.externals,weight:round(s.weight),
    repeats:tree.repeats.get(s.map)?.size??0,
    interface:s.interface,balance:round(s.balance),
    crossing:{...s.crossing,share:round(s.crossing.share),withoutUbiquitous:round(s.crossing.withoutUbiquitous)},islands:s.islands,backflow:s.backflow,
    badness:Object.fromEntries(Object.entries(s.badness).map(([k,v])=>[k,round(v)])),score:round(s.score)}))
    .sort((a,b)=>b.score-a.score);
  return {generated:held.generated,links:links.length,leaves:Object.keys(held.leaves).length,maps:rows.length,energy:round(energy),scores:rows};
}

const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

// A page beside the viewer ranking every map, each linked to its drawing, for the owner to check
// the ranking against their own reading.
export function scorePage(result) {
  const neg=v=>v>0?`-${v.toFixed(2)}`:'0';
  const rows=result.scores.map(s=>`<tr data-kind="${s.kind}"><td class="n">${neg(s.score)}</td>`
    +`<td><a href="index.html#${esc(s.index)}" target="map">${esc(s.index)}</a></td><td>${s.kind}</td><td class="label">${esc(s.label)}</td>`
    +`<td class="n">${s.nodes}</td><td class="n">${s.repeats}</td>`
    +`<td class="n">${neg(s.badness.size)}</td><td class="n" title="${s.interface.entries} entries, ${s.interface.exits} exits">${neg(s.badness.interface)}</td>`
    +`<td class="n" title="${s.islands} islands">${neg(s.badness.islands)}</td><td class="n" title="${s.backflow.links} of ${s.backflow.of} backward">${neg(s.badness.backflow)}</td>`
    +`<td class="n">${neg(s.badness.balance)}</td></tr>`).join('\n');
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
<p>Store ${esc(result.generated)} · ${result.leaves} leaves · ${result.maps} maps · ${result.links} links · energy -${result.energy}, the maps' weighted score per leaf. Each part is a penalty from 0 (ideal), and a map's score is their sum; the viewer shows each map's score in its bar.
Each part is a weight times a squared excess. Size: ${SIZE.per} per box, homes and repeats, outside ${SIZE.min}–${SIZE.max}; external boxes do not count. Interface: ${WEIGHT.interface} per nested leaf beyond ${WEIGHT.interfaceFree} reached from outside, and per one beyond ${WEIGHT.interfaceFree} linking out.
Islands: ${WEIGHT.island} per extra group of boxes with no link between them. Backflow: ${WEIGHT.backward} per box pair linked against the best left-to-right order. Balance: ${WEIGHT.balance} × the biggest home box's share of the nested leaves beyond an even share. Click a heading to sort; an index opens the map.</p>
<p>${['top','cluster'].map(k=>`<label><input type="checkbox" checked data-filter="${k}"> ${k}</label>`).join('')}</p>
<div class="wrap"><table><thead><tr><th class="n">score</th><th>map</th><th>kind</th><th>label</th><th class="n">nodes</th><th class="n">repeats</th>
<th class="n">size</th><th class="n">interface</th><th class="n">islands</th><th class="n">backflow</th><th class="n">balance</th></tr></thead>
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
