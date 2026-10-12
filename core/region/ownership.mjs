// Material allocation between explicit claims and a default remainder.
import {difference,intersect} from './intersection.mjs';
import {offsetRegion} from './offset.mjs';
import {PRINT_RESOLUTION_MM} from '../dimensions.mjs';

// A shared edge, or a sliver no wider than the tolerance (print resolution by
// default), is not positive material. An offset grid a hundredth of the
// tolerance keeps the ordinary perimeter grid from swallowing a real intersection.
export function positiveClaimRegion(region,toleranceMm=PRINT_RESOLUTION_MM){
  return !!region.length&&offsetRegion(region,-toleranceMm/2,{precisionMm:toleranceMm/100,arcToleranceMm:toleranceMm/8}).length>0;
}
// An explicit claimant owns the region inside its claim, whatever other claims
// also cover; a default owner retains what no explicit claim covers. A null
// claim region covers the whole region.
export function allocateChartClaims(region,claims,{principal,retainUnclaimed=false}){
  const own=claims.find(claim=>claim.owner===principal);
  if(own)return own.region===null?region:intersect(region,own.region);
  return retainUnclaimed?claims.reduce((rest,{region:cut})=>cut===null||!rest.length?[]:difference(rest,cut),region):[];
}
