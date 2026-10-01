// Exclusive material allocation. Shared positive claims are unsupported until
// the shared-ownership contract is implemented; assignment order is not a fix.
import {difference,intersect} from './boolean.mjs';
import {offsetRegion} from './offset.mjs';
import {TOLERANCE,requireThat} from '../geom/tolerance.mjs';

export function requireExclusiveClaims(a,b,{uncertain=false}={}){
  const name=o=>`${o.assignment?.id??o.id}${o.part!==undefined&&o.part!==null?` on ${o.part}`:''}`;
  requireThat(false,`Unsupported material overlap between assignments "${name(a)}" and "${name(b)}": ${uncertain?'cannot establish exclusive material claims for these intersecting volumes':'both claim positive material'}. Use disjoint regions or one assignment; shared ownership is deferred to 0.4.0.`);
}
// A shared edge, or at most one coincidence tolerance of polygon-rounding
// noise, is not positive material. Fine offset precision avoids the ordinary
// perimeter offset grid swallowing a real small overlap.
export function positiveClaimRegion(region,toleranceMm=TOLERANCE.point){
  return !!region.length&&offsetRegion(region,-toleranceMm/2,{precisionMm:1e-9,arcToleranceMm:toleranceMm/8}).length>0;
}
export function allocateChartClaims(region,claims,{principal,retainUnclaimed=false,toleranceMm=TOLERANCE.point}){
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
    if(cell.claimants.length>1&&positiveClaimRegion(cell.region,toleranceMm))requireExclusiveClaims(cell.claimants[0],cell.claimants[1]);
    // Numerical contact slivers stay exclusive, in deterministic claim order.
    const owner=cell.claimants[0]??(retainUnclaimed?principal:null);
    if(owner===principal)allocated.push({owner,region:cell.region,shared:false});
  }
  return {allocated};
}
