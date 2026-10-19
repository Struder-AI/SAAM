import {CONSTRUCTION_TOLERANCE_MM} from '../dimensions.mjs';
// Shared ambient normal offsets. Distinct from intrinsic boundary offsets.
// Mesh strips use interpolated selected-face vertex normals (an explicitly
// smooth normal field over faceted positions); native splines retain derivatives.
import {evaluateSurface} from '../geom/surface-evaluation.mjs';
import {sampleCurveIntervals} from '../geom/curve-sampling.mjs';
// Process scale: default chord tolerance and step of a surface curve; callers pass their own.
export function sampleSurfaceCurve(chart,uvAt,offsetMm,{toleranceMm=CONSTRUCTION_TOLERANCE_MM,maxStepMm=1}={}){
  return sampleCurveIntervals({at:t=>evaluateSurface(chart,uvAt(t),offsetMm),toleranceMm,stepMm:maxStepMm});
}
