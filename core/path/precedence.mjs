// Sparse edges are authoritative. Bounded bit rows retain proven reachability;
// only a complete row can prove absence. Eviction changes work, never answers.
import {requireThat} from '../private/toolpath/numeric.mjs';
const PRECEDENCE_CACHE_BYTES=16*1024*1024;
function reachability(ids,cacheBytes){
  const positions=new Map(ids.map((id,i)=>[id,i])),count=ids.length;
  requireThat(positions.size===count,'Precedence needs unique course IDs.');
  const following=Array(count),parents=Array(count),rows=Array(count),seats=[];
  const words=Math.ceil(count/32),limit=Math.max(0,Math.floor(cacheBytes/(words*4+128)));
  const seen=new Uint32Array(count);let stamp=0,cursor=0,rank=null;
  function position(id){const index=positions.get(id);requireThat(index!==undefined,'Precedence names an unknown course.');return index;}
  const has=(row,i)=>Boolean(row.bits[i>>>5]&(1<<(i&31)));
  const set=(row,i)=>{row.bits[i>>>5]|=1<<(i&31);};
  // FIFO seats bound storage without repeated Map promotion or tombstone scans.
  function rowFor(a){
    if(rows[a])return rows[a];
    const row={bits:new Uint32Array(words),complete:false};
    if(limit){
      if(seats.length<limit)seats.push(a);
      else{rows[seats[cursor]]=undefined;seats[cursor]=a;cursor=(cursor+1)%limit;}
      rows[a]=row;
    }
    return row;
  }
  function search(a,b){
    if(!following[a]?.size||!parents[b]?.size)return false;
    if(following[a].has(b))return true;
    if(rank&&rank[a]>=rank[b])return false;
    const row=rowFor(a);if(has(row,b))return true;if(row.complete)return false;
    stamp=(stamp+1)>>>0;if(!stamp){seen.fill(0);stamp=1;}
    const pending=[a];seen[a]=stamp;
    while(pending.length){
      const node=pending.pop(),known=rows[node];
      if(node!==a&&known?.complete){for(let i=0;i<words;i++)row.bits[i]|=known.bits[i];continue;}
      for(const next of following[node]??[]){set(row,next);if(seen[next]!==stamp){seen[next]=stamp;pending.push(next);}}
    }
    row.complete=true;return has(row,b);
  }
  return {record(before,after){
    const a=position(before),b=position(after);if(following[a]?.has(b))return;
    (following[a]??=new Set()).add(b);(parents[b]??=new Set()).add(a);rank=null;
    // Only ancestors of the new edge can change. A complete successor row
    // extends their exact closure; otherwise retain positives and reopen them.
    const target=rows[b],complete=!following[b]?.size||target?.complete;
    for(const id of seats){const row=rows[id];if(id!==a&&!has(row,a)||row.complete&&has(row,b))continue;
      set(row,b);if(target)for(let i=0;i<words;i++)row.bits[i]|=target.bits[i];if(!complete)row.complete=false;
    }
  },proves(before,after){return search(position(before),position(after));},acyclic(){
    const remaining=Uint32Array.from({length:count},(_,i)=>parents[i]?.size??0),ordered=[];
    for(let i=0;i<count;i++)if(!remaining[i])ordered.push(i);
    for(let i=0;i<ordered.length;i++)for(const next of following[ordered[i]]??[])if(!--remaining[next])ordered.push(next);
    if(ordered.length!==count)return false;
    rank=new Uint32Array(count);for(let i=0;i<count;i++)rank[ordered[i]]=i;return true;
  }};
}
export function prerequisiteProofs(ids,{cacheBytes=PRECEDENCE_CACHE_BYTES}={}){return reachability(ids,cacheBytes);}
export function precedenceLookup(ids,edges,{cacheBytes=PRECEDENCE_CACHE_BYTES}={}){
  const graph=reachability(ids,cacheBytes);for(const {before,after} of edges)graph.record(before,after);
  return graph.acyclic()?{cyclic:false,has:(before,after)=>graph.proves(before,after)}:{cyclic:true,has:()=>false};
}
