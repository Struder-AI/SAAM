// The nesting the middle-out solver (dev-map/influence/solve-middle.mjs) works on: the tree of
// maps under the top map `0`. Leaves and clusters are the nodes; each has exactly one home, the
// map that numbers it, and may be drawn on other maps as repeats. A tree is a record: `parent`
// (node → the map that homes it), `clusters` (id → {label}) and `repeats` (map → the nodes it
// repeats).
export const TOP='0';
const order=(a,b)=>a<b?-1:a>b?1:0;

// The navigation a map needs from a tree, as accessors, so a solver's live state and a settled
// tree are read the same way.
export function treeAccess(tree) {
  const children=new Map([[TOP,[]],...[...tree.clusters.keys()].map(id=>[id,[]])]);
  for(const [id,p] of tree.parent)children.get(p).push(id);
  const leavesUnder=new Map();
  const under=id=>{
    if(!tree.clusters.has(id)&&id!==TOP)return [id];
    if(!leavesUnder.has(id))leavesUnder.set(id,children.get(id).flatMap(under));
    return leavesUnder.get(id);
  };
  return {childrenOf:id=>children.get(id)??[],repeatsOn:id=>tree.repeats.get(id)??new Set(),
    isCluster:id=>tree.clusters.has(id),leavesOf:under,parentOf:id=>tree.parent.get(id)};
}

// What a map draws and where each link lands on it. A member stands for the leaves nested under
// it; a link end is held by the deepest member holding it, so a repeat inside a home member
// holds its own leaves. `links` is every link by number and `linksOf` a leaf's link numbers.
// A link touches the map when an end is nested in it, and crosses it when its other end is held
// by no box the map draws; that end is drawn at the map's edge as its boundary box, the box on the
// nearest map the two share that holds it. A cluster's interface is its nested leaves that links from outside
// reach (`entries`) and that link outside (`exits`), externals included; `largest` is how many
// nested leaves its biggest home box holds.
//
// Externals linked to what a map nests are drawn on it as boxes, and externals the map cannot
// tell apart share one: those linked, in the same directions, to exactly the same boxes. The top
// map nests everything, so it draws every external. `outside` is each such box: its externals
// and the boxes it links to (`into`, boxes it reaches; `from`, boxes that reach it).
export function drawMap(map,{childrenOf,repeatsOn,isCluster,leavesOf,parentOf},{links,linksOf,externalsOf=()=>[]}) {
  const homes=[...childrenOf(map)],repeated=[...repeatsOn(map)],members=[...homes,...repeated];
  const held=members.map((m,i)=>({m,leaves:leavesOf(m),rank:i<homes.length?0:1,cluster:isCluster(m)?0:1}))
    .sort((a,b)=>b.leaves.length-a.leaves.length||a.rank-b.rank||a.cluster-b.cluster);
  const holder=new Map(),nested=new Set();
  for(const {m,leaves,rank} of held)for(const leaf of leaves){holder.set(leaf,m);if(rank===0)nested.add(leaf);}
  const lifted=[],crossing=[],seen=new Set(),entries=new Set(),exits=new Set();
  const chain=new Set([TOP]);for(let p=map;p!==undefined;p=parentOf(p))chain.add(p);
  const boundaryOf=leaf=>{let box=leaf;for(let p=parentOf(leaf);!chain.has(p);p=parentOf(p))box=p;return box;};
  let touching=0;
  for(const leaf of holder.keys())for(const n of linksOf(leaf)) {
    if(seen.has(n))continue;
    seen.add(n);
    const link=links[n],x=holder.get(link.from),y=holder.get(link.to);
    if(x!==undefined&&y!==undefined&&x!==y)lifted.push({from:x,to:y,link});
    const a=map===TOP||nested.has(link.from),b=map===TOP||nested.has(link.to);
    if(!a&&!b)continue;
    if(a&&!b)exits.add(link.from);else if(b&&!a)entries.add(link.to);
    touching++;
    if(x===undefined||y===undefined){const outside=a?link.to:link.from;
      crossing.push({link,inside:a?x:y,outside,out:a,boundary:boundaryOf(outside)});}
  }
  const reach=new Map();
  for(const leaf of nested)for(const {external,out,kind='call'} of externalsOf(leaf)) {
    const ends=reach.get(external)??reach.set(external,new Map()).get(external),key=JSON.stringify([out,holder.get(leaf),kind]);
    ends.set(key,(ends.get(key)??0)+1);
    if(map!==TOP)(out?exits:entries).add(leaf);
  }
  const alike=new Map();
  for(const [external,ends] of reach) {
    const key=[...ends.keys()].sort().join('\n');
    const group=alike.get(key)??alike.set(key,{externals:[],ends:new Map(),details:[]}).get(key);
    group.externals.push(external);
    for(const [end,count] of ends){group.ends.set(end,(group.ends.get(end)??0)+count);const [out,box,kind]=JSON.parse(end);group.details.push({external,out,box,kind,count});}
  }
  const outside=[...alike.values()].map(({externals,ends,details})=>{
    const connections=[...ends].map(([key,count])=>{const [out,box,kind]=JSON.parse(key);return {out,box,kind,count};});
    return {externals:externals.sort(),connections,details,
      into:[...new Set(connections.filter(e=>!e.out).map(e=>e.box))],from:[...new Set(connections.filter(e=>e.out).map(e=>e.box))]};})
    .sort((a,b)=>a.externals[0]<b.externals[0]?-1:1);
  const largest=Math.max(0,...held.filter(h=>h.rank===0).map(h=>h.leaves.length));
  return {homes,repeated,members,holder,nested,lifted,crossing,touching,entries,exits,largest,outside};
}

