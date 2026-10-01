import {distance,requireThat} from '../private/toolpath/numeric.mjs';
// Deposition geometry contains no travel. The composer connects these strokes.


// Curves enter in world coordinates. Mapping and ordering belong to earlier
// stages; bead calculation preserves roles, closure, orientation and metadata.
// A constant normal gap keeps the uniform-area representation. Variable gaps
// contain one height per segment, including the implicit closing segment.
export function depositCurves(curves,{widthMm,heightMm,speedMmS,flowMultiplier=1}) {
  return curves.map(curve=>{
    const {heightMm:localHeight,heightsMm,widthsMm,flowMultipliers,flowMultiplier:localFlow,...stroke}=curve;
    const width=curve.beadWidthMm??widthMm,height=localHeight??heightMm,flow=localFlow??flowMultiplier;
    const speed=curve.speedMmS??speedMmS;
    requireThat(Number.isFinite(width)&&width>0&&Number.isFinite(flow)&&flow>0&&Number.isFinite(speed)&&speed>0,
      'Curve deposition needs positive bead width, flow and speed.');
    requireThat(curve.points.length>=2&&curve.points.every(p=>p.length===3&&p.every(Number.isFinite)),
      'Curve deposition needs at least two finite XYZ points.');
    if(heightsMm||widthsMm||flowMultipliers){
      const explicit=strokeRange(stroke),points=explicit.points;
      if(flowMultipliers)requireThat(flowMultipliers.length===points.length-1&&flowMultipliers.every(f=>Number.isFinite(f)&&f>0),'Curve flow needs one positive multiplier per segment.');
      if(widthsMm)requireThat(widthsMm.length===points.length-1&&widthsMm.every(w=>Number.isFinite(w)&&w>=0),'Curve deposition needs one finite nonnegative width per segment.');
      const segmentMetadata=points.slice(1).map((_,i)=>({...curve.segmentMetadata?.[i],...(widthsMm?{beadWidthMm:widthsMm[i]}:{}),beadHeightMm:(heightsMm?.[i]??height)*flow*(flowMultipliers?.[i]??1)}));
      const deposited=depositionStroke({points,heightsMm:heightsMm??points.slice(1).map(()=>height),widthMm:width*flow,
        widthsMm:flowMultipliers?flowMultipliers.map((f,i)=>(widthsMm?.[i]??width)*flow*f):widthsMm?.map(w=>w*flow),speedMmS:speed,role:curve.role,segmentMetadata});
      return {...explicit,beadWidthMm:width,speedMmS:speed,volumesMm3:deposited.volumesMm3,segmentMetadata};
    }
    requireThat(Number.isFinite(height)&&height>0,'Curve deposition needs a positive normal bead height.');
    return {...stroke,beadWidthMm:width,beadHeightMm:height*flow,speedMmS:speed,beadAreaMm2:width*height*flow};
  });
}

export function depositionStroke({points,heightsMm,widthMm,widthsMm,speedMmS,role,segmentMetadata}) {
  requireThat(points.length>=2&&heightsMm.length===points.length-1,'Deposition needs one bead height per segment.');
  requireThat(widthsMm===undefined||widthsMm.length===points.length-1,'Deposition needs one bead width per segment.');
  const volumesMm3=points.slice(1).map((p,i)=>{
    const height=heightsMm[i];
    requireThat(Number.isFinite(height)&&height>=0,'Deposition bead height must be finite and nonnegative.');
    const width=widthsMm?.[i]??widthMm;
    requireThat(Number.isFinite(width)&&width>=0,'Deposition bead width must be finite and nonnegative.');
    return distance(points[i],p)*width*height;
  });
  return {role,closed:false,points,volumesMm3,speedMmS,...(segmentMetadata?{segmentMetadata}:{})};
}

// Inclusive source indices keep complete edges and their aligned channels together.
// Closed ranges wrap through the seam; the default materializes one full circuit.
// Descending indices reverse edges without changing their deposited material.
// An unrotated circuit retains its seam sample (native t=1 when implicit);
// rotated circuits retain the parameters of their original source vertices.
export function strokeRange(stroke,from=0,to){
  const count=stroke.points.length-(stroke.closed&&distance(stroke.points[0],stroke.points.at(-1))<1e-12?1:0);
  if(stroke.closed&&to===undefined)from%=count;
  to??=stroke.closed?from+count:count-1;
  requireThat(Number.isInteger(from)&&Number.isInteger(to)&&from>=0&&to>=0&&from!==to&&
    (stroke.closed?Math.max(from,to)<2*count&&Math.abs(to-from)<=count:Math.max(from,to)<count),'A stroke range needs existing complete edges.');
  const indices=Array.from({length:Math.abs(to-from)+1},(_,i)=>from+i*Math.sign(to-from));
  const edges=indices.slice(1).map((to,i)=>Math.min(to,indices[i])%count);
  const result={...stroke,...(stroke.closed?{closed:false}:{})};
  for(const key of ['points','poses','normals','frameSamples','curveParameters','chartPoints','referenceAlong'])if(stroke[key]){
    const values=stroke[key],selected=indices.map(i=>
      stroke.closed&&Math.min(from,to)===0&&Math.max(from,to)===count&&i===count?values[count]??(key==='curveParameters'?1:values[0]):values[stroke.closed?i%count:i]);
    result[key]=ArrayBuffer.isView(values)?values.constructor.from(selected):selected;
  }
  for(const key of ['volumesMm3','segmentMetadata','heightsMm','widthsMm','flowMultipliers'])if(stroke[key]){
    const values=stroke[key],selected=edges.map(i=>values[i]);
    result[key]=ArrayBuffer.isView(values)?values.constructor.from(selected):selected;
  }
  return result;
}

// A bead that tapers to nothing ends where its remaining material is no longer
// writable: a machine program can only express those last moves as travel.
// Return shortened arrays while preserving the producer's stroke.
export function trimVanishingEnd(stroke,minimumMm3=1e-3) {
  let tail=0,keep=stroke.volumesMm3.length;
  while(keep>1&&tail+stroke.volumesMm3[keep-1]<minimumMm3)tail+=stroke.volumesMm3[--keep];
  return strokeRange(stroke,0,keep);
}

export function maximumPathAngle(points) {
  return points.slice(1).reduce((best,p,i)=>Math.max(best,
    Math.atan2(Math.abs(p[2]-points[i][2]),Math.hypot(p[0]-points[i][0],p[1]-points[i][1]))*180/Math.PI),0);
}
