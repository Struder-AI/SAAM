import {evaluateSurface,surfaceChartCovers} from './surface-evaluation.mjs';
import {requireThat} from './tolerance.mjs';
import {PRINT_RESOLUTION_MM,PROGRAM_STEP_MM} from '../dimensions.mjs';
import {extractLevelSet,SENTINEL} from './level-set.mjs';

// Contours of an evaluated predicate, sampled at the requested spatial pitch
// and bisected to program resolution at each detected crossing. Features wholly
// between grid samples are outside this explicitly sampled topology contract.
export function sampledChartRegion(bounds,stepMm,contains,{surface=null,precisionUv=PRINT_RESOLUTION_MM}={}) {
  requireThat((Array.isArray(stepMm)?stepMm:[stepMm]).every(s=>Number.isFinite(s)&&s>0),'Chart sampling pitch must be positive.');
  const counts=[0,1].map(i=>Math.max(2,Math.ceil((bounds.max[i]-bounds.min[i])/(Array.isArray(stepMm)?stepMm[i]:stepMm))));
  const axes=[0,1].map(axis=>Array.from({length:counts[axis]+3},(_,i)=>bounds.min[axis]+(i-1)*(bounds.max[axis]-bounds.min[axis])/counts[axis]));
  const [xs,ys]=axes,values=xs.map(x=>Float64Array.from(ys,y=>contains([x,y])?SENTINEL:-SENTINEL));
  const worldPoint=uv=>surface&&surfaceChartCovers(surface,uv)?evaluateSurface(surface,uv).point:null;
  const crossingWide=(a,b,pa,pb)=>{
    if(pa&&pb)return Math.hypot(...pa.map((v,k)=>v-pb[k]))>PROGRAM_STEP_MM;
    return Math.hypot(a[0]-b[0],a[1]-b[1])>(surface?precisionUv:PROGRAM_STEP_MM);
  };
  const refine=(inside,outside)=>{
    const endpoints={a:inside,b:outside,pa:worldPoint(inside),pb:worldPoint(outside)};
    while(crossingWide(endpoints.a,endpoints.b,endpoints.pa,endpoints.pb)) {
      const {a,b}=endpoints,middle=[(a[0]+b[0])/2,(a[1]+b[1])/2];
      // Halving has reached floating-point precision: a is the boundary.
      if(middle[0]===a[0]&&middle[1]===a[1]||middle[0]===b[0]&&middle[1]===b[1])break;
      if(contains(middle)){endpoints.a=middle;endpoints.pa=worldPoint(middle);}
      else{endpoints.b=middle;endpoints.pb=worldPoint(middle);}
    }
    return endpoints.a;
  };
  return extractLevelSet({xs,ys,values},0,{refine,precision:precisionUv});
}
