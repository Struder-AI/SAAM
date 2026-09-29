// Deposition geometry contains no travel. The composer connects these strokes.
import {distance,requireThat} from '../geom/tolerance.mjs';

// Curves enter in world coordinates. Mapping and ordering belong to earlier
// stages; bead calculation preserves roles, closure, orientation and metadata.
// A constant normal gap keeps the uniform-area representation. Variable gaps
// contain one height per segment, including the implicit closing segment.
export function depositCurves(curves,{widthMm,heightMm,speedMmS,flowMultiplier=1}) {
  return curves.map(curve=>{
    const {heightMm:localHeight,heightsMm,widthsMm,flowMultiplier:localFlow,...stroke}=curve;
    const width=curve.beadWidthMm??widthMm,height=localHeight??heightMm,flow=localFlow??flowMultiplier;
    const speed=curve.speedMmS??speedMmS;
    requireThat(Number.isFinite(width)&&width>0&&Number.isFinite(flow)&&flow>0&&Number.isFinite(speed)&&speed>0,
      'Curve deposition needs positive bead width, flow and speed.');
    requireThat(curve.points.length>=2&&curve.points.every(p=>p.length===3&&p.every(Number.isFinite)),
      'Curve deposition needs at least two finite XYZ points.');
    if(heightsMm||widthsMm){
      const points=curve.closed?[...curve.points,curve.points[0]]:curve.points;
      if(widthsMm)requireThat(widthsMm.length===points.length-1&&widthsMm.every(w=>Number.isFinite(w)&&w>=0),'Curve deposition needs one finite nonnegative width per segment.');
      const segmentMetadata=widthsMm?widthsMm.map((beadWidthMm,i)=>({...curve.segmentMetadata?.[i],beadWidthMm})):curve.segmentMetadata;
      const deposited=depositionStroke({points,heightsMm:heightsMm??points.slice(1).map(()=>height),widthMm:width*flow,
        widthsMm:widthsMm?.map(w=>w*flow),speedMmS:speed,role:curve.role,segmentMetadata});
      return {...stroke,points:deposited.points,closed:false,beadWidthMm:width,speedMmS:speed,volumesMm3:deposited.volumesMm3,
        ...(segmentMetadata?{segmentMetadata}:{}),
        ...(curve.closed&&curve.poses?{poses:[...curve.poses,curve.poses[0]]}:{})};
    }
    requireThat(Number.isFinite(height)&&height>0,'Curve deposition needs a positive normal bead height.');
    return {...stroke,beadWidthMm:width,speedMmS:speed,beadAreaMm2:width*height*flow};
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

// A bead that tapers to nothing ends where its remaining material is no longer
// writable: a machine program can only express those last moves as travel.
// Return shortened arrays while preserving the producer's stroke.
export function trimVanishingEnd(stroke,minimumMm3=1e-3) {
  let tail=0,keep=stroke.volumesMm3.length;
  while(keep>1&&tail+stroke.volumesMm3[keep-1]<minimumMm3)tail+=stroke.volumesMm3[--keep];
  return {...stroke,points:stroke.points.slice(0,keep+1),volumesMm3:stroke.volumesMm3.slice(0,keep),
    ...(stroke.segmentMetadata?{segmentMetadata:stroke.segmentMetadata.slice(0,keep)}:{})};
}

export function maximumPathAngle(points) {
  return points.slice(1).reduce((best,p,i)=>Math.max(best,
    Math.atan2(Math.abs(p[2]-points[i][2]),Math.hypot(p[0]-points[i][0],p[1]-points[i][1]))*180/Math.PI),0);
}
