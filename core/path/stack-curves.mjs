import {evaluateSurface} from '../geom/surface-evaluation.mjs';
import {requireThat,dot,cross,normalize,distance} from '../private/toolpath/numeric.mjs';
import {PRINT_RESOLUTION_MM,ROUNDING_RELATIVE} from '../dimensions.mjs';

import {sampleAuthoredCurve} from './authored-curves.mjs';
import {sampleCurveIntervals} from '../geom/curve-sampling.mjs';
import {spiralProfile,spiralHeight,spiralBeadCurve} from './curve-construction.mjs';

// A layer the sleeve chart joins has one closed boundary of at least three points.
const joinable=layer=>layer.curves?.length===1&&layer.curves[0].closed&&layer.curves[0].points.length>=3;
// Ascending layer indices as runs: "layer 3", "layers 3, 5–8".
const layerList=indices=>(indices.length>1?'layers ':'layer ')+indices.reduce((runs,index)=>{const run=runs.at(-1);if(run&&index===run[1]+1)run[1]=index;else runs.push([index,index]);return runs;},[])
  .map(([a,b])=>a===b?`${a}`:`${a}–${b}`).join(', ');

// Stack boundaries are already offset/clipped/mapped. A sleeve is their
// around/layer correspondence, so joins never reslice geometry or select a skill.
// spiralStackCurve passes only a run of two or more joinable layers.
export function boundarySleeve(referenceStack){
  requireThat(referenceStack.layers.length>=2&&referenceStack.layers.every(joinable),'A boundary sleeve joins two or more layers, each with one closed boundary.');
  return {kind:'sleeve-chart',layers:referenceStack.layers,direction:normalize(referenceStack.direction??[0,0,1])};
}

function stackNormal(sleeve,u,v){
  const at=index=>{
    const layer=sleeve.layers[index],curve=layer.curves[0];
    if(layer.slice?.kind==='plane')return layer.slice.normal;
    requireThat(curve.frameSamples?.length===curve.points.length,'Curved stack joins need boundary frame normals.');
    const points=[...curve.points,curve.points[0]],lengths=[0];for(let i=1;i<points.length;i++)lengths.push(lengths.at(-1)+distance(points[i-1],points[i]));
    const along=((u%1)+1)%1*lengths.at(-1);let i=1;while(i<lengths.length-1&&lengths[i]<along)i++;
    const t=(along-lengths[i-1])/(lengths[i]-lengths[i-1]),a=curve.frameSamples[i-1].normal,b=curve.frameSamples[i%curve.points.length].normal;
    return normalize(a.map((x,k)=>x+(b[k]-x)*t));
  };
  const coordinate=Math.max(0,Math.min(sleeve.layers.length-1,v)),lo=Math.floor(coordinate),hi=Math.min(sleeve.layers.length-1,lo+1),t=coordinate-lo,a=at(lo),b=at(hi);
  return normalize(a.map((x,k)=>x+(b[k]-x)*t));
}

