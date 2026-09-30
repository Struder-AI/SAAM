// Native UV regions with physical surface offsets and projected-plane fill.
// No affine UV-to-mm assumption or inverse surface mapping enters this stage.
import {offsetSurfaceRegion} from './surface-offset.mjs';
import {sectionPatch} from '../geom/section.mjs';
import {patchMeanNormal,slicePoint,sliceChartStep} from '../geom/slice.mjs';
import {sampledFieldStrokes} from './fill-patterns.mjs';
import {frontLayerStrokes} from './seeded-fronts.mjs';
import {clipOpenPaths,intersect,difference} from './intersection.mjs';
import {normalize,cross,dot,requireThat} from '../geom/tolerance.mjs';
import {lineSpacing} from '../path/spacing.mjs';

export function patchOffset(slice,region,distanceMm,{sampleStepMm=.2}={}) {
  return !region.length?[]:distanceMm===0?region:offsetSurfaceRegion(slice.patch,region,distanceMm,{maxStepMm:sampleStepMm}).loopsUv;
}

export function projectedFillStrokes(slice,region,{spacingMm,angleDeg,role='fill',sampleStepMm=.2,direction=null}) {
  if(!region.length)return [];
  const normal=direction??patchMeanNormal(slice.patch,region,{sampleStepMm}).normal;
  const seed=Math.abs(normal[0])<.9?[1,0,0]:[0,1,0];
  const x=normalize(seed.map((v,k)=>v-dot(seed,normal)*normal[k])),y=cross(normal,x),angle=angleDeg*Math.PI/180;
  const across=x.map((v,k)=>-Math.sin(angle)*v+Math.cos(angle)*y[k]);
  const positions=[];for(let i=0;i<slice.patch.cp.length;i+=4)positions.push(dot(across,[0,1,2].map(k=>slice.patch.cp[i+k]/slice.patch.cp[i+3])));
  const start=Math.ceil(Math.min(...positions)/spacingMm),end=Math.floor(Math.max(...positions)/spacingMm),curves=[];
  for(let lineIndex=start;lineIndex<=end;lineIndex++){
    const cut=sectionPatch(slice.patch,{normal:across,offset:lineIndex*spacingMm},{minFeatureMm:sampleStepMm});
    requireThat(!cut.coincident,'Projected fill plane coincides with the slice; change its projection direction.');
    const lines=cut.chains.map(chain=>chain.map(p=>[p.u,p.v]));
    for(const points of clipOpenPaths(lines,region))curves.push({role,closed:false,points:lineIndex%2?points.toReversed():points,lineIndex,spacingMm,fillFamily:{spacingMm,lineIndex}});
  }
  return curves;
}

export function patchLayerStrokes(slice,region,{widthMm,loops,fillDensity,fillPattern,fillAngleDeg,patternAngleDeg,solidDensity=1,fillOverlap,spacingFactor,sampleStepMm,solid=null,direction=null,fillOrder=null,layer=null,supportSegments=[]}) {
  if(fillOrder){
    const fronts=frontLayerStrokes({...layer,slice,region,direction},{...fillOrder,sampleStepMm,lineWidthMm:widthMm,supportSegments});
    return {walls:[],infill:[],fill:fronts.curves,interior:region,sparseRegion:[],solidRegion:region,constructionReport:fronts.report};
  }
  const pitch=lineSpacing(widthMm,{spacingFactor}),settings={sampleStepMm},walls=[];
  for(let ring=0;ring<loops;ring++)for(const points of patchOffset(slice,region,-widthMm/2-ring*pitch,settings))walls.push({role:ring?'perimeter-inner':'perimeter',closed:true,points,beadWidthMm:widthMm});
  const inset=loops?widthMm+(loops-1)*pitch+widthMm*(.5-fillOverlap):widthMm/2;
  const interior=patchOffset(slice,region,-inset,settings),solidRegion=fillDensity>=1?interior:solid?.length?intersect(interior,solid):[],sparseRegion=fillDensity>=1?[]:solid?difference(interior,solid):interior;
  const fill=projectedFillStrokes(slice,solidRegion,{spacingMm:pitch/solidDensity,angleDeg:fillAngleDeg,sampleStepMm,direction});
  const infill=[];
  if(fillDensity>0&&sparseRegion.length){
    if(fillPattern==='concentric'){
      for(let ring=0;;ring++){
        const found=patchOffset(slice,sparseRegion,-ring*pitch/fillDensity,settings);if(!found.length)break;
        infill.push(...found.map(points=>({role:'infill',closed:true,points,fillFamily:{spacingMm:pitch/fillDensity,lineIndex:ring}})));
      }
    }else if(fillPattern==='gyroid'){
      const periodMm=2.4*pitch/fillDensity,k=2*Math.PI/periodMm,steps=sliceChartStep(slice,Math.min(sampleStepMm,periodMm/32));
      const domains=[slice.patch.domainU,slice.patch.domainV],axes=domains.map(([lo,hi],axis)=>{
        const n=Math.max(2,Math.ceil((hi-lo)/steps[axis]));return Array.from({length:n+1},(_,i)=>lo+(hi-lo)*i/n);
      });
      const [xs,ys]=axes,values=xs.map(u=>Float64Array.from(ys,v=>{
        const [x,y,z]=slicePoint(slice,[u,v]).map(n=>n*k);return Math.sin(x)*Math.cos(y)+Math.sin(y)*Math.cos(z)+Math.sin(z)*Math.cos(x);
      }));
      infill.push(...sampledFieldStrokes({xs,ys,values},sparseRegion).map((curve,lineIndex)=>({...curve,role:'infill',fillFamily:{spacingMm:pitch/fillDensity,lineIndex}})));
    }else{
      const count=fillPattern==='grid'?2:fillPattern==='triangles'?3:1;
      for(let i=0;i<count;i++)infill.push(...projectedFillStrokes(slice,sparseRegion,{spacingMm:pitch*count/fillDensity,angleDeg:patternAngleDeg+i*180/count,sampleStepMm,direction,role:'infill'}));
    }
  }
  return {walls,infill,fill,interior,sparseRegion,solidRegion};
}
