// The cluster solver. The leaves are given and so is the top map `0`; the solver authors every
// cluster between them: which clusters exist, where each leaf and cluster is homed, and which
// boxes each map repeats. Its goal is the tree's energy, the mean map score (score.mjs), lowered
// by simulated annealing from the tree as placed (tree.mjs). It writes the lowest-energy tree it
// met to dev-map/tree.json. Labels are authored in a label pass, never here; a cluster that
// survives a solve keeps its label, matched by the leaves it holds, and a new one needs a label.
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {TOP,treeFile,drawMap,linkSet,numberTree,treeFileOf} from './tree.mjs';
import {scoreDrawn,callersOf,readModel} from './score.mjs';

const random=seed=>()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);
  t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};
const pick=(rand,list)=>list[Math.floor(rand()*list.length)];

// The live tree the annealer owns and changes in place. Every change is journalled, so a
// rejected move is undone exactly, and a move rescores only the maps it can have changed: along
// each moved node's old and new chains up to where they meet, the maps a cluster whose leaves
// changed is repeated on, and the maps whose repeats or clusters changed.
function createAnnealer(start,links) {
  const parent=new Map(start.parent),clusters=new Map([...start.clusters].map(([id,c])=>[id,{...c}]));
  const children=new Map([[TOP,new Set()],...[...clusters.keys()].map(id=>[id,new Set()])]);
  for(const [id,p] of parent)children.get(p).add(id);
  const repeats=new Map(),repeatedOn=new Map();
  for(const [map,set] of start.repeats)for(const id of set)linkRepeat(map,id);
  function linkRepeat(map,id){(repeats.get(map)??repeats.set(map,new Set()).get(map)).add(id);(repeatedOn.get(id)??repeatedOn.set(id,new Set()).get(id)).add(map);}
  function unlinkRepeat(map,id){repeats.get(map)?.delete(id);repeatedOn.get(id)?.delete(map);}
  const leaves=[...parent.keys()].filter(id=>!clusters.has(id));
  const set=linkSet(links),callers=callersOf(links);
  const neighbours=new Map(leaves.map(leaf=>[leaf,[]]));
  for(const {from,to} of links){neighbours.get(from).push(to);neighbours.get(to).push(from);}
  let next=1+Math.max(0,...[...clusters.keys()].map(id=>Number(/^c(\d+)$/.exec(id)?.[1]??0)));

  let under=new Map();
  const leavesOf=id=>{
    if(!clusters.has(id)&&id!==TOP)return [id];
    if(!under.has(id))under.set(id,[...children.get(id)].flatMap(leavesOf));
    return under.get(id);
  };
  const access={childrenOf:id=>children.get(id)??[],repeatsOn:id=>repeats.get(id)??[],isCluster:id=>clusters.has(id),leavesOf};
  const scoreOf=map=>scoreDrawn(drawMap(map,access,set),callers).score;
  const chain=id=>{const found=[];for(let p=parent.get(id);p!==undefined;p=parent.get(p))found.push(p);return found;};
  const inside=(map,id)=>map===id||chain(map).includes(id);

  const scores=new Map([[TOP,scoreOf(TOP)],...[...clusters.keys()].map(id=>[id,scoreOf(id)])]);
  let sum=[...scores.values()].reduce((a,b)=>a+b,0);

  // The journal of one move.
  let journal,touched,created,deleted,repeatChanged;
  const begin=()=>{journal=[];touched=new Map();created=new Set();deleted=new Map();repeatChanged=new Set();};
  const setParent=(id,to)=>{
    const from=parent.get(id);if(from===to)return;
    if(!touched.has(id))touched.set(id,chain(id));
    children.get(from).delete(id);children.get(to).add(id);parent.set(id,to);
    journal.push(()=>{children.get(to).delete(id);children.get(from).add(id);parent.set(id,from);});
  };
  const addRepeat=(map,id)=>{linkRepeat(map,id);repeatChanged.add(map);journal.push(()=>unlinkRepeat(map,id));};
  const dropRepeat=(map,id)=>{if(!repeats.get(map)?.has(id))return;unlinkRepeat(map,id);repeatChanged.add(map);journal.push(()=>linkRepeat(map,id));};
  const addCluster=to=>{
    const id=`c${next++}`;
    clusters.set(id,{label:null});children.set(id,new Set());parent.set(id,to);children.get(to).add(id);created.add(id);
    journal.push(()=>{children.get(to).delete(id);parent.delete(id);children.delete(id);clusters.delete(id);});
    return id;
  };
  // Dissolve: what it homes goes to its parent, and every repeat of it or on it goes.
  const dissolve=id=>{
    const up=parent.get(id);
    for(const child of [...children.get(id)])setParent(child,up);
    for(const other of [...repeats.get(id)??[]])dropRepeat(id,other);
    for(const map of [...repeatedOn.get(id)??[]])dropRepeat(map,id);
    const label=clusters.get(id);
    children.get(up).delete(id);parent.delete(id);children.delete(id);clusters.delete(id);deleted.set(id,up);
    journal.push(()=>{clusters.set(id,label);children.set(id,new Set());parent.set(id,up);children.get(up).add(id);});
  };

  // The two rules (tree.mjs), restored after a move on what the move touched.
  function settle(movedClusters) {
    for(const id of movedClusters) {
      if(!clusters.has(id))continue;
      const stack=[id];
      while(stack.length){const map=stack.pop();
        for(const other of [...repeats.get(map)??[]])if(clusters.has(other)&&inside(map,other))dropRepeat(map,other);
        for(const child of children.get(map))if(clusters.has(child))stack.push(child);}
    }
    for(let changed=true;changed;) {
      changed=false;
      for(const [id] of touched)if(parent.has(id))
        for(const map of [...repeatedOn.get(id)??[]])if(parent.get(id)===map||clusters.has(id)&&inside(map,id))dropRepeat(map,id);
      const check=new Set([...[...touched.values()].map(c=>c[0]),...repeatChanged,...created,...deleted.values()]);
      for(const id of check) {
        if(!clusters.has(id))continue;
        const home=children.get(id).size;
        if(home>=1&&home+(repeats.get(id)?.size??0)>=2)continue;
        dissolve(id);changed=true;
      }
    }
  }

  // Which maps the move can have changed.
  function affected() {
    const maps=new Set([...repeatChanged,...created,...deleted.values()]),changedLeaves=new Set();
    for(const id of created)maps.add(parent.get(id));
    for(const [id,old] of touched) {
      if(!parent.has(id))continue;
      const now=chain(id),inNow=new Set(now);
      const meet=old.findIndex(p=>inNow.has(p));
      const lca=old[meet];
      for(const p of old.slice(0,meet))changedLeaves.add(p);
      for(const p of now.slice(0,now.indexOf(lca)))changedLeaves.add(p);
      maps.add(lca);
    }
    for(const p of changedLeaves){maps.add(p);for(const map of repeatedOn.get(p)??[])maps.add(map);}
    for(const id of deleted.keys())maps.delete(id);
    return [...maps].filter(map=>map===TOP||clusters.has(map));
  }

  // Apply a move, settle, rescore; returns the change in energy and how to undo it.
  function attempt(move) {
    begin();
    const moved=move();
    if(!moved){for(const undo of journal.reverse())undo();return null;}
    settle(moved===true?[]:moved);
    if(!journal.length)return null;
    under=new Map();
    const before=sum/scores.size,old=new Map();
    for(const id of deleted.keys())if(scores.has(id)){old.set(id,scores.get(id));sum-=scores.get(id);scores.delete(id);}
    for(const map of affected()) {
      if(!old.has(map))old.set(map,scores.get(map));
      const score=scoreOf(map);sum+=score-(scores.get(map)??0);scores.set(map,score);
    }
    const undoing=journal;
    return {delta:sum/scores.size-before,undo:()=>{
      for(const undo of undoing.reverse())undo();
      for(const [map,score] of old){sum+=(score??0)-(scores.get(map)??0);if(score===undefined)scores.delete(map);else scores.set(map,score);}
      under=new Map();
    }};
  }

  // The moves. Each returns false when it does not apply, true when it applied, or the clusters
  // it re-parented, whose inside repeats settle checks.
  const maps=()=>[TOP,...clusters.keys()];
  const clusterIds=()=>[...clusters.keys()];
  const nearOf=(rand,id)=>{const own=leavesOf(id),leaf=pick(rand,own),n=pick(rand,neighbours.get(leaf)??[]);return n;};
  const moves=[
    [0.35,rand=>{ // re-home a leaf, usually beside one it links to
      const leaf=pick(rand,leaves),n=pick(rand,neighbours.get(leaf));
      const to=n!==undefined&&rand()<0.7?parent.get(n):pick(rand,maps());
      if(to===parent.get(leaf))return false;
      setParent(leaf,to);return true;}],
    [0.1,rand=>{ // re-parent a cluster
      const ids=clusterIds();if(!ids.length)return false;
      const id=pick(rand,ids),n=nearOf(rand,id);
      const to=n!==undefined&&rand()<0.7?parent.get(n):pick(rand,maps());
      if(to===parent.get(id)||inside(to,id))return false;
      setParent(id,to);return [id];}],
    [0.1,rand=>{ // form a cluster from boxes a map homes, usually linked ones
      const map=pick(rand,maps()),homes=[...children.get(map)];
      if(homes.length<3)return false;
      const size=2+Math.floor(rand()*Math.min(4,homes.length-2)),group=new Set([pick(rand,homes)]);
      for(let tries=0;group.size<size&&tries<3*size;tries++) {
        let found=pick(rand,homes);
        const n=nearOf(rand,pick(rand,[...group]));
        if(n!==undefined&&rand()<0.8){let box=n;for(let p=parent.get(n);p!==undefined&&p!==map;p=parent.get(p))box=p;if(parent.get(box)===map)found=box;}
        group.add(found);
      }
      if(group.size<2||group.size>=homes.length)return false;
      const id=addCluster(map);
      for(const box of group)setParent(box,id);
      return [...group].filter(box=>clusters.has(box));}],
    [0.07,rand=>{ // dissolve a cluster
      const ids=clusterIds();if(!ids.length)return false;
      dissolve(pick(rand,ids));return true;}],
    [0.08,rand=>{ // merge a cluster into a sibling
      const ids=clusterIds();if(!ids.length)return false;
      const id=pick(rand,ids),siblings=[...children.get(parent.get(id))].filter(s=>s!==id&&clusters.has(s));
      if(!siblings.length)return false;
      const into=pick(rand,siblings),moved=[...children.get(id)].filter(c=>clusters.has(c));
      for(const child of [...children.get(id)])setParent(child,into);
      for(const other of [...repeats.get(id)??[]])if(!repeats.get(into)?.has(other))addRepeat(into,other);
      dissolve(id);return moved;}],
    [0.18,rand=>{ // repeat on a cluster map a box its content links to
      const ids=clusterIds();if(!ids.length)return false;
      const map=pick(rand,ids),n=nearOf(rand,map);
      if(n===undefined||inside(n,map))return false;
      const around=new Set([map,...chain(map)]),options=[n];
      for(let p=parent.get(n);p!==undefined&&!around.has(p);p=parent.get(p))options.push(p);
      const box=rand()<0.5?n:pick(rand,options);
      if(repeats.get(map)?.has(box))return false;
      addRepeat(map,box);return true;}],
    [0.12,rand=>{ // drop a repeat
      const held=[...repeats].filter(([,s])=>s.size);if(!held.length)return false;
      const [map,s]=pick(rand,held);dropRepeat(map,pick(rand,[...s]));return true;}],
  ];
  const propose=rand=>{
    let r=rand();
    for(const [weight,move] of moves){if(r<weight)return attempt(()=>move(rand));r-=weight;}
    return attempt(()=>moves[0][1](rand));
  };
  const snapshot=()=>({parent:new Map(parent),clusters:new Map([...clusters].map(([id,c])=>[id,{...c}])),
    repeats:new Map([...repeats].filter(([,s])=>s.size).map(([map,s])=>[map,new Set(s)]))});
  const energy=()=>{sum=[...scores.values()].reduce((a,b)=>a+b,0);return sum/scores.size;};
  return {propose,snapshot,energy,size:()=>leaves.length+clusters.size};
}

