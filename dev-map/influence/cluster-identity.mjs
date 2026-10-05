// Cluster identity: a name for each solved cluster that survives re-solves and small code
// changes, so the owner's positions (layout.json) and agents' `@cluster/…` addresses keep naming
// the same box. The solver numbers clusters afresh on every solve (`NODE/3`); an identity is
// carried by content instead.
//
//   NODE/~HEX       a cluster: HEX is the start of a hash of its leaves when it was first seen
//   NODE/library    a node's library of uniform helpers (one per node, fixed)
//
// Each regenerate matches the clusters it solved against the clusters of the stored model it
// replaces, node by node, by the Jaccard overlap of their leaves (every leaf under a cluster, by
// the leaf's stable identity `FILE::NAME[ #K]`, placement.mjs). Pairs are taken best first, one to
// one, while the overlap is at least MATCH; a matched cluster keeps the earlier identity, a cluster
// matching none gets a new one. When a cluster splits, its best-overlapping successor inherits it
// and the other parts are new; when clusters merge, the best-overlapping one's identity goes on and
// the others are retired. Every rematch, split, merge, retirement and new identity is reported.
//
// Each cluster's signature (its leaf count and a MinHash of its leaves) is stored with it in the
// model, and layout.json keeps the signature of each cluster it places, so a checkout without the
// earlier model (a fresh clone, a deleted store) still matches the owner's positions by estimated
// overlap. A key of the solver's numbering (`NODE/3`, layout.json before identities) is migrated
// to the identity of the cluster that numbering named.
import {createHash} from 'node:crypto';

// A cold solve (no kept solve to start from) can reshuffle a node's clusters: measured 2026-10-04
// on export and extensions, each earlier top-level cluster's best successor overlapped it by 0.27
// to 0.32. Matches below STRONG are reported as weak.
export const MATCH=0.25,STRONG=0.5;
const K=32;
const order=(a,b)=>a<b?-1:a>b?1:0;
export const isLegacy=id=>/^[^/]+\/\d+$/.test(id);
export const isCluster=id=>typeof id==='string'&&id.includes('/');
export const nodeOf=id=>id.slice(0,id.indexOf('/'));

// ---- signatures -----------------------------------------------------------------------------
// K minima of hashes of the leaves: the share of equal positions in two signatures estimates the
// Jaccard overlap of their sets (about ±0.09 at an overlap of one half).
export function signature(members) {
  const mins=new Uint32Array(K).fill(0xffffffff);
  for(const m of members)for(let s=0;s<K/8;s++) {
    const h=createHash('sha256').update(`${s}\n${m}`).digest();
    for(let j=0;j<8;j++){const v=h.readUInt32BE(j*4);if(v<mins[s*8+j])mins[s*8+j]=v;}
  }
  return {leaves:members.size??members.length,minhash:[...mins].map(v=>v.toString(16).padStart(8,'0')).join('')};
}
const minsOf=sig=>Array.from({length:K},(_,i)=>sig.minhash.slice(i*8,i*8+8));
function estimate(a,b) {
  if(!a?.minhash||!b?.minhash||a.minhash.length!==b.minhash.length)return 0;
  const x=minsOf(a),y=minsOf(b);let same=0;
  for(let i=0;i<K;i++)if(x[i]===y[i])same++;
  return same/K;
}
const mint=(node,members,taken)=>{
  const hex=createHash('sha256').update([...members].sort(order).join('\n')).digest('hex');
  for(let n=6;;n++){const id=`${node}/~${hex.slice(0,n)}`;if(!taken.has(id))return id;}
};