// A boundary function is the wall itself; its layers only label segments, so
// any layer count and shape spirals. A sleeve chart is interpolated between
// layer boundaries: it joins the longest run of consecutive joinable layers,
// and every other layer prints its boundaries as separate closed layers
// (layerCurves; one note names them). Without such a run, profile is null and
// layerCurves hold every layer.
export function spiralStackCurve({referenceStack,firstHeightMm,widthMm,speedMmS,role='spiral',...options}){
  requireThat(firstHeightMm>0&&widthMm>0&&Number.isFinite(speedMmS),'Spiral joining needs positive bead values and a speed.');
  const bead={firstHeightMm,widthMm,speedMmS,role,...options};
  if(referenceStack.boundary)return {...spiralRun(referenceStack,bead),layerCurves:[]};
  const runs=[];
  for(const layer of referenceStack.layers){const run=runs.at(-1);if(run?.joinable&&joinable(layer))run.layers.push(layer);else runs.push({joinable:joinable(layer),layers:[layer]});}
  const joined=runs.filter(run=>run.joinable&&run.layers.length>=2).reduce((best,run)=>run.layers.length>(best?.layers.length??0)?run:best,null)?.layers??[];
  const separate=referenceStack.layers.filter(layer=>!joined.includes(layer)),whole=joined.length===referenceStack.layers.length;
  // A part of the stack takes the chart's own layer coordinate.
  const spiral=joined.length?spiralRun({...referenceStack,layers:joined,...(whole?{}:{coordinate:undefined})},bead):{profile:null,notes:[]};
  // Collapsed boundaries carry nothing to print.
  const layerCurves=separate.flatMap(layer=>(layer.curves??[]).filter(curve=>curve.points?.length>=(curve.closed?3:2)).map(curve=>({...curve,role,speedMmS,beadWidthMm:widthMm,
    heightMm:layer.heightMm??firstHeightMm,segmentMetadata:curve.points.slice(curve.closed?0:1).map(()=>({layer:layer.index}))})));
  const notes=separate.length?[`Spiral stack: ${layerList(separate.map(layer=>layer.index))} printed plain, not spiral-joined; a spiral joins consecutive layers that each have one closed boundary${joined.length?`, here ${layerList(joined.map(layer=>layer.index))}`:''}.`]:[];
  return {...spiral,layerCurves,notes:[...spiral.notes,...notes]};
}

// Process scale: default sampling step and chord tolerance of a spiral, for a 0.4 mm
// line; widthMm is in scope but the defaults are kept so existing spirals do not move.
function spiralRun(referenceStack,{firstHeightMm,widthMm,speedMmS,levelEnd=true,sampleStepMm=.4,toleranceMm=.02,minimumTurnSeconds=0,role}){
  const n=referenceStack.layers.length,sleeve=referenceStack.boundary?null:boundarySleeve(referenceStack);
  const coordinate=referenceStack.coordinate??{startMm:0,endMm:n-1,pitchMm:1};
  const foundationHeightMm=referenceStack.layers[0].heightMm??firstHeightMm;
  const profile=spiralProfile({...coordinate,firstHeightMm:foundationHeightMm,levelEnd});
  let curve,turns;
  if(referenceStack.boundary){
    const cuts=[0];
    for(let t=0;t<profile.turns-ROUNDING_RELATIVE;){ // turn counts compare within rounding
      const next=Math.min(profile.turns,t<profile.risingTurns-ROUNDING_RELATIVE?profile.risingTurns:Infinity,(Math.floor(t*16+ROUNDING_RELATIVE)+1)/16);
      cuts.push(next);t=next;
    }
    const boundarySample=t=>({...referenceStack.boundary.at(t,spiralHeight(profile,t)),chart:[t,spiralHeight(profile,t)]});
    const samples=sampleCurveIntervals({at:boundarySample,
      cuts,stepMm:sampleStepMm,toleranceMm:toleranceMm/2,chartSteps:[1/16,referenceStack.chartStepMm]});
    curve={points:samples.map(s=>s.point),frameSamples:samples.map(s=>s.frame)};turns=samples.map(s=>s.t);
  }else{
    const points=[[0,0],[1,0],[n,n-1],...(levelEnd?[[n+1,n-1]]:[])];
    curve=sampleAuthoredCurve({role,closed:false,uv:{reference:{kind:'sleeve',assignment:'stack'},points,normalMm:0},sampleStepMm,toleranceMm},{references:{'sleeve:stack':sleeve}});
    turns=curve.frameSamples.map(frame=>frame.point[0]);
    // The bead rests on the cutting stack, not on the radial sleeve chart.
    curve={...curve,frameSamples:curve.frameSamples.map(frame=>{
      const normal=stackNormal(sleeve,frame.point[0],frame.point[1]);
      const u=normalize(frame.u.map((v,k)=>v-dot(frame.u,normal)*normal[k]));
      return {...frame,u,v:cross(normal,u),normal};
    })};
  }
  const bead=spiralBeadCurve({profile,points:curve.points,turns,role,speedMmS,minimumTurnSeconds});
  // A layer gap that reverses (the stack folds back) deposits nothing there.
  const gaps=referenceStack.boundary?bead.heightsMm:curve.points.slice(1).map((point,i)=>{
    const a=curve.frameSamples[i].point,b=curve.frameSamples[i+1].point,u=(a[0]+b[0])/2,v=(a[1]+b[1])/2;
    if(u<=1)return foundationHeightMm;
    const normal=stackNormal(sleeve,u,v),current=evaluateSurface(sleeve,[u,v]).point,previous=evaluateSurface(sleeve,[u,Math.max(0,Math.min(n-1,u-2))]).point;
    return dot(current.map((x,k)=>x-previous[k]),normal);
  });
  const heightsMm=gaps.map(gap=>Math.max(0,gap));
  const segmentMetadata=bead.segmentMetadata.map((metadata,i)=>{
    const mid=(turns[i]+turns[i+1])/2;
    const index=referenceStack.boundary?Math.min(n-1,Math.max(0,Math.floor(mid-1))):Math.min(n-1,Math.max(0,Math.floor((curve.frameSamples[i].point[1]+curve.frameSamples[i+1].point[1])/2)));
    const terminal=levelEnd&&turns[i]>=profile.risingTurns-ROUNDING_RELATIVE;
    return {...metadata,layer:terminal?referenceStack.layers.at(-1).index:referenceStack.layers[index].index,
      ...(referenceStack.boundary?{}:{surfaceNormal:stackNormal(sleeve,mid,(curve.frameSamples[i].point[1]+curve.frameSamples[i+1].point[1])/2),beadHeightMm:heightsMm[i]})};
  });
  const reversed=[...new Set(gaps.flatMap((gap,i)=>gap<-PRINT_RESOLUTION_MM?[segmentMetadata[i].layer]:[]))].sort((a,b)=>a-b);
  const notes=reversed.length?[`Spiral stack: the layer gap reverses at ${layerList(reversed)}; the spiral passes there without depositing.`]:[];
  return {...curve,...bead,frameSamples:curve.frameSamples,heightsMm,beadWidthMm:widthMm,segmentMetadata,profile,notes};
}

