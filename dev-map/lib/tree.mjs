// The nesting: the tree of maps. The leaves are given (leaves.mjs) and so is the top map `0`;
// everything between them is clusters, authored by the cluster solver (solve.mjs) in
// dev-map/tree.json, whose labels a label pass authors. Leaves and clusters are the nodes. Each
// has exactly one home, the map that numbers it, and may be drawn on other maps as repeats.
//
// Placement is total: every leaf is placed whatever the file says or leaves out, and what the
// file names that no longer exists is dropped. Two rules make a tree legal, and placement
// enforces them rather than failing: a cluster homes at least one node and draws at least two
// boxes, and a repeat is never on its node's home map or inside the cluster it repeats.
//
// A tree is a record: `parent` (node → the map that homes it), `clusters` (id → {label}) and
// `repeats` (map → the nodes it repeats). A leaf's id is its declaration path; a cluster's is the
// id the solver gave it.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

export const TOP='0';
export const treeFile='dev-map/tree.json';
const order=(a,b)=>a<b?-1:a>b?1:0;

export async function readTreeFile(repo) {
  const text=await readFile(resolve(repo,treeFile),'utf8').catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  const file=text===null?{}:JSON.parse(text);
  return {schema:1,clusters:file.clusters??[],leaves:file.leaves??{},repeats:file.repeats??{}};
}

// The file a tree is written back as: clusters in index order when an index is given, leaves by
// path, and each map's repeats.
export function treeFileOf(tree,index=new Map()) {
  const at=id=>index.get(id)??id,byAt=(a,b)=>/^[\d.]+$/.test(at(a))&&/^[\d.]+$/.test(at(b))?byIndex(at(a),at(b)):order(at(a),at(b));
  const clusters=[...tree.clusters.keys()].sort(byAt).map(id=>({id,label:tree.clusters.get(id).label??null,parent:tree.parent.get(id)}));
  const leaves=Object.fromEntries([...tree.parent].filter(([id])=>!tree.clusters.has(id)).sort(([a],[b])=>order(a,b)));
  const repeats=Object.fromEntries([...tree.repeats].filter(([,set])=>set.size).sort(([a],[b])=>byAt(a,b))
    .map(([map,set])=>[map,[...set].sort(order)]));
  return {schema:1,clusters,leaves,repeats};
}

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

// Place every leaf and make the tree legal. `file` is what readTreeFile returns; `links` are
// {from, to} between leaf paths.
export function placeTree(file,leaves,links) {
  const clusters=new Map(),parent=new Map(),repeats=new Map();
  for(const c of file.clusters)if(c?.id&&!clusters.has(c.id)&&c.id!==TOP&&!leaves.has(c.id))clusters.set(c.id,{label:c.label??null});
  const isMap=id=>id===TOP||clusters.has(id);
  for(const c of file.clusters)if(clusters.has(c.id)&&!parent.has(c.id))parent.set(c.id,isMap(c.parent)&&c.parent!==c.id?c.parent:TOP);
  // A parent chain that comes back to itself is broken at the first cluster met twice.
  for(const id of clusters.keys()) {
    const seen=new Set([id]);
    for(let at=parent.get(id);at!==TOP;at=parent.get(at)){if(seen.has(at)){parent.set(at,TOP);break;}seen.add(at);}
  }
  for(const leaf of [...leaves].sort(order))if(isMap(file.leaves[leaf]))parent.set(leaf,file.leaves[leaf]);
  // A leaf the file does not place goes where most of its links already are, else to 0.
  const neighbours=new Map();
  for(const {from,to} of links){(neighbours.get(from)??neighbours.set(from,[]).get(from)).push(to);(neighbours.get(to)??neighbours.set(to,[]).get(to)).push(from);}
  let unplaced=[...leaves].filter(leaf=>!parent.has(leaf)).sort(order);
  for(let placed=true;placed&&unplaced.length;) {
    placed=false;
    for(const leaf of unplaced) {
      const votes=new Map();
      for(const n of neighbours.get(leaf)??[])if(parent.has(n))votes.set(parent.get(n),(votes.get(parent.get(n))??0)+1);
      if(!votes.size)continue;
      parent.set(leaf,[...votes].sort((a,b)=>b[1]-a[1]||order(a[0],b[0]))[0][0]);placed=true;
    }
    unplaced=unplaced.filter(leaf=>!parent.has(leaf));
  }
  for(const leaf of unplaced)parent.set(leaf,TOP);
  for(const [map,ids] of Object.entries(file.repeats))if(isMap(map))
    repeats.set(map,new Set(ids.filter(id=>leaves.has(id)||clusters.has(id))));
  return settle({parent,clusters,repeats});
}

// The two rules, applied until the tree holds them. Local mutation of the tree being built.
function settle(tree) {
  const {parent,clusters,repeats}=tree;
  const inside=(map,id)=>{for(let at=map;at!==undefined;at=parent.get(at)){if(at===id)return true;if(at===TOP)return false;}return false;};
  for(let changed=true;changed;) {
    changed=false;
    for(const [map,set] of repeats)for(const id of set)
      if(parent.get(id)===map||clusters.has(id)&&inside(map,id)||!parent.has(id)){set.delete(id);changed=true;}
    const homes=new Map();
    for(const [id,p] of parent)homes.set(p,(homes.get(p)??0)+1);
    for(const id of clusters.keys()) {
      const home=homes.get(id)??0,drawn=home+(repeats.get(id)?.size??0);
      if(home>=1&&drawn>=2)continue;
      // Dissolved: what it homes goes to its parent, and every repeat of it or on it goes.
      const up=parent.get(id);
      for(const [child,p] of parent)if(p===id)parent.set(child,up);
      clusters.delete(id);parent.delete(id);repeats.delete(id);
      for(const set of repeats.values())set.delete(id);
      changed=true;break;
    }
  }
  return tree;
}