// The order that puts the fewest links backwards, by the greedy rule of Eades, Lin and Smyth:
// sinks to the end and sources to the front, else the member sending most more than it receives.
// Ties go by `compare`, so the order members are listed in changes nothing. Heaps with stale
// entries skipped keep it near linear on a large map.
export function flowOrder(unordered,edges,compare=order) {
  const members=[...unordered].sort(compare),rank=new Map(members.map((m,i)=>[m,i]));
  const out=new Map(members.map(m=>[m,new Set()])),into=new Map(members.map(m=>[m,new Set()]));
  for(const [a,b] of edges){out.get(a).add(b);into.get(b).add(a);}
  const heap=less=>{
    const a=[];
    return {push(x){a.push(x);for(let i=a.length-1;i>0;){const p=(i-1)>>1;if(!less(a[i],a[p]))break;[a[i],a[p]]=[a[p],a[i]];i=p;}},
      pop(){const top=a[0],last=a.pop();if(a.length){a[0]=last;for(let i=0;;){const l=2*i+1,r=l+1;let m=i;
        if(l<a.length&&less(a[l],a[m]))m=l;if(r<a.length&&less(a[r],a[m]))m=r;if(m===i)break;[a[i],a[m]]=[a[m],a[i]];i=m;}}return top;},
      get size(){return a.length;}};
  };
  const byRank=(x,y)=>rank.get(x)<rank.get(y);
  const sinks=heap(byRank),sources=heap(byRank),best=heap((x,y)=>x[1]>y[1]||x[1]===y[1]&&rank.get(x[0])<rank.get(y[0]));
  const left=new Set(members),front=[],back=[];
  const touch=m=>{if(!left.has(m))return;if(!out.get(m).size)sinks.push(m);if(!into.get(m).size)sources.push(m);best.push([m,out.get(m).size-into.get(m).size]);};
  const drop=m=>{left.delete(m);
    for(const b of out.get(m)){into.get(b).delete(m);touch(b);}
    for(const a of into.get(m)){out.get(a).delete(m);touch(a);}};
  const next=(h,valid)=>{while(h.size){const x=h.pop();if(valid(x))return x;}return undefined;};
  members.forEach(touch);
  while(left.size) {
    let m=next(sinks,x=>left.has(x)&&!out.get(x).size);
    if(m!==undefined){back.push(m);drop(m);continue;}
    m=next(sources,x=>left.has(x)&&!into.get(x).size);
    if(m!==undefined){front.push(m);drop(m);continue;}
    const [pick]=next(best,([x,d])=>left.has(x)&&d===out.get(x).size-into.get(x).size);
    front.push(pick);drop(pick);
  }
  return new Map([...front,...back.reverse()].map((m,i)=>[m,i]));
}

// Links numbered, with each leaf's link numbers and its externals, for drawMap.
export function linkSet(links,externalLinks=[]) {
  const linksOf=new Map(),externalsOf=new Map();
  links.forEach((link,n)=>{for(const end of [link.from,link.to])(linksOf.get(end)??linksOf.set(end,[]).get(end)).push(n);});
  for(const e of externalLinks)(externalsOf.get(e.leaf)??externalsOf.set(e.leaf,[]).get(e.leaf)).push(e);
  return {links,linksOf:leaf=>linksOf.get(leaf)??[],externalsOf:leaf=>externalsOf.get(leaf)??[]};
}
