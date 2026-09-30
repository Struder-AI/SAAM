// Allocate actual regions expressed on one common chart. Claim order selects
// the principal; course alternation never changes the geometric intersection.
import {difference,intersect} from './boolean.mjs';

export function allocateChartClaims(region,claims,{principal,courseIndex,firstShared=new Map(),retainUnclaimed=false}){
  let cells=[{region,claimants:[]}];
  for(const {owner,region:cut} of claims){
    const next=[];
    for(const cell of cells){
      const inside=cut===null?cell.region:intersect(cell.region,cut),outside=cut===null?[]:difference(cell.region,cut);
      if(inside.length)next.push({region:inside,claimants:[...cell.claimants,owner]});
      if(outside.length)next.push({region:outside,claimants:cell.claimants});
    }
    cells=next;
  }
  const allocated=[];
  for(const cell of cells){
    if(!cell.claimants.length){if(retainUnclaimed)allocated.push({owner:principal,region:cell.region,shared:false});continue;}
    if(cell.claimants[0]!==principal)continue;
    const key=cell.claimants.map(owner=>owner.id).join('|');
    if(!firstShared.has(key))firstShared.set(key,courseIndex);
    const turn=(courseIndex-firstShared.get(key))%cell.claimants.length;
    allocated.push({owner:cell.claimants[turn],region:cell.region,shared:cell.claimants.length>1});
  }
  return allocated;
}
