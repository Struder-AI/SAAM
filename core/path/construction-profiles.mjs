// Authored scalar fields and their complete finalized physical-parameter laws.
import {profileAt,depositionAspectAdvisories} from './curve-profiles.mjs';
import {ROUNDING_MM} from '../dimensions.mjs';
import {distance,requireThat} from '../private/toolpath/numeric.mjs';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
// Profiles as read: increasing [t,value] pairs spanning 0..1, with positive
// values (speeds need only be finite: they pass through; zero flow moves without
// depositing). Any other key, such as pose (Slice output and field modulation
// supply it), or an unusable profile is left out and named in ignored.
const PROFILE_KEYS=['rateMm3PerMm','aspectRatio','beadWidthMm','heightMm','flowMultiplier','speedMmS'];
const usableProfile=(key,values)=>Array.isArray(values)&&values.length>=2&&values.every((p,i)=>Array.isArray(p)&&p.length===2&&Number.isFinite(p[0])&&(!i||p[0]>values[i-1][0]||['rateMm3PerMm','aspectRatio','speedMmS'].includes(key)&&i>1&&i<values.length-1&&p[0]===values[i-1][0]&&values[i-2]?.[0]<p[0]&&values[i+1]?.[0]>p[0])&&Number.isFinite(p[1])&&(['speedMmS','flowMultiplier'].includes(key)||(key==='rateMm3PerMm'?p[1]>=0:p[1]>0)))
  &&values[0][0]===0&&values.at(-1)[0]===1;
export function readCurveProfiles(vary){
  if(vary===undefined)return {vary:undefined,ignored:[]};
  const entries=vary&&typeof vary==='object'&&!Array.isArray(vary)?Object.entries(vary):null;
  if(!entries)return {vary:undefined,ignored:['vary']};
  const usable=entries.filter(([key,values])=>PROFILE_KEYS.includes(key)&&usableProfile(key,values));
  return {vary:usable.length?Object.fromEntries(usable):undefined,ignored:entries.filter(entry=>!usable.includes(entry)).map(([key])=>'vary.'+key)};
}
export function curveProfile(values,t,fallback){
  if(!values)return fallback;
  let i=1;while(i<values.length-1&&values[i][0]<=t)i++;
  const [a,x]=values[i-1],[b,y]=values[i],s=(t-a)/(b-a);
  return Array.isArray(x)?x.map((v,k)=>v+(y[k]-v)*s):x+(y-x)*s;
}
function segmentChannel(values,parameters){
  if(values.every(value=>same(value,values[0])))return values[0];
  // Segment samples describe a moving field. Connect their centres instead of
  // turning every sampled value into an instantaneous change at a vertex.
  const knots=[[0,values[0]]];
  for(const [i,value] of values.entries()){
    const u=(parameters[i]+parameters[i+1])/2;
    if(u>knots.at(-1)[0]&&u<1)knots.push([u,value]);
  }
  knots.push([1,values.at(-1)]);return {interpolation:'linear',knots};
}
function smoothChannel(stroke,key,parameters,fallback){
  const witness=stroke.profilePath,keys=witness?.vary?.[key];
  if(!keys||stroke.curveParameters?.length!==parameters.length)return fallback;
  const original=stroke.curveParameters;
  if(original[0]!==0||original.at(-1)!==1||!original.every((u,i)=>!i||u>original[i-1]))return fallback;
  for(let i=0;i<original.length-1;i++){
    const u=(original[i]+original[i+1])/2,state={lo:0,hi:witness.parameters.length-1};
    while(state.hi-state.lo>1){const mid=Math.floor((state.lo+state.hi)/2);if(witness.parameters[mid]<=u)state.lo=mid;else state.hi=mid;}
    const expected=key==='speedMmS'?witness.speedsMmS?.[state.lo]:witness.widthsMm?.[state.lo];
    const actual=key==='speedMmS'?stroke.segmentMetadata?.[i]?.speedMmS:stroke.segmentMetadata?.[i]?.beadWidthMm;
    if(expected!==actual)return fallback;
  }
  const converted=keys.map(([u,value])=>{
    const state={i:1};while(state.i<original.length-1&&original[state.i]<u)state.i++;
    const i=state.i,t=(u-original[i-1])/(original[i]-original[i-1]);
    return [parameters[i-1]+t*(parameters[i]-parameters[i-1]),value];
  });
  const profile={interpolation:'linear',knots:converted},authored={interpolation:'linear',knots:keys};
  // A changed centerline can change its parameter spacing. Sparse authored
  // fields survive only when they still describe the finalized locations.
  if(original.some((u,i)=>Math.abs(profileAt(profile,parameters[i])-profileAt(authored,u))>ROUNDING_MM))return fallback;
  return profile;
}

