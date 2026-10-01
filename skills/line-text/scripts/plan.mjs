import {textFusion} from './measure.mjs';
import {FONTS,loadFont} from './catalog.mjs';

const requireThat=(condition,message)=>{if(!condition)throw Error(message);};

// A single centerline receives one bead. A local builder may replace this
// planning operation and compiler construction to make another policy.
export const WEIGHTS=Object.freeze({light:.05,regular:.08,bold:.13});

export function planLineText({font,text,heightMm,weight='regular',stemRatio,beadRangeMm,
  clearanceFactor=.5,onInfeasible='reduce',strokeTopology}){
  requireThat(Number.isFinite(heightMm)&&heightMm>0,'Line text needs a positive heightMm.');
  requireThat(Array.isArray(beadRangeMm)&&beadRangeMm.length===2&&beadRangeMm.every(w=>Number.isFinite(w)&&w>0)&&beadRangeMm[1]>=beadRangeMm[0],
    'beadRangeMm must be [thinnest, widest] in mm.');
  requireThat(stemRatio===undefined||Number.isFinite(stemRatio)&&stemRatio>0,'stemRatio must be positive.');
  requireThat(stemRatio!==undefined||weight in WEIGHTS,`weight must be one of ${Object.keys(WEIGHTS).join(', ')} or give stemRatio.`);
  requireThat(typeof strokeTopology==='function','Line text needs Geometry.strokeTopology.');
  const [minimum,maximum]=beadRangeMm,ratio=stemRatio??WEIGHTS[weight],requestedMm=ratio*heightMm;
  const fusion=textFusion(font,text,strokeTopology),limitMm=fusion.ratio*heightMm;
  let beadWidthMm=Math.max(minimum,Math.min(maximum,requestedMm));
  const warnings=[];
  if(requestedMm<minimum)warnings.push(`The thinnest bead (${minimum} mm) is heavier than the ${requestedMm.toFixed(2)} mm stroke this weight asks for at ${heightMm} mm.`);
  if(requestedMm>maximum)warnings.push(`One bead is limited to ${maximum} mm; requested stroke was ${requestedMm.toFixed(2)} mm. Edit this extension locally to construct parallel beads.`);
  let feasible=beadWidthMm*(1+clearanceFactor)<=limitMm+1e-9;
  if(!feasible&&limitMm/(1+clearanceFactor)>=minimum){
    beadWidthMm=Math.min(beadWidthMm,limitMm/(1+clearanceFactor));feasible=true;
    warnings.push(`Reduced the bead to ${beadWidthMm.toFixed(2)} mm to keep the counters of "${fusion.char}" open.`);
  }
  const minHeightMm=Number.isFinite(fusion.ratio)?minimum*(1+clearanceFactor)/fusion.ratio:0;
  if(!feasible){
    const message=`${font.id} cannot hold the thinnest bead (${minimum} mm) at ${heightMm} mm without "${fusion.char}" filling in; use at least ${minHeightMm.toFixed(1)} mm, a thinner bead, or a font with roomier counters.`;
    requireThat(onInfeasible!=='error',message);warnings.push(message);beadWidthMm=minimum;
  }
  return {fontId:font.id,heightMm,weight:stemRatio===undefined?weight:null,stemRatio:ratio,
    requestedStrokeMm:+requestedMm.toFixed(3),strokeWidthMm:+beadWidthMm.toFixed(3),
    beadWidthMm,parallelCount:1,regime:'single-bead',feasible,
    limit:{maxStrokeMm:Number.isFinite(limitMm)?+limitMm.toFixed(3):null,limitingGlyph:fusion.char,minHeightMm:+minHeightMm.toFixed(2)},warnings};
}

export function rankFonts({text,heightMm,intent=[],weight='regular',stemRatio,beadRangeMm,fonts=FONTS.map(f=>f.id),strokeTopology}){
  const words=new Set(intent.map(w=>String(w).toLowerCase())),rows=[];
  for(const id of fonts){
    const entry=FONTS.find(f=>f.id===id),font=loadFont(id);
    if([...text].some(ch=>ch!=='\n'&&!font.glyphs.has(ch)))continue;
    const plan=planLineText({font,text,heightMm,weight,stemRatio,beadRangeMm,strokeTopology});
    const matches=entry.tags.filter(t=>words.has(t));
    rows.push({fontId:id,feasible:plan.feasible,intentMatches:matches,score:matches.length,
      keptWeight:plan.strokeWidthMm/plan.requestedStrokeMm,plan,summary:entry.summary});
  }
  return rows.sort((a,b)=>(b.feasible-a.feasible)||(b.score-a.score)||(Math.abs(1-a.keptWeight)-Math.abs(1-b.keptWeight)));
}

export function depositionEstimate({beadWidthMm,layerMm,planarSpeedMmS,beadLengthMm=null,layers=1}){
  const area=beadWidthMm*layerMm,speed=planarSpeedMmS;
  return {beadAreaMm2:+area.toFixed(4),planarSpeedMmS,effectiveSpeedMmS:+speed.toFixed(2),
    flowAtSpeedMm3S:+(area*speed).toFixed(2),
    ...(beadLengthMm===null?{}:{printMinutes:+(beadLengthMm*layers/speed/60).toFixed(1)})};
}
