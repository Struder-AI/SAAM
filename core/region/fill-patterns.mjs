// Shared pattern names and scalar-contour clipping. All surface pattern
// construction is owned by surface-patterns.mjs.
import {clipOpenPaths} from './intersection.mjs';
import {extractLevelSet} from '../geom/level-set.mjs';
export const FILL_PATTERNS=['rectilinear','grid','triangles','concentric','gyroid'];

// Contours retain chart coordinates; callers may evaluate the scalar in XYZ.
export function sampledFieldStrokes({xs,ys,values},region) {
  const curves=extractLevelSet({xs,ys,values},0,{output:'curves'});
  const paths=curves.map(({points,closed})=>closed?[...points,points[0]]:points);
  return clipOpenPaths(paths,region).filter(points=>points.length>1).map(points=>({points,closed:false}));
}
