import {loftPolygons} from '../../core/geom/loft.mjs';
import {clipLineToRegion} from '../../core/geom/curve-region.mjs';
import {wingDesign,wingSections,wingStation,sectionRoute,foil,wingletThickness} from './design.mjs';
import {aircraftContext} from './aircraft.mjs';

export function wingEnvelope(d,piece,span){
  const s=wingStation(d,piece,span),points=[],n=60;
  const plate=piece.integratedTip&&span>=piece.toMm-wingletThickness(d)-1e-8;
  for(const side of [1,-1])for(let i=0;i<=n;i++){
    const u=side===1?i/n:1-i/n,x=s.lo+(s.hi-s.lo)*(.003+.994*u),f=foil(d,x-s.shift,s.chord);
    if(plate&&side===1){
      const left=s.lo+(s.hi-s.lo)*.003,right=s.hi-(s.hi-s.lo)*.003,front=s.chord*.2025,back=s.chord*.7525;
      const at=u<.2?[left+(front-left)*u/.2,foil(d,left,s.chord).center+d.wingletHeightMm*u/.2]
        :u>.8?[back+(right-back)*(u-.8)/.2,d.wingletHeightMm*(1-(u-.8)/.2)+foil(d,right,s.chord).center*(u-.8)/.2]
        :[front+(back-front)*(u-.2)/.6,d.wingletHeightMm];
      points.push(at);
    }else points.push([x,f.center+side*Math.max(d.beadWidthMm*.55,f.half)]);
  }
  return points;
}

export async function pieceGeometry(d,piece){
  const sense=piece.integratedTip?-1:1,stations=sectionStations(d,piece);
  if(piece.integratedTip)stations.reverse();
  return loftPolygons(stations.map(span=>({z:piece.integratedTip?piece.toMm-span:span-piece.fromMm,points:wingEnvelope(d,piece,span).map(([x,y])=>[x,piece.hand*sense*y])})));
}

function sectionStations(d,piece){
  const height=piece.toMm-piece.fromMm,count=Math.max(1,Math.ceil(height/5)),stations=Array.from({length:count+1},(_,i)=>piece.fromMm+height*i/count);
  if(piece.integratedTip){const inner=piece.toMm-wingletThickness(d);stations.push(inner,inner-.01);}
  return [...new Set(stations)].sort((a,b)=>a-b);
}

