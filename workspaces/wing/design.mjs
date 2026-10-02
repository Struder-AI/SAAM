import {airfoilProfile,airfoilSection} from './airfoils.mjs';

export const wingDefaults=Object.freeze({schema:'saam-wing/1',name:'Wing study',spanMm:900,chordMm:160,taper:1,sweepDeg:0,airfoil:'naca2412',camber:0.02,thickness:0.12,wingletHeightMm:90,maxSectionHeightMm:180,maxChordMm:250,flaps:true,flapStart:0.35,flapEnd:0.75,flapChord:0.26,rodDiameterMm:5,pivotDiameterMm:3,clearanceMm:0.2,gapMm:0.8,beadWidthMm:0.45,layerMm:0.25,speedMmS:20});

export function wingDesign(input={}){
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Expected a wing design.');
  // Read earlier saved designs; new designs persist the explicit limit.
  const {sectionHeightMm,...values}=input;
  if(sectionHeightMm!==undefined&&values.maxSectionHeightMm!==undefined&&sectionHeightMm!==values.maxSectionHeightMm)throw Error('Conflicting section height limits.');
  for(const key of Object.keys(values))if(!Object.hasOwn(wingDefaults,key))throw Error('Unknown wing setting: '+key);
  const d={...wingDefaults,...(sectionHeightMm===undefined?{}:{maxSectionHeightMm:sectionHeightMm}),...values};
  if(d.schema!==wingDefaults.schema||typeof d.name!=='string'||!d.name.trim()||typeof d.flaps!=='boolean')throw Error('Invalid wing identity or flap choice.');
  airfoilProfile(d.airfoil);
  const ranges={spanMm:[300,2400],chordMm:[100,300],taper:[0.75,1],sweepDeg:[0,25],camber:[0,0.1],thickness:[0.08,0.2],wingletHeightMm:[40,200],maxSectionHeightMm:[40,300],maxChordMm:[100,300],flapStart:[0.1,0.7],flapEnd:[0.3,0.9],flapChord:[0.2,0.32],rodDiameterMm:[2,8],pivotDiameterMm:[2,5],clearanceMm:[0.1,0.5],gapMm:[0.5,2],beadWidthMm:[0.35,0.6],layerMm:[0.15,0.3],speedMmS:[8,40]};
  for(const [key,[min,max]] of Object.entries(ranges))if(!Number.isFinite(d[key])||d[key]<min||d[key]>max)throw Error(`${key} must be between ${min} and ${max}.`);
  if(d.flaps&&d.flapEnd<=d.flapStart)throw Error('Flaps must end after they start.');
  if(d.layerMm>d.beadWidthMm*.7)throw Error('Layer height must be at most 70% of bead width.');
  if(d.chordMm>d.maxChordMm)throw Error(`Root chord exceeds the explicit ${d.maxChordMm} mm chord limit. Reduce the chord or increase the limit.`);
  return d;
}

// Span is the print Z axis. Mandatory stations remain exact; intermediate
// divisions distribute each interval evenly, avoiding a tiny last fragment.
export function wingSections(input){
  const d=wingDesign(input),half=d.spanMm/2,mandatory=[0,half];
  if(d.flaps)mandatory.push(d.flapStart*half,d.flapEnd*half);
  mandatory.sort((a,b)=>a-b);
  const cuts=[0];
  for(let i=1;i<mandatory.length;i++){
    const start=mandatory[i-1],end=mandatory[i],count=Math.ceil((end-start)/d.maxSectionHeightMm);
    for(let j=1;j<=count;j++)cuts.push(start+(end-start)*j/count);
  }
  const pieces=[];
  for(const hand of [-1,1])for(let i=1;i<cuts.length;i++){
    const from=cuts[i-1],to=cuts[i],control=d.flaps&&(from+to)/2>half*d.flapStart&&(from+to)/2<half*d.flapEnd;
    const id=`${hand<0?'left':'right'}-${String(i).padStart(2,'0')}`;
    pieces.push({id,kind:'wing',hand,fromMm:from,toMm:to,control,integratedTip:i===cuts.length-1});
    if(control)pieces.push({id:id+'-flap',kind:'flap',hand,fromMm:from+(Math.abs(from-half*d.flapStart)<1e-6?d.gapMm/2:0),toMm:to-(Math.abs(to-half*d.flapEnd)<1e-6?d.gapMm/2:0),control:true,integratedTip:false});
  }
  const rodEndMm=half-wingletThickness(d)-4;
  return {design:d,cuts,pieces,rods:[{id:'front',xMm:d.chordMm*.28,diameterMm:d.rodDiameterMm,fromMm:0,toMm:rodEndMm},{id:'rear',xMm:d.chordMm*.5,diameterMm:d.rodDiameterMm,fromMm:0,toMm:rodEndMm},...(d.flaps?[{id:'pivot',xMm:d.chordMm*(1-d.flapChord)+d.pivotDiameterMm/2+d.clearanceMm+d.beadWidthMm,diameterMm:d.pivotDiameterMm,fromMm:half*d.flapStart+d.gapMm/2,toMm:half*d.flapEnd-d.gapMm/2}]:[])]};
}

