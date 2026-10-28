import {cross,dot,requireThat} from './tolerance.mjs';
import {ROUNDING_MM,ROUNDING_RELATIVE} from '../dimensions.mjs';

// Native derivatives have length per parameter unit. Judge the physical
// tangent area over the declared domains, retaining the unit-domain pole law.
export function physicalSurfaceNormal(du,dv,domainSpans){
  const area=cross(du.map(value=>value*domainSpans[0]),dv.map(value=>value*domainSpans[1])),length=Math.hypot(...area);
  return Number.isFinite(length)&&length>ROUNDING_MM**2?area.map(value=>value/length):null;
}

// A regular evaluator already owns normal existence. Tangent direction and
// its projection use dimensionless scales, never a millimetre derivative test.
export function surfaceTangentFrame({du,normal}){
  requireThat(normal?.length===3&&normal.every(Number.isFinite),'Surface frame needs a regular tangent and normal.');
  const scale=Math.max(...du.map(Math.abs));
  requireThat(Number.isFinite(scale)&&scale>0,'Surface frame needs a regular tangent and normal.');
  const seed=du.map(value=>value/scale),projection=dot(seed,normal),tangent=seed.map((value,k)=>value-projection*normal[k]),length=Math.hypot(...tangent);
  requireThat(length>ROUNDING_RELATIVE,'Surface frame needs a regular tangent and normal.');
  const u=tangent.map(value=>value/length);
  return {u,v:cross(normal,u),normal};
}