export function constructionScalarProfiles(stroke,parameters,process,{physicalLengthsMm}={}){
  const metadata=stroke.points.slice(1).map((_,i)=>stroke.segmentMetadata?.[i]??{});
  const widths=metadata.map(m=>m.beadWidthMm??stroke.beadWidthMm??process.lineWidthMm);
  const speeds=metadata.map(m=>m.speedMmS??stroke.speedMmS);
  const chords=metadata.map((m,i)=>distance(stroke.points[i],stroke.points[i+1]));
  const rates=metadata.map((m,i)=>stroke.volumesMm3?stroke.volumesMm3[i]/chords[i]:stroke.beadAreaMm2);
  const aspects=metadata.map((m,i)=>{
    const height=m.beadHeightMm??stroke.beadHeightMm??process.layerMm;
    return rates[i]>0?widths[i]*widths[i]/rates[i]:stroke.profilePath?.aspects?.[i]??(widths[i]>0?widths[i]/(height>0?height:process.layerMm):1);
  });
  requireThat(rates.every(value=>Number.isFinite(value)&&value>=0)&&aspects.every(value=>Number.isFinite(value)&&value>0),'Finalized deposition needs finite rate and aspect.');
  const authoredRate=canonicalAuthored(stroke,'rateMm3PerMm',parameters,rates),authoredAspect=canonicalAuthored(stroke,'aspectRatio',parameters,aspects);
  const canonicalMaterial=authoredRate!==null&&authoredAspect!==null;
  const adjustedRates=canonicalMaterial||!physicalLengthsMm?rates:rates.map((rate,i)=>rate*chords[i]/physicalLengthsMm[i]);
  const adjustedAspects=canonicalMaterial||!physicalLengthsMm?aspects:adjustedRates.map((rate,i)=>rate>0?widths[i]*widths[i]/rate:aspects[i]);
  // Each finalized segment keeps its physical law. Equal-u keys are its exact
  // left/right limits; they are not samples interpolated across discontinuities.
  const profiles={rateMm3PerMm:canonicalMaterial?authoredRate:segmentLimits(adjustedRates,parameters),aspectRatio:canonicalMaterial?authoredAspect:segmentLimits(adjustedAspects,parameters),
    speedMmS:smoothChannel(stroke,'speedMmS',parameters,segmentChannel(speeds,parameters))};
  return {canonicalMaterial,profiles,advisories:depositionAspectAdvisories(profiles,{label:'Finalized construction section'})};
}
function canonicalAuthored(stroke,key,parameters,values){
  const original=stroke.curveParameters,authored=stroke.profilePath?.vary?.[key];
  if(!authored||original?.length!==parameters.length||original[0]!==0||original.at(-1)!==1||!original.every((u,i)=>!i||u>original[i-1]))return null;
  if(values.some((value,i)=>Math.abs(value-curveProfile(authored,(original[i]+original[i+1])/2))>ROUNDING_MM))return null;
  const locations=[...new Set([...original,...authored.map(([u])=>u)])].sort((a,b)=>a-b);
  const authoredProfile={interpolation:'linear',knots:authored};
  return {interpolation:'linear',knots:locations.flatMap(u=>{
    const state={i:1};while(state.i<original.length-1&&original[state.i]<u)state.i++;
    const i=state.i,t=(u-original[i-1])/(original[i]-original[i-1]);
    const at=parameters[i-1]+t*(parameters[i]-parameters[i-1]),left=profileAt(authoredProfile,u,'left'),right=profileAt(authoredProfile,u);
    return u>0&&u<1&&left!==right?[[at,left],[at,right]]:[[at,right]];
  })};
}
function segmentLimits(values,parameters){
  if(values.every(value=>value===values[0]))return values[0];
  const knots=[[0,values[0]]];
  for(let i=1;i<values.length;i++)if(values[i]!==values[i-1])knots.push([parameters[i],values[i-1]],[parameters[i],values[i]]);
  knots.push([1,values.at(-1)]);return {interpolation:'linear',knots};
}