export function foil(d,x,chord){
  const {center,half}=airfoilSection(d.airfoil,x/chord,d.thickness,d.camber);
  return {center:center*chord,half:half*chord};
}

export const wingletThickness=d=>2*Math.ceil(2/(2*d.layerMm))*d.layerMm;
export const sweepOffsetMm=(d,span)=>Math.tan(d.sweepDeg*Math.PI/180)*span;

export function wingStation(d,piece,span){
  const half=d.spanMm/2,chord=d.chordMm*(1-(1-d.taper)*span/half),sweep=sweepOffsetMm(d,span);
  // Quarter-chord sweep leaves every reinforcement bore on one straight axis.
  const shift=sweep+(d.chordMm-chord)/4;
  const t=Math.max(0,1-(half-span-wingletThickness(d))/4);
  const hinge=sweep+d.chordMm*(1-d.flapChord),lo=piece.kind==='flap'?hinge+d.gapMm/2:shift;
  const hi=piece.kind==='wing'&&piece.control?hinge-d.gapMm/2:shift+chord;
  const rods=[{id:'front',xMm:d.chordMm*.28+sweep,diameterMm:d.rodDiameterMm},{id:'rear',xMm:d.chordMm*.5+sweep,diameterMm:d.rodDiameterMm},...(d.flaps?[{id:'pivot',xMm:d.chordMm*(1-d.flapChord)+d.pivotDiameterMm/2+d.clearanceMm+d.beadWidthMm+sweep,diameterMm:d.pivotDiameterMm}]:[])].filter(r=>piece.kind==='flap'?r.id==='pivot':r.id!=='pivot');
  return {lo,hi,chord,shift,tip:t,rods};
}

// Correspondence is by authored feature: skin sample, web side, bore arc.
// It does not search for a new seam or fit away a narrow internal excursion.
export function sectionRoute(d,piece,span,{webs=true}={}){
  const s=wingStation(d,piece,span),w=d.beadWidthMm;
  const edge=(x,side)=>{const f=foil(d,x-s.shift,s.chord);return f.center+side*Math.max(w*.35,f.half-w/2);};
  const lo=s.lo+w/2,hi=s.hi-w/2;
  if(hi-lo<w)throw Error('The tip or control chord is too small for the selected bead.');
  const points=[],push=(x,y)=>points.push([x,y]);
  const skin=(a,b,side,count=24)=>{for(let j=0;j<count;j++){const x=a+(b-a)*j/count;push(x,edge(x,side));}};
  let previous=lo;
  for(const rod of webs?s.rods:[]){
    const fade=Math.max(0,1-s.tip),cy=foil(d,rod.xMm-sweepOffsetMm(d,span),d.chordMm).center,rodX=rod.xMm;
    const r=(rod.diameterMm/2+d.clearanceMm+w/2)*fade,rx=r/Math.cos(d.sweepDeg*Math.PI/180),neck=w*.45*fade;
    if(!s.tip&&(rodX-neck<=lo||rodX+neck>=hi))throw Error('Rod lies outside its wing/control section.');
    const top=edge(rodX,1),bottom=edge(rodX,-1);
    if(!s.tip&&(cy-r-w/2<bottom||cy+r+w/2>top))throw Error(`${piece.id}: ${rod.id} rod does not fit; reduce its diameter or increase airfoil thickness.`);
    skin(previous,rodX-neck,1);push(rodX-neck,top);
    // A horizontal slice of a cylindrical passage on a swept rod is elliptical.
    // The long radius is in the chord direction, normal to the rod's slanted axis.
    const a=Math.acos(-Math.min(.95,neck/Math.max(rx,1e-9))),b=2*Math.PI+Math.acos(Math.min(.95,neck/Math.max(rx,1e-9)));
    const routeTop=top+(cy+r-top)*fade,center=routeTop-r;
    const n=32;
    for(let j=0;j<=n;j++){const angle=a+(b-a)*j/n;push(rodX+rx*Math.cos(angle),center+r*Math.sin(angle));}
    push(rodX+neck,top);previous=rodX+neck;
  }
  skin(previous,hi,1);push(hi,edge(hi,1));skin(hi,lo,-1,80);push(lo,edge(lo,-1));
  return points;
}
