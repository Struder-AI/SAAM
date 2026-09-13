// Deposition geometry contains no travel. The composer connects these strokes.
import {distance,requireThat} from '../geom/tolerance.mjs';

export function depositionStroke({points,heightsMm,widthMm,speedMmS,role,segmentMetadata}) {
  requireThat(points.length>=2&&heightsMm.length===points.length-1,'Deposition needs one bead height per segment.');
  const volumesMm3=points.slice(1).map((p,i)=>{
    const height=heightsMm[i];
    requireThat(Number.isFinite(height)&&height>=0,'Deposition bead height must be finite and nonnegative.');
    return distance(points[i],p)*widthMm*height;
  });
  return {role,closed:false,points,volumesMm3,speedMmS,...(segmentMetadata?{segmentMetadata}:{})};
}

export function maximumPathAngle(points) {
  return points.slice(1).reduce((best,p,i)=>Math.max(best,
    Math.atan2(Math.abs(p[2]-points[i][2]),Math.hypot(p[0]-points[i][0],p[1]-points[i][1]))*180/Math.PI),0);
}