export function continuousWingCurve(d,piece){
  const height=piece.toMm-piece.fromMm,points=[],pitch=d.layerMm;let skinSpeed=d.speedMmS;
  const sense=piece.integratedTip?-1:1,spanAt=z=>piece.integratedTip?piece.toMm-z:piece.fromMm+z;
  const append=p=>{const q=points.at(-1);if(!q||Math.hypot(...p.map((v,i)=>v-q[i]))>1e-8)points.push(p);};
  let z=pitch,baseCount;
  if(piece.integratedTip){
    // The flat OUTSIDE winglet face is the bed face. Fill the thin endplate
    // with a connected serpentine, then grow the hollow wing inward from it.
    const polygon=wingEnvelope(d,piece,piece.toMm),ys=polygon.map(p=>p[1]),low=Math.min(...ys)+d.beadWidthMm/2,high=Math.max(...ys)-d.beadWidthMm/2;
    const count=Math.ceil((high-low)/(d.beadWidthMm*.9)),raster=[];
    for(let i=0;i<=count;i++){
      const y=low+(high-low)*i/count,segments=clipLineToRegion([0,y],[1,0],[polygon],{fillRule:'evenodd'}).spans.filter(([a,b])=>b-a>d.beadWidthMm);
      if(segments.length!==1)throw Error('Winglet face must have one connected chord on every fill row.');
      const [a,b]=segments[0],row=[[a+d.beadWidthMm/2,y],[b-d.beadWidthMm/2,y]];
      raster.push(...(i%2?row.reverse():row));
    }
    const layers=Math.round(wingletThickness(d)/pitch);
    for(let layer=1;layer<=layers;layer++){
      const row=layer%2?raster:[...raster].reverse();
      // Ramp across the first chord of the next layer instead of extruding
      // a vertical post at a stationary XY point.
      for(const p of layer===1?row:row.slice(1))append([...p,layer*pitch]);
      if(layer===1)baseCount=points.length;
    }
    z=layers*pitch;
    const first=sectionRoute(d,piece,spanAt(z));
    for(const p of [...first,first[0]])append([...p,z]);
  }else{
    const first=sectionRoute(d,piece,spanAt(pitch));
    for(const p of [...first,first[0]])append([...p,pitch]);
    baseCount=points.length;
  }
  while(z<height-1e-8){
    const next=Math.min(height,z+pitch),a=sectionRoute(d,piece,spanAt(z)),b=sectionRoute(d,piece,spanAt(next));
    if(a.length!==b.length)throw Error('Wing feature correspondence changed inside a print.');
    const distances=[0];
    for(let i=1;i<=a.length;i++){const p=a[i%a.length],q=a[i-1];distances.push(distances.at(-1)+Math.hypot(p[0]-q[0],p[1]-q[1]));}
    const length=distances.at(-1);
    const nextLength=b.reduce((sum,p,i)=>sum+Math.hypot(p[0]-b[(i+1)%b.length][0],p[1]-b[(i+1)%b.length][1]),0);
    skinSpeed=Math.min(skinSpeed,nextLength/6);
    for(let i=1;i<=a.length;i++){
      const k=i%a.length,t=distances[i]/length;
      append([a[k][0]+(b[k][0]-a[k][0])*t,a[k][1]+(b[k][1]-a[k][1])*t,z+(next-z)*t]);
    }
    z=next;
  }
  const final=sectionRoute(d,piece,spanAt(height));
  // A final level circuit leaves a glueable section edge. It shares its
  // endpoint with the rising stroke; there is no inter-course travel.
  for(const p of [...final.slice(1),final[0]])append([...p,height]);
  let lengthMm=0,maxRise=0,maxStep=0;
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],xy=Math.hypot(b[0]-a[0],b[1]-a[1]),dz=b[2]-a[2];
    if(dz< -1e-8)throw Error('Wing path must rise monotonically.');
    lengthMm+=Math.hypot(xy,dz);maxRise=Math.max(maxRise,Math.atan2(dz,xy)*180/Math.PI);maxStep=Math.max(maxStep,Math.hypot(xy,dz));
  }
  const mirrored=points.map(([x,y,z])=>[x,piece.hand*sense*y,z]),skin=mirrored.slice(baseCount-1);
  const common={closed:false,role:'wing-continuous',beadWidthMm:d.beadWidthMm,heightMm:pitch,speedMmS:d.speedMmS};
  return {curves:[{...common,points:mirrored.slice(0,baseCount),courses:[0],speedMmS:Math.min(12,d.speedMmS)},
    {...common,points:skin,courses:[1],speedMmS:skinSpeed}],
    report:{points:points.length,lengthMm,maxRiseDeg:maxRise,maxStepMm:maxStep,continuous:true,minimumTurnSeconds:6,bedFace:piece.integratedTip?'flat outer winglet face':'section joint',wingletThicknessMm:piece.integratedTip?wingletThickness(d):null}};
}

export async function wingHandoff(input,pieceId){
  const d=wingDesign(input),layout=wingSections(d),piece=layout.pieces.find(p=>p.id===pieceId);
  if(!piece)throw Error('Unknown wing section: '+pieceId);
  const geometry=await pieceGeometry(d,piece),{curves,report}=continuousWingCurve(d,piece);
  const process={firstLayerMm:d.layerMm,layerMm:d.layerMm,lineWidthMm:d.beadWidthMm,planarSpeedMmS:d.speedMmS};
  return {id:piece.id,geometry,curves,trace:{repeat:{count:2,translation:[0,0,0]},sequence:true,courseIds:['base','skin']},process,source:{kind:'wing',version:2,design:d,piece,rods:layout.rods,rodEndMm:d.spanMm/2-wingletThickness(d)-4},
    requirements:{orientation:piece.integratedTip?'flat-winglet-face-down':'span-up',continuousExtrusion:true,axes:3,assembly:'glue',geometryRole:'reference envelope; Trace curves define the hollow skin, rod webs and filled winglet'},report};
}

export function wingPreview(input){
  const d=wingDesign(input),layout=wingSections(d);
  const pieces=layout.pieces.map(piece=>{
    const sections=sectionStations(d,piece).map(span=>({span,points:wingEnvelope(d,piece,span)}));
    return {...piece,sections,route:sectionRoute(d,piece,(piece.fromMm+piece.toMm)/2)};
  });
  return {...layout,pieces,rodEndMm:d.spanMm/2-wingletThickness(d)-4,rods:layout.rods.map(r=>({...r,centerMm:foil(d,r.xMm,d.chordMm).center})),context:aircraftContext(d)};
}
