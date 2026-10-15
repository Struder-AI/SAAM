// Exact reachability over known course dependencies. A bounded dense cache is
// an acceleration only; larger graphs use one reusable search row instead.
import {requireThat} from '../private/toolpath/numeric.mjs';

export function precedenceLookup(ids,edges,{cacheBytes=16*1024*1024}={}){
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
