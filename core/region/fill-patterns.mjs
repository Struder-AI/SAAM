import {requireThat} from '../private/toolpath/numeric.mjs';
// Sparse fill patterns of a slice layer, in its chart. Shared kernels own
// clipping and offsets.
import {scanlineFill} from './region2d.mjs';
import {offsetRegion} from './offset.mjs';
import {clipOpenPaths} from './intersection.mjs';
import {extractLevelSet} from '../geom/level-set.mjs';

import {lineSpacing} from '../path/spacing.mjs';

export const FILL_PATTERNS=['rectilinear','grid','triangles','concentric','gyroid'];

export function fillPatternStrokes(region,{pattern='rectilinear',widthMm,density,angleDeg=45,zMm=0,
  sampleStepMm=0.2,spacingFactor=1}) {
  requireThat(FILL_PATTERNS.includes(pattern),'Unknown fill pattern.');
  requireThat(Number.isFinite(widthMm)&&widthMm>0&&Number.isFinite(density)&&density>=0&&density<=1,'Invalid fill width or density.');
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
  if(pattern==='gyroid')return gyroid(region,{periodMm:2.4*spacing,zMm,sampleStepMm});
  const angles=pattern==='grid'?[angleDeg,angleDeg+90]:pattern==='triangles'?[angleDeg,angleDeg+60,angleDeg+120]:[angleDeg];
  // Split the requested line-length budget over all directions on EACH layer.
  return angles.flatMap((angle,direction)=>scanlineFill(region,spacing*angles.length,angle)
    .map((row,i)=>({closed:false,scanlineCell:direction+':'+row.cellId,points:i%2?[row.to,row.from]:[row.from,row.to]})));
}

// Nodal gyroid: sin(x)cos(y)+sin(y)cos(z)+sin(z)cos(x)=0.
// Geometry extracts the genuine level contours; clipping applies the interior
// material mask without constructing or removing artificial domain edges.
// The sampling step and the section's own size decide the grid; a layer is
// never refused because its cell count is large. Column values are typed rows,
// and the per-row sines are shared across columns.
function gyroid(region,{periodMm,zMm,sampleStepMm}) {
  requireThat(Number.isFinite(sampleStepMm)&&sampleStepMm>0,'Gyroid sampleStepMm must be positive.');
  const min=[Infinity,Infinity],max=[-Infinity,-Infinity];
  for(const loop of region)for(const p of loop)for(let i=0;i<2;i++){min[i]=Math.min(min[i],p[i]-sampleStepMm);max[i]=Math.max(max[i],p[i]+sampleStepMm);}
  const step=Math.min(sampleStepMm,periodMm/32),nx=Math.ceil((max[0]-min[0])/step),ny=Math.ceil((max[1]-min[1])/step);
  const xs=Array.from({length:nx+1},(_,i)=>min[0]+(max[0]-min[0])*i/nx),
    ys=Array.from({length:ny+1},(_,i)=>min[1]+(max[1]-min[1])*i/ny),k=2*Math.PI/periodMm;
  const sz=Math.sin(k*zMm),cz=Math.cos(k*zMm);
  const sinY=ys.map(y=>Math.sin(k*y)),cosY=ys.map(y=>Math.cos(k*y));
  const values=xs.map(x=>{
    const sinX=Math.sin(k*x),cosX=Math.cos(k*x);
    return Float64Array.from(ys,(_,j)=>sinX*cosY[j]+sinY[j]*cz+sz*cosX);
  });
  return sampledFieldStrokes({xs,ys,values},region);
}

// Contours retain chart coordinates; callers may evaluate the scalar in XYZ.
export function sampledFieldStrokes({xs,ys,values},region) {
  const curves=extractLevelSet({xs,ys,values},0,{output:'curves'});
  const paths=curves.map(({points,closed})=>closed?[...points,points[0]]:points);
  return clipOpenPaths(paths,region).filter(points=>points.length>1).map(points=>({points,closed:false}));
}