// What a map draws and where each link lands on it. A member stands for the leaves nested under
// it; a link end is held by the deepest member holding it, so a repeat inside a home member
// holds its own leaves. `links` is every link by number and `linksOf` a leaf's link numbers.
// A link touches the map when an end is nested in it, and crosses it when its other end is held
// by no box the map draws. A cluster's interface is its nested leaves that links from outside
// reach (`entries`) and that link outside (`exits`); `largest` is how many nested leaves its
// biggest home box holds.
export function drawMap(map,{childrenOf,repeatsOn,isCluster,leavesOf},{links,linksOf}) {
  const homes=[...childrenOf(map)],repeated=[...repeatsOn(map)],members=[...homes,...repeated];
  const held=members.map((m,i)=>({m,leaves:leavesOf(m),rank:i<homes.length?0:1,cluster:isCluster(m)?0:1}))
    .sort((a,b)=>b.leaves.length-a.leaves.length||a.rank-b.rank||a.cluster-b.cluster);
  const holder=new Map(),nested=new Set();
  for(const {m,leaves,rank} of held)for(const leaf of leaves){holder.set(leaf,m);if(rank===0)nested.add(leaf);}
  const lifted=[],crossing=[],seen=new Set(),entries=new Set(),exits=new Set();
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
    if(x===undefined||y===undefined)crossing.push({link,inside:a?x:y,outside:a?link.to:link.from,out:a});
  }
  const largest=Math.max(0,...held.filter(h=>h.rank===0).map(h=>h.leaves.length));
  return {homes,repeated,members,holder,nested,lifted,crossing,touching,entries,exits,largest};
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

// Published indexes: `0`, then the Nth node a map homes, in the map's left-to-right flow order,
// and so on down.
export function numberTree(tree,linkSet) {
  const access=treeAccess(tree),index=new Map([[TOP,TOP]]),stack=[TOP];
  while(stack.length) {
    const map=stack.pop(),drawn=drawMap(map,access,linkSet);
    const edges=[...new Set(drawn.lifted.map(l=>`${l.from}\n${l.to}`))].map(key=>key.split('\n'));
    const flow=flowOrder(drawn.members,edges);
    const homes=drawn.homes.sort((a,b)=>flow.get(a)-flow.get(b));
    homes.forEach((id,i)=>index.set(id,map===TOP?String(i+1):`${index.get(map)}.${i+1}`));
    for(const id of homes)if(tree.clusters.has(id))stack.push(id);
  }
  return index;
}

// Links numbered, with each leaf's link numbers, for drawMap.
export function linkSet(links) {
  const linksOf=new Map();
  links.forEach((link,n)=>{for(const end of [link.from,link.to])(linksOf.get(end)??linksOf.set(end,[]).get(end)).push(n);});
  return {links,linksOf:leaf=>linksOf.get(leaf)??[]};
}

// Only address-bearing fields are rewritten; a numeric data label is not a map address. Source
// addresses and tree indexes share one number space, so an object held by several pages is
// rewritten once: `seen` spans the whole pass.
const addressKeys=new Set(['index','handle','from','to','parent','port','mechanism','outside','via',
  'parentEndpoint','parentFrom','parentTo','caller','callee','page','endpoint','id']);
const address=/^([a-z-]+:)?(\d+(?:\.\d+)*)(@\d+)?$/;
export function renumber(value,tree,seen=new WeakSet()) {
  if(!value||typeof value!=='object'||seen.has(value))return value;
  seen.add(value);
  if(Array.isArray(value)){value.forEach(item=>renumber(item,tree,seen));return value;}
  for(const [key,item] of Object.entries(value)) {
    const m=addressKeys.has(key)&&typeof item==='string'&&address.exec(item);
    if(m&&tree.has(m[2]))value[key]=(m[1]??'')+tree.get(m[2])+(m[3]??'');
    else renumber(item,tree,seen);
  }
  return value;
}

export const homeOf=at=>at.includes('.')?at.slice(0,at.lastIndexOf('.')):TOP;
const byIndex=(a,b)=>{
  const x=a.split('.').map(Number),y=b.split('.').map(Number);
  for(let i=0;i<Math.max(x.length,y.length);i++)if((x[i]??-1)!==(y[i]??-1))return (x[i]??-1)-(y[i]??-1);
  return 0;
};

// Mark repeats on published pages (already renumbered): a repeat names its home map; a home
// node names every other map it appears on.
export function markRepeats(published) {
  const elsewhere=new Map();
  for(const page of published.values())for(const c of page.components??[]) {
    if(!published.has(c.index)||homeOf(c.index)===page.index)continue;
    const list=elsewhere.get(c.index)??elsewhere.set(c.index,new Set()).get(c.index);
    list.add(page.index);
  }
  for(const page of published.values())for(const c of page.components??[]) {
    delete c.home;delete c.alsoOn;
    if(!published.has(c.index))continue;
    if(homeOf(c.index)!==page.index)c.home=homeOf(c.index);
    else if(elsewhere.has(c.index))c.alsoOn=[...elsewhere.get(c.index)].sort(byIndex);
  }
}
