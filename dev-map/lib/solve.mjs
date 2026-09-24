// The cluster solver's model. Clusters are the one authored part of the nesting, and the score
// (score.mjs) is the energy a solver lowers. Clustering one map changes that map and its own
// cluster maps and nothing else: the maps nested below keep their content, so the tree's energy
// is a sum over independent sites.
//
// A site is a map whose members can be clustered: the top map, or a node whose view is a map. A
// unit is what a cluster takes: one node the site draws, with the chain its leaf brings (the
// calls a leaf makes are drawn beside it, wherever it is drawn). A grouping is the site's
// clusters as a tree: `{units, groups:[{id, label, units, groups}]}`.
import {readNodes,nodeLinks,storedMaps,scoreMap,rateMap,UBIQUITOUS} from './score.mjs';
import {destinationFor} from './destination.mjs';

const under=(at,box)=>at===box||at.startsWith(`${box}.`);

// Every site with its units and its stored grouping.
export function readSites(held,nodes) {
  const groupPages=held.groupPages??{},sites=[];
  const pages=[{page:held.root,kind:'top',self:false},
    ...[...nodes.values()].filter(page=>destinationFor(page)==='graph').map(page=>({page,kind:'node',self:true}))];
  for(const {page,kind,self} of pages) {
    const units=new Map();
    const walk=p=>{
      const found={units:[],groups:[]},comps=p.components??[],own=new Set(),viaOf=new Map();
      for(const c of comps) {
        if(c.kind==='group'){
          const g=groupPages[c.index];
          found.groups.push({id:g.path.slice(g.path.lastIndexOf('/')+1),label:g.label,index:g.index,...walk(g)});
        }
        else if(c.via!==undefined)viaOf.set(c.index,c.via);
        else if(!own.has(c.index)){
          own.add(c.index);found.units.push(c.index);
          if(units.has(c.index))units.get(c.index).drawnTwice=true;
          else units.set(c.index,{id:c.index,path:c.path??`${c.file}::${c.label}`,boxes:[c.index]});
        }
      }
      // A chain box is drawn beside the leaf that makes the call, on the same map, and goes
      // wherever that leaf goes. The same node can be a unit elsewhere in the site.
      for(const [box,via] of viaOf) {
        let root=via;
        while(!own.has(root)&&viaOf.has(root))root=viaOf.get(root);
        if(own.has(root)){if(!units.get(root).boxes.includes(box))units.get(root).boxes.push(box);}
        else{const id=`${box}~${p.index}`;units.set(id,{id,path:box,boxes:[box],fixed:true});found.units.push(id);}
      }
      return found;
    };
    const grouping=walk(page);
    // A box is homed here when this map or one of its clusters numbers it; any other box is a
    // repeat, whatever cluster holds it.
    const numbering=new Set([page.index]),collect=g=>g.groups.forEach(x=>{numbering.add(x.index);collect(x);});
    collect(grouping);
    const homed=new Set([...units.values()].flatMap(u=>u.boxes).filter(b=>numbering.has(b.slice(0,b.lastIndexOf('.')))));
    sites.push({index:page.index,kind,self,label:page.label??page.path,path:page.path,units,homed,grouping});
  }
  return sites;
}

// The maps a grouping draws for a site: the site's own map and one per cluster, in the shape
// scoreMap reads. A cluster holds the nodes nested under the boxes it numbers.
export function groupingMaps(site,grouping) {
  // A map numbers the site's boxes it draws before its clusters do, depth first, as the tree
  // does; a cluster holds what it and its own clusters number.
  const numberedBy=new Map(),order=[];
  const number=(node,at)=>{
    order.push([node,at]);
    for(const u of node.units)for(const b of site.units.get(u).boxes)if(site.homed.has(b)&&!numberedBy.has(b))numberedBy.set(b,at);
    for(const g of node.groups)number(g,g.index??`${site.index}.~${g.id}`);
  };
  number(grouping,site.index);
  const heldBy=new Map(order.map(([,at])=>[at,[]]));
  for(const [b,at] of numberedBy)heldBy.get(at).push(b);
  const held=(node,at)=>[...heldBy.get(at),...node.groups.flatMap(g=>held(g,g.index??`${site.index}.~${g.id}`))];
  const maps=[];
  for(const [node,at] of order) {
    const covers=new Map(),members=[];
    for(const u of node.units)members.push(...site.units.get(u).boxes);
    for(const g of node.groups){const gi=g.index??`${site.index}.~${g.id}`;covers.set(gi,held(g,gi));members.push(gi);}
    const distinct=[...new Set(members)].filter(x=>x!==at);
    const repeats=distinct.filter(x=>!covers.has(x)&&numberedBy.get(x)!==at).length;
    if(at===site.index)maps.push({index:at,kind:site.kind,label:site.label,self:site.self,members:distinct,covers,repeats});
    else {
      const mine=held(node,at);
      maps.push({index:at,kind:'cluster',label:node.label??node.id,members:distinct,covers,repeats,held:mine,
        inside:x=>mine.some(b=>under(x,b))});
    }
  }
  return maps;
}

