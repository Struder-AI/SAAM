// Shared ambient normal offsets. Distinct from intrinsic boundary offsets.
// Mesh strips use interpolated selected-face vertex normals (an explicitly
// smooth normal field over faceted positions); native splines retain derivatives.
import {evaluateSurface} from '../geom/surface-evaluation.mjs';
import {sampleCurveIntervals} from '../geom/curve-sampling.mjs';
export function sampleSurfaceCurve(chart,uvAt,offsetMm,{toleranceMm=.01,maxStepMm=1}={}){
  return sampleCurveIntervals({at:t=>evaluateSurface(chart,uvAt(t),offsetMm),toleranceMm,stepMm:maxStepMm});
}