// A join rule as read: a mode, transition or toleranceMm SAAM cannot read takes
// its default and is named in ignored. A continuous join connects each gap above
// toleranceMm with a depositing connector, or by default leaves it to the
// composer's travel (travelGaps counts them).
const JOIN_MODES=['separate','ordered','continuous'],JOIN_TRANSITIONS=['travel','deposit'];
export function joinCurveSequence(curves,{mode='separate',toleranceMm=PRINT_RESOLUTION_MM,transition='travel',speedMmS,heightMm}={}){
  const ignored=[...(JOIN_MODES.includes(mode)?[]:['mode']),...(JOIN_TRANSITIONS.includes(transition)?[]:['transition']),...(Number.isFinite(toleranceMm)&&toleranceMm>=0?[]:['toleranceMm'])];
  const rule={mode:JOIN_MODES.includes(mode)?mode:'separate',transition:JOIN_TRANSITIONS.includes(transition)?transition:'travel',toleranceMm:ignored.includes('toleranceMm')?PRINT_RESOLUTION_MM:toleranceMm};
  if(rule.mode!=='continuous')return {curves,continuous:rule.mode==='ordered',ignored,travelGaps:0};
  const output=[];let travelGaps=0;
  for(const curve of curves){
    const previous=output.at(-1);
    if(previous&&distance(previous.points.at(-1),curve.points[0])>rule.toleranceMm){
      if(rule.transition==='deposit')output.push({role:'connector',closed:false,points:[previous.points.at(-1),curve.points[0]],speedMmS:speedMmS??curve.speedMmS,heightMm:heightMm??curve.heightMm});
      else travelGaps++;
    }
    output.push(curve);
  }
  return {curves:output,continuous:true,ignored,travelGaps};
}