// The links that can land on a site's maps: those with an end nested in the site or in a box it draws.
export function siteLinks(site,links) {
  const roots=[site.index,...[...site.units.values()].flatMap(u=>u.boxes)];
  return links.filter(({from,to})=>roots.some(r=>under(from,r)||under(to,r)));
}

export function scoreGrouping(site,grouping,links,callers) {
  const scores=groupingMaps(site,grouping).map(map=>scoreMap(map,links,callers));
  return {energy:scores.reduce((sum,s)=>sum+s.score,0),scores};
}

export async function readModel({repo}) {
  const {held,nodes}=await readNodes(repo);
  const links=nodeLinks(nodes),callers=new Map();
  for(const {from,to,kind} of links)if(kind==='call')callers.set(to,(callers.get(to)??0)+1);
  return {held,nodes,links,callers,sites:readSites(held,nodes),maps:storedMaps(held,nodes)};
}

// A site compiled for many scorings: each link end is the boxes it is nested under, deepest
// first, so a grouping is scored by lookups. It scores exactly as scoreGrouping does.
export function compileSite(site,links,callers) {
  const boxes=new Set([...site.units.values()].flatMap(u=>u.boxes));
  if(site.self)boxes.add(site.index);
  const ends=new Map();
  const end=at=>{
    if(ends.has(at))return ends.get(at);
    const chain=[];
    for(let p=at;;){if(boxes.has(p))chain.push(p);const i=p.lastIndexOf('.');if(i<0)break;p=p.slice(0,i);}
    const found={chain,inSite:under(at,site.index),ubiquitous:(callers.get(at)??0)>=UBIQUITOUS};
    ends.set(at,found);return found;
  };
  const wires=[];
  for(const {from,to} of links) {
    const a=end(from),b=end(to);
    if(a.chain.length||b.chain.length||a.inSite||b.inSite)wires.push([a,b]);
  }
  return {site,wires};
}

export function scoreCompiled({site,wires},grouping) {
  const scores=groupingMaps(site,grouping).map(map=>{
    const members=map.self?[map.index,...map.members]:map.members,owner=new Map();
    for(const m of members)for(const p of map.covers.get(m)??[m])owner.set(p,m);
    const held=map.held?new Set(map.held):null;
    const holder=e=>{for(const b of e.chain){const m=owner.get(b);if(m!==undefined)return m;}return null;};
    const inMap=e=>held?e.chain.some(b=>held.has(b)):e.inSite;
    const counts={crossing:0,crossingPlain:0,touching:0,touchingPlain:0},between=new Map();
    for(const [from,to] of wires) {
      const x=holder(from),y=holder(to);
      if(x!==null&&y!==null&&x!==y)between.set(`${x}>${y}`,[x,y]);
      const a=inMap(from),b=inMap(to);
      if(!a&&!b)continue;
      const ubiquitous=a!==b&&(a?to:from).ubiquitous;
      counts.touching++;if(!ubiquitous)counts.touchingPlain++;
      if(a!==b){counts.crossing++;if(!ubiquitous)counts.crossingPlain++;}
    }
    return rateMap(map,members,[...between.values()],counts);
  });
  return {energy:scores.reduce((sum,s)=>sum+s.score,0),scores};
}

// What generation accepts as a cluster member on a site (composition.mjs): a declaration, named
// by code rather than by source position, that the site's own page places.
export function groupableUnits(site,sourcePacket) {
  const known=sourcePacket?new Set((sourcePacket.components??[]).map(identity)):null;
  return new Set([...site.units.values()].filter(u=>{
    if(u.fixed||!u.path.includes('::')||/<(?:callback|callable|return)@\d+:\d+>/.test(u.path))return false;
    const parts=u.path.split('::'),parent=parts.length>2?parts.slice(0,-1).join('::'):null;
    if(parent&&parent!==site.path)return false;
    return site.kind==='top'||known?.has(u.path);
  }).map(u=>u.id));
}
const identity=c=>c.path??(c.file&&c.label?`${c.file}::${c.label}`:c.file);

// The solver: simulated annealing of the whole tree's energy. One temperature governs every
// move, and each move regroups one site chosen at random (weighted by what it can move), so no
// map is solved before another. A site's clusters are a record: `clusters` (id → parent, label,
// index) and `at` (unit → the cluster holding it, or ROOT). The energy of a move is the change in
// the sum of every map's score; only the moved site's maps change, so only they are rescored.
const ROOT='';
const random=seed=>()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);
  t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};
const pick=(rand,list)=>list[Math.floor(rand()*list.length)];

function stateOf(site) {
  const clusters=new Map(),at=new Map();
  const walk=(node,parent)=>{
    for(const u of node.units)at.set(u,parent);
    for(const g of node.groups){clusters.set(g.id,{parent,label:g.label,index:g.index});walk(g,g.id);}
  };
  walk(site.grouping,ROOT);
  return {clusters,at,next:0};
}
const copyState=s=>({clusters:new Map([...s.clusters].map(([id,c])=>[id,{...c}])),at:new Map(s.at),next:s.next});

