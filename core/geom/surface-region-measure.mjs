import {evaluateSurface} from './surface-evaluation.mjs';
import {surfaceChartBounds,surfaceChartStep} from '../region/surface-operations.mjs';
import {regionArea} from '../region/region2d.mjs';
import {intersect} from '../region/intersection.mjs';
import {cross} from './tolerance.mjs';
import {PRINT_RESOLUTION_MM} from '../dimensions.mjs';

// Physical region measures and a saved material envelope. Affine charts can
// answer exactly; curved charts integrate their metric at the requested step.
export function measureSurfaceRegion(surface,region,{sampleStepMm=.5,lineWidthMm=.4}={}){
  if(!region.length)return {areaMm2:0,worldRegion:[],maxZ:-Infinity,planarZMm:null};
  const world=region.map(loop=>loop.map(uv=>evaluateSurface(surface,uv).point));
  const heights=world.flat().map(p=>p[2]);
  let areaMm2=0;
  if(surface.kind==='plane')areaMm2=regionArea(region)*Math.hypot(...cross(surface.xAxis,surface.yAxis));
  else{
    const bounds=surfaceChartBounds(surface,region.flat()),steps=surfaceChartStep(surface,bounds,sampleStepMm);
    const counts=bounds.map(([a,b],k)=>Math.max(1,Math.ceil((b-a)/steps[k])));
    for(let i=0;i<counts[0];i++)for(let j=0;j<counts[1];j++){
      const lo=bounds.map(([a,b],k)=>a+(b-a)*[i,j][k]/counts[k]),hi=bounds.map(([a,b],k)=>a+(b-a)*([i,j][k]+1)/counts[k]);
      const weight=regionArea(intersect(region,[[lo,[hi[0],lo[1]],hi,[lo[0],hi[1]]]]));
      if(!weight)continue;
      const e=evaluateSurface(surface,lo.map((v,k)=>(v+hi[k])/2));
      areaMm2+=weight*Math.hypot(...cross(e.du,e.dv));heights.push(e.point[2]);
    }
  }
  const maxZ=Math.max(...heights),planarZMm=maxZ-Math.min(...heights)<=PRINT_RESOLUTION_MM?maxZ:null;
  const worldRegion=world.map(loop=>loop.map(p=>p.slice(0,2)));
  const materialGeometry=planarZMm!==null?{kind:'planar',loops:worldRegion,zMm:planarZMm,maxZ,lineWidthMm}:
    (surface.kind==='height-field'||surface.kind==='plane'&&Math.abs(surface.normal[2])>PRINT_RESOLUTION_MM)?
      {kind:'surface',loops:worldRegion,surface,maxZ,lineWidthMm,sampleStepMm,sagMm:0}:{kind:'bounds',maxZ};
  return {areaMm2,worldRegion,maxZ,planarZMm,materialGeometry};
}