// Anneal. The temperature starts where half the average uphill moves are taken and cools
// geometrically; a stage is as many moves as there are nodes, and the solve ends when a whole
// stage takes no move that changes the energy (the tree has frozen). Returns the lowest-energy
// tree seen.
export function solveTree(start,links,{seed=1,onStage}={}) {
  const rand=random(seed),annealer=createAnnealer(start,links);
  const first=annealer.energy();
  const uphill=[];
  for(let i=0;i<annealer.size();i++){const t=annealer.propose(rand);if(!t)continue;if(t.delta>0)uphill.push(t.delta);t.undo();}
  let temperature=uphill.reduce((a,b)=>a+b,0)/Math.max(1,uphill.length)/Math.LN2;
  let best={energy:first,tree:annealer.snapshot()};
  for(let stage=0;;stage++) {
    let accepted=0,changed=0;
    const moves=annealer.size();
    for(let i=0;i<moves;i++) {
      const t=annealer.propose(rand);if(!t)continue;
      if(t.delta<=0||rand()<Math.exp(-t.delta/temperature)){accepted++;if(Math.abs(t.delta)>1e-12)changed++;}
      else t.undo();
    }
    const now=annealer.energy();
    if(now<best.energy-1e-12)best={energy:now,tree:annealer.snapshot()};
    onStage?.({stage,temperature,energy:now,best:best.energy,accepted,changed,moves});
    if(!changed)break;
    temperature*=0.93;
  }
  return {start:first,energy:best.energy,tree:best.tree};
}

