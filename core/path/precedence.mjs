// Exact reachability over known course dependencies. A bounded dense cache is
// an acceleration only; larger graphs use one reusable search row instead.
import {requireThat} from '../private/toolpath/numeric.mjs';
const PRECEDENCE_CACHE_BYTES=16*1024*1024;

// Cache witnessed paths while prerequisites are discovered. A positive proof
// permits pruning; a missing proof only costs another geometric query. Rows
// inherit the proofs available when an edge is recorded, so no invalidation or
// propagation through every earlier row is needed. Cache size is bounded.
export function prerequisiteProofs(ids,{cacheBytes=PRECEDENCE_CACHE_BYTES}={}){
  const positions=new Map(ids.map((id,i)=>[id,i])),count=ids.length,words=Math.ceil(count/32);
  const dense=count*words*Uint32Array.BYTES_PER_ELEMENT<=cacheBytes?new Uint32Array(count*words):null;
  const parents=dense?null:Array.from({length:count},()=>[]),row={after:-1,seen:dense?null:new Uint8Array(count),pending:[]};
  function inherit(before){
    row.pending.push(before);
    while(row.pending.length){const next=row.pending.pop();if(row.seen[next])continue;row.seen[next]=1;for(const parent of parents[next])row.pending.push(parent);}
  }
  return {record(before,after){
    const a=positions.get(before),b=positions.get(after);
    requireThat(a!==undefined&&b!==undefined,'Prerequisite proof names an unknown course.');
    if(dense){const target=b*words,source=a*words;dense[target+(a>>>5)]|=1<<(a&31);for(let w=0;w<words;w++)dense[target+w]|=dense[source+w];}
    else {parents[b].push(a);if(row.after===b)inherit(a);}
  },proves(before,after){
    const a=positions.get(before),b=positions.get(after);
    requireThat(a!==undefined&&b!==undefined,'Prerequisite proof names an unknown course.');
    if(dense)return (dense[b*words+(a>>>5)]&(1<<(a&31)))!==0;
    if(row.after!==b){row.after=b;row.seen.fill(0);for(const parent of parents[b])inherit(parent);}
    return row.seen[a]!==0;
  }};
}

export function precedenceLookup(ids,edges,{cacheBytes=PRECEDENCE_CACHE_BYTES}={}){
  const positions=new Map(ids.map((id,i)=>[id,i])),count=ids.length,words=Math.ceil(count/32);
  requireThat(positions.size===count,'Precedence needs unique course IDs.');
  const following=Array.from({length:count},()=>[]),indegree=new Uint32Array(count);
  for(const {before,after} of edges){
    requireThat(positions.has(before)&&positions.has(after),'Precedence names an unknown course.');
    const a=positions.get(before),b=positions.get(after);following[a].push(b);indegree[b]++;
  }
  const ordered=[];
  for(let i=0;i<count;i++)if(!indegree[i])ordered.push(i);
  for(let i=0;i<ordered.length;i++)for(const next of following[ordered[i]])if(!--indegree[next])ordered.push(next);
  if(ordered.length!==count)return {cyclic:true,has:()=>false};
  const dense=count*words*Uint32Array.BYTES_PER_ELEMENT<=cacheBytes?new Uint32Array(count*words):null;
  if(dense)for(let i=count-1;i>=0;i--){
    const a=ordered[i],offset=a*words;
    for(const b of following[a]){
      const other=b*words;dense[offset+(b>>>5)]|=1<<(b&31);
      for(let w=0;w<words;w++)dense[offset+w]|=dense[other+w];
    }
  }
  const search={source:-1,row:dense?null:new Uint32Array(words),pending:[]};
  return {cyclic:false,has(before,after){
    const a=positions.get(before),b=positions.get(after);
    requireThat(a!==undefined&&b!==undefined,'Precedence query names an unknown course.');
    if(a===b)return false;
    if(dense)return (dense[a*words+(b>>>5)]&(1<<(b&31)))!==0;
    if(search.source!==a){
      search.source=a;search.row.fill(0);search.pending.push(a);
      while(search.pending.length)for(const next of following[search.pending.pop()])
        if(!(search.row[next>>>5]&(1<<(next&31)))){search.row[next>>>5]|=1<<(next&31);search.pending.push(next);}
    }
    return (search.row[b>>>5]&(1<<(b&31)))!==0;
  }};
}