export function groupingOf(site,state) {
  const node=id=>({...(id===ROOT?{}:{id,label:state.clusters.get(id).label,index:state.clusters.get(id).index}),
    units:[...site.units.keys()].filter(u=>state.at.get(u)===id),
    groups:[...state.clusters].filter(([,c])=>c.parent===id).map(([child])=>node(child))});
  return node(ROOT);
}

// A cluster lists at least one member of its own (composition.mjs); one holding only clusters
// hands them to its parent.
function settle(state) {
  for(let changed=true;changed;) {
    changed=false;
    for(const [id,c] of state.clusters)if(![...state.at.values()].includes(id)) {
      for(const other of state.clusters.values())if(other.parent===id)other.parent=c.parent;
      state.clusters.delete(id);changed=true;
    }
  }
  return state;
}

// One random regrouping of a site, returned as a new state: move a unit to another cluster or a
// new one, dissolve a cluster, move a cluster into another, or merge two.
function propose(state,movable,rand) {
  const s=copyState(state),ids=[...s.clusters.keys()],kind=ids.length?rand():0;
  const within=(id,of)=>{for(let p=id;p!==ROOT;p=s.clusters.get(p).parent)if(p===of)return true;return false;};
  if(kind<0.7) {
    const u=pick(rand,movable),from=s.at.get(u),targets=[ROOT,...ids,'new'].filter(t=>t!==from),to=pick(rand,targets);
    if(to==='new'){const id=`c${s.next++}`;s.clusters.set(id,{parent:pick(rand,[ROOT,...ids])});s.at.set(u,id);}
    else s.at.set(u,to);
  }
  else if(kind<0.8) {
    const id=pick(rand,ids),parent=s.clusters.get(id).parent;
    for(const [u,where] of s.at)if(where===id)s.at.set(u,parent);
    for(const c of s.clusters.values())if(c.parent===id)c.parent=parent;
    s.clusters.delete(id);
  }
  else if(kind<0.9) {
    const id=pick(rand,ids),to=pick(rand,[ROOT,...ids].filter(t=>!within(t,id)));
    s.clusters.get(id).parent=to;
  }
  else {
    const id=pick(rand,ids),to=pick(rand,ids.filter(t=>!within(t,id)));
    if(to!==undefined) {
      for(const [u,where] of s.at)if(where===id)s.at.set(u,to);
      for(const c of s.clusters.values())if(c.parent===id)c.parent=to;
      s.clusters.delete(id);
    }
  }
  return settle(s);
}

// Anneal from the stored clusters. The temperature starts where half the uphill moves are taken,
// cools geometrically, and a stage is as long as there are units to move; the solve ends when a
// whole stage changes nothing (the system has frozen), and returns the lowest energy seen.
export function solveTree(model,{seed=1,sourcePackets,onStage}={}) {
  const rand=random(seed);
  const sites=model.sites.map(site=>{
    const movable=[...groupableUnits(site,site.kind==='node'?sourcePackets.get(site.path):null)];
    const compiled=compileSite(site,siteLinks(site,model.links),model.callers);
    const state=stateOf(site);
    return {site,movable,compiled,state,energy:scoreCompiled(compiled,groupingOf(site,state)).energy};
  });
  const weighted=sites.flatMap(s=>s.movable.map(()=>s));
  const total=()=>sites.reduce((sum,s)=>sum+s.energy,0);
  const start=total();
  const trial=()=>{
    const s=pick(rand,weighted),state=propose(s.state,s.movable,rand);
    const energy=scoreCompiled(s.compiled,groupingOf(s.site,state)).energy;
    return {s,state,energy,delta:energy-s.energy};
  };
  const uphill=[];
  for(let i=0;i<weighted.length;i++){const t=trial();if(t.delta>0)uphill.push(t.delta);}
  let temperature=uphill.reduce((a,b)=>a+b,0)/Math.max(1,uphill.length)/Math.LN2;
  let best={energy:start,states:sites.map(s=>copyState(s.state))},stage=0;
  for(;;) {
    let accepted=0,changed=0;
    for(let i=0;i<weighted.length;i++) {
      const t=trial();
      if(t.delta<=0||rand()<Math.exp(-t.delta/temperature)) {
        t.s.state=t.state;t.s.energy=t.energy;accepted++;
        if(Math.abs(t.delta)>1e-9)changed++;
      }
    }
    const now=total();
    if(now<best.energy-1e-9)best={energy:now,states:sites.map(s=>copyState(s.state))};
    onStage?.({stage:stage++,temperature,energy:now,best:best.energy,accepted,changed,moves:weighted.length});
    if(!changed)break;
    temperature*=0.9;
  }
  sites.forEach((s,i)=>{s.state=best.states[i];});
  return {start,energy:best.energy,sites:sites.map(s=>({site:s.site,grouping:groupingOf(s.site,s.state)}))};
}