// ---- members --------------------------------------------------------------------------------
// The clusters of a stored model by page path: every leaf under each (by leaf identity), and its
// recorded identity and signature when the model has them.
export function storedClusters(model,leafIdent) {
  const graph=model.pages.filter(p=>p.destination==='graph'),byPath=new Map(graph.map(p=>[p.path,p])),under=new Map();
  const leavesOf=path=>{
    if(under.has(path))return under.get(path);
    const set=new Set();under.set(path,set);
    for(const c of byPath.get(path)?.components??[]) {
      if(c.kind==='group')for(const l of leavesOf(c.path))set.add(l);
      else set.add(leafIdent.get(c.path)??c.path);
    }
    return set;
  };
  const out=new Map();
  for(const p of graph) {
    const id=p.path.startsWith('@cluster/')?p.path.slice(9):null;
    if(!isCluster(id))continue;
    out.set(id,{identity:id,node:nodeOf(id),members:leavesOf(p.path),library:!!p.library,solverId:p.solverId??id});
  }
  return out;
}

// ---- matching -------------------------------------------------------------------------------
// now: the clusters just solved, [{id, node, members:Set, library, parent}] (solver ids).
// before: the identities to carry, [{identity, node, members:Set} | {identity, node, signature}].
// Returns each solved cluster's identity, the legacy keys renamed, the identities retired with
// why, and a report.
export function assignIdentities({now,before}) {
  const identity=new Map(),renamed=new Map(),retired=new Map(),taken=new Set(before.map(b=>b.identity));
  const report={match:MATCH,kept:0,rematched:[],split:[],merged:[],retired:[],new:[],migrated:[]};
  const sigs=new Map(),sigOf=c=>sigs.get(c.id)??sigs.set(c.id,signature(c.members)).get(c.id);
  const inter=(b,c)=>{
    if(b.members){let n=0;const [s,l]=b.members.size<c.members.size?[b.members,c.members]:[c.members,b.members];for(const x of s)if(l.has(x))n++;return n;}
    const j=estimate(b.signature,sigOf(c));return Math.round(j/(1+j)*(b.signature.leaves+c.members.size));
  };
  const sizeOf=b=>b.members?.size??b.signature.leaves;
  const overlap=(b,c)=>{const n=inter(b,c);return n?{n,j:n/(sizeOf(b)+c.members.size-n)}:null;};
  // Libraries are named by their node.
  const libraries=now.filter(c=>c.library),solved=now.filter(c=>!c.library);
  for(const c of libraries){identity.set(c.id,`${c.node}/library`);taken.add(`${c.node}/library`);}
  const libraryIds=new Set(libraries.map(c=>identity.get(c.id)));
  const old=before.filter(b=>!libraryIds.has(b.identity)&&!b.identity.endsWith('/library'));
  // Every overlapping pair within a node, best first.
  const pairs=[],overlaps=new Map();
  for(const b of old)for(const c of solved) {
    if(b.node!==c.node)continue;
    const o=overlap(b,c);if(!o)continue;
    overlaps.set(`${b.identity}\n${c.id}`,o);pairs.push({b,c,...o});
  }
  pairs.sort((x,y)=>y.j-x.j||order(x.b.identity,y.b.identity)||order(x.c.id,y.c.id));
  const heir=new Map(),from=new Map();
  for(const p of pairs) {
    if(p.j<MATCH)break;
    if(heir.has(p.b.identity)||from.has(p.c.id))continue;
    heir.set(p.b.identity,p);from.set(p.c.id,p);
  }
  // Matched clusters keep their identity; a legacy key's successor gets a new one.
  for(const c of [...solved].sort((x,y)=>order(x.id,y.id))) {
    const p=from.get(c.id);if(!p)continue;
    if(isLegacy(p.b.identity)){const id=mint(c.node,c.members,taken);taken.add(id);identity.set(c.id,id);renamed.set(p.b.identity,id);report.migrated.push({from:p.b.identity,to:id,overlap:round(p.j)});continue;}
    identity.set(c.id,p.b.identity);
    if(p.j<1)report.rematched.push({identity:p.b.identity,overlap:round(p.j),was:sizeOf(p.b),now:c.members.size,...(p.j<STRONG?{weak:true}:{}),...(p.b.members?{}:{estimated:true})});
    else report.kept++;
  }
  for(const c of [...solved].sort((x,y)=>order(x.id,y.id)))if(!identity.has(c.id)){const id=mint(c.node,c.members,taken);taken.add(id);identity.set(c.id,id);}
  // Splits: a new cluster mostly made of an earlier one whose identity went to another part
  // (not one nested in or around that part).
  const parentOf=new Map(now.map(c=>[c.id,c.parent])),byId=new Map(now.map(c=>[c.id,c]));
  const within=(a,b)=>{for(let x=a;x;x=parentOf.get(x))if(x===b)return true;return false;};
  const split=new Map();
  for(const c of solved) {
    if(from.has(c.id))continue;
    let best=null;
    for(const b of old){const o=overlaps.get(`${b.identity}\n${c.id}`);if(o&&o.n/c.members.size>=0.5&&(!best||o.n>best.o.n))best={b,o};}
    const h=best&&heir.get(best.b.identity);
    if(h&&!within(c.id,h.c.id)&&!within(h.c.id,c.id))(split.get(best.b.identity)??split.set(best.b.identity,{identity:best.b.identity,heir:identity.get(h.c.id),parts:[]}).get(best.b.identity)).parts.push(identity.get(c.id));
    else report.new.push(identity.get(c.id));
  }
  report.split=[...split.values()].map(s=>({...s,parts:s.parts.sort(order)}));
  // Earlier clusters with no successor: merged into the smallest cluster holding most of their
  // leaves, else retired with their best match.
  for(const b of old) {
    if(heir.has(b.identity))continue;
    let into=null,best=null;
    for(const c of solved) {
      const o=overlaps.get(`${b.identity}\n${c.id}`);if(!o)continue;
      if(o.n/sizeOf(b)>=0.5&&(!into||c.members.size<into.c.members.size))into={c,o};
      if(!best||o.j>best.o.j)best={c,o};
    }
    if(into){const to=identity.get(into.c.id);report.merged.push({identity:b.identity,into:to,share:round(into.o.n/sizeOf(b))});retired.set(b.identity,`merged into ${to}`);}
    else {report.retired.push({identity:b.identity,leaves:sizeOf(b),...(best?{best:identity.get(best.c.id),overlap:round(best.o.j)}:{})});
      const to=best&&identity.get(best.c.id);
      retired.set(b.identity,!best?'no successor (its leaves are gone)':best.o.j>=MATCH?`no successor (its best, ${to} at overlap ${round(best.o.j)}, carries a closer match)`
        :`no successor (best overlap ${round(best.o.j)} with ${to}, below ${MATCH})`);}
  }
  report.new.sort(order);
  const signatures=new Map(now.map(c=>[identity.get(c.id),sigOf(c)]));
  return {identity,renamed,retired,report,signatures,byId};
}
const round=x=>Math.round(x*1000)/1000;

// ---- layout references --------------------------------------------------------------------
// The cluster identities a layout's maps name: map paths, boxes and boundary boxes.
export function layoutClusters(maps) {
  const ids=new Set(),add=key=>{const k=key.startsWith('b:')?key.slice(2):key;if(k.startsWith('@cluster/')&&isCluster(k.slice(9)))ids.add(k.slice(9));};
  for(const [map,boxes] of Object.entries(maps)){add(map);for(const box of Object.keys(boxes))add(box);}
  return ids;
}
// A layout's maps with cluster keys renamed.
export function renameLayout(maps,renamed) {
  if(!renamed.size)return {maps,changed:0};
  let changed=0;
  const re=key=>{const b=key.startsWith('b:'),k=b?key.slice(2):key;
    if(!k.startsWith('@cluster/'))return key;const to=renamed.get(k.slice(9));if(!to)return key;changed++;return `${b?'b:':''}@cluster/${to}`;};
  const out={};
  for(const [map,boxes] of Object.entries(maps)) {
    const target=out[re(map)]??={};
    for(const [box,p] of Object.entries(boxes))target[re(box)]=p;
  }
  return {maps:out,changed};
}