// Labels follow the leaves: a solved cluster takes the label and id of the starting cluster whose
// nested leaves it shares more than half of (by Jaccard overlap), one to one, best first.
export function carryLabels(from,to) {
  const leavesUnder=tree=>{
    const kids=new Map();for(const [id,p] of tree.parent)(kids.get(p)??kids.set(p,[]).get(p)).push(id);
    const found=new Map(),walk=id=>{if(!tree.clusters.has(id))return [id];
      if(!found.has(id))found.set(id,(kids.get(id)??[]).flatMap(walk));return found.get(id);};
    for(const id of tree.clusters.keys())walk(id);
    return found;
  };
  const before=leavesUnder(from),after=leavesUnder(to),holding=new Map();
  for(const [id,leaves] of before)for(const leaf of leaves)(holding.get(leaf)??holding.set(leaf,[]).get(leaf)).push(id);
  const pairs=[];
  for(const [id,leaves] of after) {
    const shared=new Map();
    for(const leaf of leaves)for(const old of holding.get(leaf)??[])shared.set(old,(shared.get(old)??0)+1);
    for(const [old,n] of shared) {
      const overlap=n/(leaves.length+before.get(old).length-n);
      if(overlap>0.5)pairs.push({id,old,overlap});
    }
  }
  pairs.sort((a,b)=>b.overlap-a.overlap||(a.id<b.id?-1:1));
  const renamed=new Map(),used=new Set();
  for(const {id,old} of pairs)if(!renamed.has(id)&&!used.has(old)){renamed.set(id,old);used.add(old);}
  // Unmatched clusters take ids no starting cluster had.
  let next=1+Math.max(0,...[...from.clusters.keys(),...to.clusters.keys()].map(id=>Number(/^c(\d+)$/.exec(id)?.[1]??0)));
  for(const id of [...to.clusters.keys()].sort())if(!renamed.has(id))renamed.set(id,`c${next++}`);
  const rename=id=>renamed.get(id)??id;
  return {parent:new Map([...to.parent].map(([id,p])=>[rename(id),rename(p)])),
    clusters:new Map([...to.clusters.keys()].map(id=>[rename(id),{label:renamed.get(id)&&used.has(renamed.get(id))?from.clusters.get(renamed.get(id))?.label??null:null}])),
    repeats:new Map([...to.repeats].map(([map,s])=>[rename(map),new Set([...s].map(rename))])),
    carried:[...renamed].filter(([,old])=>used.has(old)).length};
}

// Solve the stored tree and write it to tree.json.
export async function solve({repo,seed=1,onStage}={}) {
  const {held,tree,links}=await readModel({repo});
  const result=solveTree(tree,links,{seed,onStage});
  const solved=carryLabels(tree,result.tree);
  const index=numberTree(solved,linkSet(links));
  const file={...treeFileOf(solved,index),solved:{from:held.generated,seed,start:result.start,energy:result.energy}};
  await writeFile(resolve(repo,treeFile),JSON.stringify(file,null,1)+'\n');
  return {start:result.start,energy:result.energy,clusters:solved.clusters.size,carried:solved.carried,
    repeats:[...solved.repeats.values()].reduce((n,s)=>n+s.size,0),file:treeFile};
}
