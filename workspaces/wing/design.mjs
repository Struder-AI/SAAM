export const wingDefaults=Object.freeze({schema:'saam-wing/1',name:'Wing study',spanMm:900,chordMm:160,taper:1,camber:0.02,thickness:0.12,tipLengthMm:90,sectionHeightMm:180,flaps:true,flapStart:0.35,flapEnd:0.75,flapChord:0.26,rodDiameterMm:5,pivotDiameterMm:3,clearanceMm:0.2,gapMm:0.8,beadWidthMm:0.45,layerMm:0.25,speedMmS:20});

export function wingDesign(input={}){
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Expected a wing design.');
  for(const key of Object.keys(input))if(!Object.hasOwn(wingDefaults,key))throw Error('Unknown wing setting: '+key);
  const d={...wingDefaults,...input};
  if(d.schema!==wingDefaults.schema||typeof d.name!=='string'||!d.name.trim()||typeof d.flaps!=='boolean')throw Error('Invalid wing identity or flap choice.');
  const ranges={spanMm:[300,2400],chordMm:[100,300],taper:[0.75,1],camber:[0,0.04],thickness:[0.1,0.18],tipLengthMm:[40,200],sectionHeightMm:[40,300],flapStart:[0.1,0.7],flapEnd:[0.3,0.9],flapChord:[0.2,0.32],rodDiameterMm:[2,8],pivotDiameterMm:[2,5],clearanceMm:[0.1,0.5],gapMm:[0.5,2],beadWidthMm:[0.35,0.6],layerMm:[0.15,0.3],speedMmS:[8,40]};
  for(const [key,[min,max]] of Object.entries(ranges))if(!Number.isFinite(d[key])||d[key]<min||d[key]>max)throw Error(`${key} must be between ${min} and ${max}.`);
  if(d.flaps&&(d.flapEnd<=d.flapStart||d.flapEnd*d.spanMm/2>d.spanMm/2-d.tipLengthMm))throw Error('Flaps must end before the integrated tip begins.');
  if(d.tipLengthMm>=d.spanMm/2-d.sectionHeightMm/2)throw Error('Leave room for an inboard wing section before the tip.');
  if(d.layerMm>d.beadWidthMm*.7)throw Error('Layer height must be at most 70% of bead width.');
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
    const start=mandatory[i-1],end=mandatory[i],count=Math.ceil((end-start)/d.sectionHeightMm);
    for(let j=1;j<=count;j++)cuts.push(start+(end-start)*j/count);
  }
  const pieces=[];
  for(const hand of [-1,1])for(let i=1;i<cuts.length;i++){
    const from=cuts[i-1],to=cuts[i],control=d.flaps&&(from+to)/2>half*d.flapStart&&(from+to)/2<half*d.flapEnd;
    const id=`${hand<0?'left':'right'}-${String(i).padStart(2,'0')}`;
    pieces.push({id,kind:'wing',hand,fromMm:from,toMm:to,control,integratedTip:i===cuts.length-1});
    if(control)pieces.push({id:id+'-flap',kind:'flap',hand,fromMm:from+(Math.abs(from-half*d.flapStart)<1e-6?d.gapMm/2:0),toMm:to-(Math.abs(to-half*d.flapEnd)<1e-6?d.gapMm/2:0),control:true,integratedTip:false});
  }
  return {design:d,cuts,pieces,rods:[{id:'front',xMm:d.chordMm*.28,diameterMm:d.rodDiameterMm},{id:'rear',xMm:d.chordMm*.5,diameterMm:d.rodDiameterMm},...(d.flaps?[{id:'pivot',xMm:d.chordMm*(1-d.flapChord)+d.pivotDiameterMm/2+d.clearanceMm+d.beadWidthMm,diameterMm:d.pivotDiameterMm}]:[])]};
}

export function foil(d,x,chord){
  const u=Math.max(0,Math.min(1,x/chord)),p=.4,m=d.camber;
  const center=chord*(u<p?m/(p*p)*(2*p*u-u*u):m/((1-p)**2)*((1-2*p)+2*p*u-u*u));
  const half=5*d.thickness*chord*(.2969*Math.sqrt(u)-.126*u-.3516*u*u+.2843*u**3-.1015*u**4);
  return {center,half};
}

export function wingStation(d,piece,span){
  const half=d.spanMm/2,baseChord=d.chordMm*(1-(1-d.taper)*span/half),tipStart=half-d.tipLengthMm;
  // Close the outer panel as a supported tapered nose. Rod ends stay straight
  // and stop at the beginning of this integral closure, before the bore tapers.
  const t=Math.max(0,(span-tipStart)/d.tipLengthMm),scale=1-.98*t;
  const shift=(baseChord-baseChord*scale)*.38,chord=baseChord*scale;
  const hinge=d.chordMm*(1-d.flapChord),lo=piece.kind==='flap'?hinge+d.gapMm/2:shift;
  const hi=piece.kind==='wing'&&piece.control?hinge-d.gapMm/2:shift+chord;
  const rods=[{id:'front',xMm:d.chordMm*.28,diameterMm:d.rodDiameterMm},{id:'rear',xMm:d.chordMm*.5,diameterMm:d.rodDiameterMm},...(d.flaps?[{id:'pivot',xMm:d.chordMm*(1-d.flapChord)+d.pivotDiameterMm/2+d.clearanceMm+d.beadWidthMm,diameterMm:d.pivotDiameterMm}]:[])].filter(r=>piece.kind==='flap'?r.id==='pivot':r.id!=='pivot'||!piece.control);
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
    const fade=Math.max(0,1-s.tip*4),cx=s.shift+rod.xMm/d.chordMm*s.chord,cy=foil(d,rod.xMm,d.chordMm).center;
    const straightX=rod.xMm,rodX=straightX*fade+cx*(1-fade);
    const r=(rod.diameterMm/2+d.clearanceMm+w/2)*fade,neck=w*.45*fade;
    if(!s.tip&&(rodX-neck<=lo||rodX+neck>=hi))throw Error('Rod lies outside its wing/control section.');
    const top=edge(rodX,1),bottom=edge(rodX,-1);
    if(!s.tip&&(cy-r-w/2<bottom||cy+r+w/2>top))throw Error(`${piece.id}: ${rod.id} rod does not fit; reduce its diameter or increase airfoil thickness.`);
    skin(previous,rodX-neck,1);push(rodX-neck,top);
    const a=Math.acos(-Math.min(.95,neck/Math.max(r,1e-9))),b=2*Math.PI+Math.acos(Math.min(.95,neck/Math.max(r,1e-9)));
    const routeTop=top+(cy+r-top)*fade,center=routeTop-r;
    const n=32;
    for(let j=0;j<=n;j++){const angle=a+(b-a)*j/n;push(rodX+r*Math.cos(angle),center+r*Math.sin(angle));}
    push(rodX+neck,top);previous=rodX+neck;
  }
  skin(previous,hi,1);push(hi,edge(hi,1));skin(hi,lo,-1,80);push(lo,edge(lo,-1));
  return points;
}
