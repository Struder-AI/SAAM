// Nominal XY material footprint of open/closed deposition polylines. This
// represents bead-width strips, including overlaps, never their guide's fill.
import {clipperContext,offsetPaths} from './clipper.mjs';
import {requireThat} from '../geom/tolerance.mjs';
import {OFFSET_PRECISION_MM} from './offset.mjs';

export function strokeRegion(paths,widthMm,{precisionMm=OFFSET_PRECISION_MM,arcToleranceMm=.005}={}){
  requireThat(Number.isFinite(widthMm)&&widthMm>0,'Stroke-region width must be positive and finite.');
  requireThat(Number.isFinite(arcToleranceMm)&&arcToleranceMm>0,'Stroke-region arc tolerance must be positive and finite.');
  requireThat(Array.isArray(paths)&&paths.every(p=>Array.isArray(p)&&p.length>=2),'Stroke region requires polylines with at least two points.');
  if(!paths.length)return [];
  const context=clipperContext([paths],precisionMm,widthMm*2);
  return context.decode(offsetPaths(context.encode(paths),widthMm/(2*precisionMm),
    {join:'round',end:'Round',miterLimit:2,arcTolerance:arcToleranceMm/precisionMm}));
}
