// SAAM pattern construction; shared kernels own clipping and offsets.
import {scanlineFill} from '../../../core/region/region2d.mjs';
import {offsetRegion} from '../../../core/region/offset.mjs';
import {clipOpenPaths} from '../../../core/region/intersection.mjs';
import {levelSetRegion} from '../../../core/region/boolean.mjs';
import {requireThat} from '../../../core/geom/tolerance.mjs';
import {lineSpacing} from '../../../core/path/spacing.mjs';

export const INFILL_PATTERNS=['rectilinear','grid','triangles','concentric','gyroid'];

export function infillStrokes(region,{pattern='rectilinear',widthMm,density,angleDeg=45,zMm=0,
  sampleStepMm=0.2,maxPatternCells=1000000,spacingFactor=1}) {
  requireThat(INFILL_PATTERNS.includes(pattern),'Unknown infill pattern.');
  requireThat(Number.isFinite(widthMm)&&widthMm>0&&Number.isFinite(density)&&density>=0&&density<=1,'Invalid infill width/density.');
  if(!region.length||density===0)return [];
  const spacing=lineSpacing(widthMm,{spacingFactor})/density;
  if(pattern==='concentric') {
    const strokes=[];
    for(let inset=0;;inset+=spacing){
      const loops=inset===0?region:offsetRegion(region,-inset);
      if(!loops.length)break;
      strokes.push(...loops.map(points=>({points,closed:true})));
    }
    return strokes;
  }
  if(pattern==='gyroid')return gyroid(region,{periodMm:2.4*spacing,zMm,sampleStepMm,maxPatternCells});
  const angles=pattern==='grid'?[angleDeg,angleDeg+90]:pattern==='triangles'?[angleDeg,angleDeg+60,angleDeg+120]:[angleDeg];
  // Split the requested line-length budget over all directions on EACH layer.
  return angles.flatMap((angle,direction)=>scanlineFill(region,spacing*angles.length,angle)
    .map((row,i)=>({closed:false,scanlineCell:direction+':'+row.cellId,points:i%2?[row.to,row.from]:[row.from,row.to]})));
}

// Nodal gyroid: sin(x)cos(y)+sin(y)cos(z)+sin(z)cos(x)=0.
// Reuse the existing sampled level-set constructor. Its artificial domain
// border closes positive regions, so remove only those border edges before
// asking Clipper2 to clip the actual open contours to the interior mask.
function gyroid(region,{periodMm,zMm,sampleStepMm,maxPatternCells}) {
  requireThat(Number.isFinite(sampleStepMm)&&sampleStepMm>0,'Gyroid sampleStepMm must be positive.');
  requireThat(Number.isSafeInteger(maxPatternCells)&&maxPatternCells>0,'Invalid gyroid maxPatternCells.');
  const min=[Infinity,Infinity],max=[-Infinity,-Infinity];
  for(const loop of region)for(const p of loop)for(let i=0;i<2;i++){min[i]=Math.min(min[i],p[i]-sampleStepMm);max[i]=Math.max(max[i],p[i]+sampleStepMm);}
  const step=Math.min(sampleStepMm,periodMm/32),nx=Math.ceil((max[0]-min[0])/step),ny=Math.ceil((max[1]-min[1])/step);
  requireThat(nx*ny<=maxPatternCells,`Gyroid needs ${nx*ny} cells; increase planar-infill.maxPatternCells (currently ${maxPatternCells}).`);
  const xs=Array.from({length:nx+1},(_,i)=>min[0]+(max[0]-min[0])*i/nx),
    ys=Array.from({length:ny+1},(_,i)=>min[1]+(max[1]-min[1])*i/ny),k=2*Math.PI/periodMm;
  const sz=Math.sin(k*zMm),cz=Math.cos(k*zMm);
  const sinY=ys.map(y=>Math.sin(k*y)),cosY=ys.map(y=>Math.cos(k*y));
  const values=xs.map(x=>{
    const sinX=Math.sin(k*x),cosX=Math.cos(k*x);
    return ys.map((_,j)=>sinX*cosY[j]+sinY[j]*cz+sz*cosX);
  });
  const loops=levelSetRegion({xs,ys,values},0),paths=[];
  const border=(a,b)=>[0,1].some(i=>[min[i],max[i]].some(v=>Math.abs(a[i]-v)<1e-8&&Math.abs(b[i]-v)<1e-8));
  for(const loop of loops){
    const cut=loop.findIndex((p,i)=>border(p,loop[(i+1)%loop.length]));
    if(cut<0){paths.push([...loop,loop[0]]);continue;}
    let run=[];
    for(let n=1;n<=loop.length;n++){
      const a=loop[(cut+n)%loop.length],b=loop[(cut+n+1)%loop.length];
      if(border(a,b)){if(run.length>1)paths.push(run);run=[];}
      else {if(!run.length)run.push(a);run.push(b);}
    }
    if(run.length>1)paths.push(run);
  }
  return clipOpenPaths(paths,region).filter(points=>points.length>1).map(points=>({points,closed:false}));
}
