// One Construct Slice command per operation. Its members carry the queried fill
// regions for Trace sources and references.
import {constructSlice} from './slices.mjs';

export function constructSliceStack(spec,context,{work,plan,onProgress}){
  const slice=constructSlice(spec,context,{work,plan,onProgress}),layers=new Map();
  for(const member of slice.members){
    const {solidRegion,sparseRegion}=slice.fillRegions(member.index);
    layers.set(member.index,{...member,solidRegion,sparseRegion});
  }
  return {layers,finalized:slice.finalized};
}
