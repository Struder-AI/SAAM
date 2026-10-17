// Sparse dependency edges are authoritative. Bounded memoization retains only
// queried pairs; eviction changes search work, never the graph or its meaning.
import {requireThat} from '../private/toolpath/numeric.mjs';
const PRECEDENCE_CACHE_BYTES=16*1024*1024;
const CACHED_PAIR_BYTES=128;

function reachability(ids,cacheBytes){
  const positions=new Map(ids.map((id,i)=>[id,i])),count=ids.length;
  requireThat(positions.size===count,'Precedence needs unique course IDs.');
  const following=Array(count),parents=Array(count),cache=new Map();
  const memo={oldest:cache.keys(),hits:0};
  const forwardSeen=new Uint32Array(count),backwardSeen=new Uint32Array(count);
  const cacheLimit=Math.max(0,Math.floor(cacheBytes/CACHED_PAIR_BYTES));
  let revision=0,stamp=0,rank=null;
  function position(id){const index=positions.get(id);requireThat(index!==undefined,'Precedence names an unknown course.');return index;}
  function search(a,b){
    if(!following[a]?.size||!parents[b]?.size)return false;
    if(following[a].has(b))return true;
    if(rank&&rank[a]>=rank[b])return false;
    const key=a+':'+b,known=cache.get(key);
    if(known===true||known===revision){
      cache.delete(key);cache.set(key,known);
      if(++memo.hits>=cache.size){memo.oldest=cache.keys();memo.hits=0;}
      return known===true;
    }
    stamp=(stamp+1)>>>0;
    if(stamp===0){forwardSeen.fill(0);backwardSeen.fill(0);stamp=1;}
    const forward=[a],backward=[b];forwardSeen[a]=stamp;backwardSeen[b]=stamp;
    let found=false;
    while(forward.length&&backward.length){
      const ahead=forward.length<=backward.length,front=ahead?forward:backward;
      const seen=ahead?forwardSeen:backwardSeen,other=ahead?backwardSeen:forwardSeen;
      for(const next of (ahead?following:parents)[front.pop()]??[]){
        if(other[next]===stamp){found=true;break;}
        if(seen[next]!==stamp){seen[next]=stamp;front.push(next);}
      }
      if(found)break;
    }
    if(cacheLimit){
      cache.delete(key);
      while(cache.size>=cacheLimit)cache.delete(memo.oldest.next().value);
      cache.set(key,found?true:revision);
      if(++memo.hits>=cache.size){memo.oldest=cache.keys();memo.hits=0;}
    }
    return found;
  }
  return {record(before,after){
    const a=position(before),b=position(after);
    if(following[a]?.has(b))return;
    (following[a]??=new Set()).add(b);(parents[b]??=new Set()).add(a);
    revision++;rank=null;
  },proves(before,after){return search(position(before),position(after));},acyclic(){
    const remaining=Uint32Array.from({length:count},(_,i)=>parents[i]?.size??0),ordered=[];
    for(let i=0;i<count;i++)if(!remaining[i])ordered.push(i);
    for(let i=0;i<ordered.length;i++)for(const next of following[ordered[i]]??[])if(!--remaining[next])ordered.push(next);
    if(ordered.length!==count)return false;
    rank=new Uint32Array(count);for(let i=0;i<count;i++)rank[ordered[i]]=i;return true;
  }};
}

export function prerequisiteProofs(ids,{cacheBytes=PRECEDENCE_CACHE_BYTES}={}){
  return reachability(ids,cacheBytes);
}

export function precedenceLookup(ids,edges,{cacheBytes=PRECEDENCE_CACHE_BYTES}={}){
  const graph=reachability(ids,cacheBytes);
  for(const {before,after} of edges)graph.record(before,after);
  return graph.acyclic()?{cyclic:false,has:(before,after)=>graph.proves(before,after)}:{cyclic:true,has:()=>false};
}
