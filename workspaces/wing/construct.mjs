import {loftPolygons} from '../../core/geom/loft.mjs';
import {wingDesign,wingSections,wingStation,sectionRoute,foil} from './design.mjs';
import {aircraftContext} from './aircraft.mjs';

export function wingEnvelope(d,piece,span){
  const s=wingStation(d,piece,span),points=[],n=60;
  for(const side of [1,-1])for(let i=0;i<=n;i++){
    const u=side===1?i/n:1-i/n,x=s.lo+(s.hi-s.lo)*(.003+.994*u),f=foil(d,x-s.shift,s.chord);
    points.push([x,f.center+side*Math.max(d.beadWidthMm*.55,f.half)]);
  }
  return points;
}

export async function pieceGeometry(d,piece){
  return loftPolygons(sectionStations(d,piece).map(span=>({z:span-piece.fromMm,points:wingEnvelope(d,piece,span).map(([x,y])=>[x,piece.hand*y])})));
}

function sectionStations(d,piece){
  const height=piece.toMm-piece.fromMm,count=Math.max(1,Math.ceil(height/5)),stations=Array.from({length:count+1},(_,i)=>piece.fromMm+height*i/count);
  const tipStart=d.spanMm/2-d.tipLengthMm,steps=Math.ceil(Math.PI/2/Math.acos(1-.1/d.chordMm));
  for(let i=0;i<=steps;i++){const span=tipStart+d.tipLengthMm*Math.sin(Math.PI/2*i/steps);if(span>piece.fromMm&&span<piece.toMm)stations.push(span);}
  return [...new Set(stations)].sort((a,b)=>a-b);
}

export function continuousWingCurve(d,piece){
  const height=piece.toMm-piece.fromMm,points=[],pitch=d.layerMm,speedStations=[];
  const append=p=>{const q=points.at(-1);if(!q||Math.hypot(...p.map((v,i)=>v-q[i]))>1e-8)points.push(p);};
  const first=sectionRoute(d,piece,piece.fromMm+pitch);
  for(const p of [...first,first[0]])append([...p,pitch]);
  const baseCount=points.length;
  let z=pitch;
  while(z<height-1e-8){
    const next=Math.min(height,z+pitch),a=sectionRoute(d,piece,piece.fromMm+z),b=sectionRoute(d,piece,piece.fromMm+next);
    if(a.length!==b.length)throw Error('Wing feature correspondence changed inside a print.');
    const distances=[0];
    for(let i=1;i<=a.length;i++){const p=a[i%a.length],q=a[i-1];distances.push(distances.at(-1)+Math.hypot(p[0]-q[0],p[1]-q[1]));}
    const length=distances.at(-1);
    const nextLength=b.reduce((sum,p,i)=>sum+Math.hypot(p[0]-b[(i+1)%b.length][0],p[1]-b[(i+1)%b.length][1]),0);
    speedStations.push({index:points.length-1,speed:Math.min(d.speedMmS,nextLength/6)});
    for(let i=1;i<=a.length;i++){
      const k=i%a.length,t=distances[i]/length;
      append([a[k][0]+(b[k][0]-a[k][0])*t,a[k][1]+(b[k][1]-a[k][1])*t,z+(next-z)*t]);
    }
    z=next;
  }
  const final=sectionRoute(d,piece,piece.toMm);
  speedStations.push({index:points.length-1,speed:speedStations.at(-1).speed});
  // A final level circuit leaves a glueable section edge. It shares its
  // endpoint with the rising stroke; there is no inter-course travel.
  for(const p of [...final.slice(1),final[0]])append([...p,height]);
  let lengthMm=0,maxRise=0,maxStep=0;
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],xy=Math.hypot(b[0]-a[0],b[1]-a[1]),dz=b[2]-a[2];
    if(dz< -1e-8)throw Error('Wing path must rise monotonically.');
    lengthMm+=Math.hypot(xy,dz);maxRise=Math.max(maxRise,Math.atan2(dz,xy)*180/Math.PI);maxStep=Math.max(maxStep,Math.hypot(xy,dz));
  }
  // Opposite wings need opposite handedness when both print outboard-up.
  // Reflect the thickness axis so each can rotate into its assembly position.
  const mirrored=points.map(([x,y,z])=>[x,piece.hand*y,z]),skin=mirrored.slice(baseCount-1),skinDistances=[0];
  // Use Trace's exact source-chord parameterization, avoiding almost-coincident
  // profile/vertex cuts caused by subtracting cumulative whole-path lengths.
  for(let i=1;i<skin.length;i++)skinDistances.push(skinDistances.at(-1)+Math.hypot(...skin[i].map((v,k)=>v-skin[i-1][k])));
  const speeds=speedStations.filter((s,i)=>!i||i===speedStations.length-1||s.speed!==speedStations[i-1].speed||s.speed!==speedStations[i+1].speed).map(s=>[skinDistances[s.index-baseCount+1]/skinDistances.at(-1),s.speed]);speeds.push([1,speeds.at(-1)[1]]);
  const common={closed:false,role:'wing-continuous',beadWidthMm:d.beadWidthMm,heightMm:pitch,speedMmS:d.speedMmS};
  return {curves:[{...common,points:mirrored.slice(0,baseCount),courses:[0],speedMmS:Math.min(12,d.speedMmS)},
    {...common,points:skin,courses:[1],vary:{speedMmS:speeds}}],
    report:{points:points.length,lengthMm,maxRiseDeg:maxRise,maxStepMm:maxStep,continuous:true,minimumTurnSeconds:6}};
}

export async function wingHandoff(input,pieceId){
  const d=wingDesign(input),layout=wingSections(d),piece=layout.pieces.find(p=>p.id===pieceId);
  if(!piece)throw Error('Unknown wing section: '+pieceId);
  const geometry=await pieceGeometry(d,piece),{curves,report}=continuousWingCurve(d,piece);
  const process={firstLayerMm:d.layerMm,layerMm:d.layerMm,lineWidthMm:d.beadWidthMm,planarSpeedMmS:d.speedMmS};
  return {id:piece.id,geometry,curves,trace:{repeat:{count:2,translation:[0,0,0]},sequence:true,courseIds:['base','skin']},process,source:{kind:'wing',version:1,design:d,piece,rods:layout.rods,rodEndMm:d.spanMm/2-d.tipLengthMm},
    requirements:{orientation:'span-up',continuousExtrusion:true,axes:3,assembly:'glue',geometryRole:'reference envelope; Trace curves define the hollow printed skin and rod webs'},report};
}

export function wingPreview(input){
  const d=wingDesign(input),layout=wingSections(d);
  const pieces=layout.pieces.map(piece=>{
    const sections=sectionStations(d,piece).map(span=>({span,points:wingEnvelope(d,piece,span)}));
    return {...piece,sections,route:sectionRoute(d,piece,(piece.fromMm+piece.toMm)/2)};
  });
  return {...layout,pieces,rods:layout.rods.map(r=>({...r,centerMm:foil(d,r.xMm,d.chordMm).center})),context:aircraftContext(d)};
}
