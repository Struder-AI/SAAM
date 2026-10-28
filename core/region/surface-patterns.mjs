// Pattern geometry on any regular surface chart. Representation-specific
// intersection and offset kernels stay behind Geometry's common operations.
import {evaluateSurface,surfaceChartCovers} from '../geom/surface-evaluation.mjs';
import {surfaceChartBounds,surfaceChartStep,offsetSliceRegion,parallelSliceRows} from './surface-operations.mjs';
import {sampledFieldStrokes,FILL_PATTERNS} from './fill-patterns.mjs';
import {connectScanlineCells,regionComponents} from './region2d.mjs';
import {dot,cross,normalize,requireThat} from '../geom/tolerance.mjs';

export function surfacePatternStrokes(surface,region,{pitch,fillDensity,fillPattern,patternAngleDeg=0,rowPhaseMm=0,sampleStepMm=.2,direction=null,ungrouped=false}){
  if(!region.length||fillDensity===0)return [];
  requireThat(Number.isFinite(pitch)&&pitch>0&&Number.isFinite(fillDensity)&&fillDensity>0&&fillDensity<=1,'Infill needs positive physical spacing and density at most one.');
  requireThat(FILL_PATTERNS.includes(fillPattern),'Unknown infill pattern: '+fillPattern);
  requireThat(Number.isFinite(patternAngleDeg)&&Number.isFinite(rowPhaseMm),'Infill orientation and phase must be finite.');
  const spacing=pitch/fillDensity;
  if(fillPattern==='concentric'){
    const curves=[];
    for(const [component,owned] of regionComponents(region).entries())for(let ring=0;;ring++){
      const phase=((rowPhaseMm%spacing)+spacing)%spacing;
      const loops=offsetSliceRegion(surface,owned,-(ring*spacing+phase),{sampleStepMm});
      if(!loops.length)break;
      curves.push(...loops.map(points=>({closed:true,points,orderGroup:'concentric:'+component,fillFamily:{spacingMm:spacing,lineIndex:ring}})));
    }
    return curves;
  }
  if(fillPattern==='gyroid'){
    const bounds=surfaceChartBounds(surface,region.flat()),steps=surfaceChartStep(surface,bounds,Math.min(sampleStepMm,2.4*spacing/32));
    let center=bounds.map(([lo,hi])=>(lo+hi)/2);
    if(!surfaceChartCovers(surface,center))center=region[0][0];
    const normal=normalize(direction??evaluateSurface(surface,center).normal),axis=Math.abs(normal[0])<.9?[1,0,0]:[0,1,0];
    const xAxis=normalize(axis.map((v,k)=>v-dot(axis,normal)*normal[k])),yAxis=cross(normal,xAxis),angle=patternAngleDeg*Math.PI/180;
    const along=xAxis.map((v,k)=>v*Math.cos(angle)+yAxis[k]*Math.sin(angle)),across=cross(normal,along);
    const axes=bounds.map(([lo,hi],k)=>{const count=Math.max(2,Math.ceil((hi-lo)/steps[k]));return Array.from({length:count+1},(_,i)=>lo+(hi-lo)*i/count);});
    const [xs,ys]=axes,k=2*Math.PI/(2.4*spacing);
    const values=xs.map(u=>Float64Array.from(ys,v=>{
      if(!surfaceChartCovers(surface,[u,v]))return NaN;
      const point=evaluateSurface(surface,[u,v]).point;
      const [x,y,z]=[dot(along,point),dot(across,point),dot(normal,point)-rowPhaseMm].map(n=>n*k);
      return Math.sin(x)*Math.cos(y)+Math.sin(y)*Math.cos(z)+Math.sin(z)*Math.cos(x);
    }));
    return sampledFieldStrokes({xs,ys,values},region).map((curve,lineIndex)=>({...curve,fillFamily:{spacingMm:spacing,lineIndex}}));
  }
  const count=fillPattern==='grid'?2:fillPattern==='triangles'?3:1,curves=[];
  for(let family=0;family<count;family++){
    const step=spacing*count,result=parallelSliceRows(surface,region,{spacingMm:step,angleDeg:patternAngleDeg+family*180/count,phaseMm:rowPhaseMm,sampleStepMm,direction});
    function* rows(){
      for(const {lineIndex,paths} of result.rows)yield paths.map(points=>{
        const positions=points.map(point=>dot(result.along,evaluateSurface(surface,point).point));
        const forward=positions.at(-1)>=positions[0]?points:points.toReversed();
        const left=Math.min(...positions),right=Math.max(...positions);
        return {left,right,row:{closed:false,points:forward,fillFamily:{spacingMm:step,lineIndex},row:{family,lineIndex,left,right,along:result.along}}};
      }).sort((a,b)=>a.left-b.left||a.right-b.right);
    }
    // Retain each uninterrupted run across adjacent sections. Splits, merges
    // and empty rows end a cell; these are traversal preferences, not support.
    if(ungrouped){for(const spans of rows())curves.push(...spans.map(span=>span.row));continue;}
    for(const [cell,rowsInCell] of connectScanlineCells(rows()).entries())
      curves.push(...rowsInCell.map(row=>({...row,scanlineCell:family+':'+cell})));
  }
  return curves;
}
