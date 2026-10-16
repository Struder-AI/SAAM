// Pattern geometry on any regular surface chart. Representation-specific
// intersection and offset kernels stay behind Geometry's common operations.
import {evaluateSurface,surfaceChartCovers} from '../geom/surface-evaluation.mjs';
import {sectionSurface} from '../geom/section.mjs';
import {surfaceChartBounds,surfaceChartStep,offsetSliceRegion} from './surface-operations.mjs';
import {sampledFieldStrokes} from './fill-patterns.mjs';
import {clipOpenPaths} from './intersection.mjs';
import {connectScanlineCells,regionComponents} from './region2d.mjs';
import {requireThat,normalize,cross,dot} from '../geom/tolerance.mjs';

export function surfacePatternStrokes(surface,region,{pitch,fillDensity,fillPattern,patternAngleDeg=0,sampleStepMm=.2,direction=null}){
  if(!region.length||fillDensity===0)return [];
  const spacing=pitch/fillDensity;
  if(fillPattern==='concentric'){
    const curves=[];
    for(const [component,owned] of regionComponents(region).entries())for(let ring=0;;ring++){
      const loops=offsetSliceRegion(surface,owned,-ring*spacing,{sampleStepMm});
      if(!loops.length)break;
      curves.push(...loops.map(points=>({closed:true,points,orderGroup:'concentric:'+component,fillFamily:{spacingMm:spacing,lineIndex:ring}})));
    }
    return curves;
  }
  const bounds=surfaceChartBounds(surface,region.flat()),steps=surfaceChartStep(surface,bounds,fillPattern==='gyroid'?Math.min(sampleStepMm,2.4*spacing/32):sampleStepMm);
  const axes=bounds.map(([lo,hi],k)=>{const count=Math.max(2,Math.ceil((hi-lo)/steps[k]));return Array.from({length:count+1},(_,i)=>lo+(hi-lo)*i/count);});
  if(fillPattern==='gyroid'){
    const [xs,ys]=axes,k=2*Math.PI/(2.4*spacing);
    const values=xs.map(u=>Float64Array.from(ys,v=>{
      if(!surfaceChartCovers(surface,[u,v]))return NaN;
      const [x,y,z]=evaluateSurface(surface,[u,v]).point.map(n=>n*k);
      return Math.sin(x)*Math.cos(y)+Math.sin(y)*Math.cos(z)+Math.sin(z)*Math.cos(x);
    }));
    return sampledFieldStrokes({xs,ys,values},region).map((curve,lineIndex)=>({...curve,fillFamily:{spacingMm:spacing,lineIndex}}));
  }
  const center=bounds.map(([a,b])=>(a+b)/2),normal=normalize(direction??evaluateSurface(surface,center).normal);
  const seed=Math.abs(normal[0])<.9?[1,0,0]:[0,1,0],x=normalize(seed.map((v,k)=>v-dot(seed,normal)*normal[k])),y=cross(normal,x);
  // Native control hulls give conservative bounds. Evaluated charts use the
  // declared physical sampling scale; neither detail escapes this operation.
  const native=surface.patch??(surface.cp?surface:null),points=[];
  if(native)for(let i=0;i<native.cp.length;i+=4)points.push([0,1,2].map(k=>native.cp[i+k]/native.cp[i+3]));
  else for(const u of axes[0])for(const v of axes[1])if(surfaceChartCovers(surface,[u,v]))points.push(evaluateSurface(surface,[u,v]).point);
  const count=fillPattern==='grid'?2:fillPattern==='triangles'?3:1,curves=[];
  for(let family=0;family<count;family++){
    const angle=(patternAngleDeg+family*180/count)*Math.PI/180,across=x.map((v,k)=>-Math.sin(angle)*v+Math.cos(angle)*y[k]),along=x.map((v,k)=>Math.cos(angle)*v+Math.sin(angle)*y[k]),step=spacing*count;
    const positions=points.map(p=>dot(across,p)),first=Math.floor(Math.min(...positions)/step),last=Math.ceil(Math.max(...positions)/step);
    function* rows(){
      for(let lineIndex=first;lineIndex<=last;lineIndex++){
        const cut=sectionSurface(surface,{normal:across,offset:lineIndex*step},{boundsUv:bounds,sampleStepMm});
        requireThat(!cut.coincident,'Fill plane coincides with its reference surface; choose another direction.');
        const paths=clipOpenPaths(cut.chains.map(chain=>chain.map(p=>[p.u,p.v])),region);
        yield paths.map(points=>{
          const positions=points.map(point=>dot(along,evaluateSurface(surface,point).point));
          const forward=positions.at(-1)>=positions[0]?points:points.toReversed();
          return {left:Math.min(...positions),right:Math.max(...positions),
            row:{closed:false,points:forward,fillFamily:{spacingMm:step,lineIndex}}};
        }).sort((a,b)=>a.left-b.left||a.right-b.right);
      }
    }
    // Retain each uninterrupted run across adjacent sections. Splits, merges
    // and empty rows end a cell; these are traversal preferences, not support.
    for(const [cell,rowsInCell] of connectScanlineCells(rows()).entries())
      curves.push(...rowsInCell.map((row,i)=>({...row,scanlineCell:family+':'+cell,points:i%2?row.points.toReversed():row.points})));
  }
  return curves;
}
