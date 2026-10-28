// Material allocation between explicit claims and a default remainder.
import {difference,intersect} from './intersection.mjs';

// An explicit claimant owns the region inside its claim, whatever other claims
// also cover; a default owner retains what no explicit claim covers. A null
// claim region covers the whole region.
export function allocateChartClaims(region,claims,{principal,retainUnclaimed=false}){
  const own=claims.find(claim=>claim.owner===principal);
  if(own)return own.region===null?region:intersect(region,own.region);
  return retainUnclaimed?claims.reduce((rest,{region:cut})=>cut===null||!rest.length?[]:difference(rest,cut),region):[];
}
