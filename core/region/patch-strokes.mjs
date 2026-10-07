import {evaluateSurface} from '../geom/surface-evaluation.mjs';
import {normalize,cross,dot,requireThat} from '../private/toolpath/numeric.mjs';
// Native UV regions with physical surface offsets and projected-plane fill.
// No affine UV-to-mm assumption or inverse surface mapping enters this stage.
import {offsetSurfaceRegion} from './surface-offset.mjs';
import {sectionPatch} from '../geom/section.mjs';
import {patchMeanNormal,sliceChartStep} from '../geom/slice.mjs';
import {sampledFieldStrokes} from './fill-patterns.mjs';
import {clipOpenPaths} from './intersection.mjs';


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

// Native physical pattern algorithms; region/mask/boundary policy is shared.
export function patchPatternStrokes(slice,sparseRegion,{pitch,fillDensity,fillPattern,patternAngleDeg,sampleStepMm,direction}){
  const settings={sampleStepMm};
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
        const [x,y,z]=evaluateSurface(slice,[u,v]).point.map(n=>n*k);return Math.sin(x)*Math.cos(y)+Math.sin(y)*Math.cos(z)+Math.sin(z)*Math.cos(x);
      }));
      infill.push(...sampledFieldStrokes({xs,ys,values},sparseRegion).map((curve,lineIndex)=>({...curve,role:'infill',fillFamily:{spacingMm:pitch/fillDensity,lineIndex}})));
    }else{
      const count=fillPattern==='grid'?2:fillPattern==='triangles'?3:1;
      for(let i=0;i<count;i++)infill.push(...projectedFillStrokes(slice,sparseRegion,{spacingMm:pitch*count/fillDensity,angleDeg:patternAngleDeg+i*180/count,sampleStepMm,direction,role:'infill'}));
    }
  }
  return infill;
}

// Physical fields on evaluated charts without spline control points. Native
// patches retain their exact section kernel; this numerical kernel samples XYZ.
export function sampledChartPatternStrokes(slice,region,{pitch,fillDensity,fillPattern,patternAngleDeg,sampleStepMm,direction}){
  if(!region.length||fillDensity===0)return [];
  if(fillPattern==='concentric'){
    const strokes=[];for(let ring=0;;ring++){const loops=offsetSurfaceRegion(slice,region,-ring*pitch/fillDensity,{maxStepMm:sampleStepMm}).loopsUv;if(!loops.length)break;strokes.push(...loops.map(points=>({closed:true,points})));}return strokes;
  }
  const box=[0,1].map(k=>[Math.min(...region.flat().map(p=>p[k])),Math.max(...region.flat().map(p=>p[k]))]);
  const center=box.map(([a,b])=>(a+b)/2),frame=evaluateSurface(slice,center),normal=direction??frame.normal;
  const seed=Math.abs(normal[0])<.9?[1,0,0]:[0,1,0],x=normalize(seed.map((v,k)=>v-dot(seed,normal)*normal[k])),y=cross(normal,x);
  const axes=box.map(([lo,hi],k)=>{let length=0;for(const f of [0,.5,1]){const uv=center.slice();uv[1-k]=box[1-k][0]+f*(box[1-k][1]-box[1-k][0]);let previous;for(let i=0;i<=16;i++){uv[k]=lo+(hi-lo)*i/16;const p=evaluateSurface(slice,uv).point;if(previous)length+=Math.hypot(...p.map((v,j)=>v-previous[j]))/3;previous=p;}}const n=Math.max(2,Math.ceil(length/sampleStepMm));return Array.from({length:n+1},(_,i)=>lo+(hi-lo)*i/n);});
  const [xs,ys]=axes,points=xs.map(u=>ys.map(v=>evaluateSurface(slice,[u,v]).point)),curves=[];
  if(fillPattern==='gyroid'){const k=2*Math.PI/(2.4*pitch/fillDensity),values=points.map(row=>Float64Array.from(row,p=>{const [x,y,z]=p.map(n=>n*k);return Math.sin(x)*Math.cos(y)+Math.sin(y)*Math.cos(z)+Math.sin(z)*Math.cos(x);}));return sampledFieldStrokes({xs,ys,values},region);}
  const count=fillPattern==='grid'?2:fillPattern==='triangles'?3:1;
  for(let i=0;i<count;i++){const angle=(patternAngleDeg+i*180/count)*Math.PI/180,across=x.map((v,k)=>-Math.sin(angle)*v+Math.cos(angle)*y[k]),spacing=pitch*count/fillDensity,positions=points.map(row=>row.map(p=>dot(across,p))),min=Math.min(...positions.flat()),max=Math.max(...positions.flat());
    for(let lineIndex=Math.ceil(min/spacing);lineIndex<=Math.floor(max/spacing);lineIndex++){const values=positions.map(row=>Float64Array.from(row,n=>n-lineIndex*spacing));curves.push(...sampledFieldStrokes({xs,ys,values},region).map(stroke=>({...stroke,points:lineIndex%2?stroke.points.toReversed():stroke.points,fillFamily:{spacingMm:spacing,lineIndex}})));}
  }return curves;
}
