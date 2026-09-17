// Start/end courses are built in the regular reference strip, before flow
// mapping. The caps retain the selected motif's advance and transverse shape.
import {requireThat} from '../../../core/geom/tolerance.mjs';

export function* patternCourses(pattern,{level=false,spanMm,firstHeightMm,referenceLengthMm}){
  const rise=pattern.advance[1],count=pattern.repeats;
  const paths=pattern.paths.map(path=>({
    vertices:path.points.map((p,i)=>[...p,Array.isArray(path.offsetMm)?path.offsetMm[i]:path.offsetMm??0]),
    heights:Array.isArray(path.beadHeightMm)?path.beadHeightMm:path.points.map(()=>path.beadHeightMm)
  }));
  if(!level){
    for(let repeat=0;repeat<count;repeat++)yield {repeat,paths:paths.map(p=>({heights:p.heights,
      vertices:p.vertices.map(([u,z,d])=>[u+repeat*pattern.advance[0],z+repeat*rise,d])}))};
    return;
  }
  requireThat([spanMm,firstHeightMm,referenceLengthMm].every(v=>Number.isFinite(v)&&v>0),
    'Level motif courses require a positive sleeve span, first bead height and reference perimeter.');
  let length=0;
  for(const path of paths){
    path.progress=[length];
    for(let i=1;i<path.vertices.length;i++){
      const a=path.vertices[i-1],b=path.vertices[i];
      length+=Math.hypot((b[0]-a[0])*referenceLengthMm,b[1]-a[1],b[2]-a[2]);path.progress.push(length);
    }
    for(const [,z] of path.vertices)requireThat(z>=-1e-9&&z+(count-1)*rise<=spanMm+1e-9,
      'Level motif courses exceed the selected sleeve height interval; adjust course count, rise or motif tilt. No course was trimmed.');
  }
  const height=(repeat,z,t)=>{
    if(repeat<0)return 0;
    if(repeat>=count)return spanMm;
    if(count===1)return spanMm*t;
    const raw=z+repeat*rise;
    if(repeat===0)return raw*t;
    if(repeat===count-1)return raw+(spanMm-raw)*t;
    return raw;
  };
  for(let repeat=-1;repeat<=count;repeat++)yield {repeat,paths:paths.map(path=>{
    const heights=[];
    const vertices=path.vertices.map(([u,z,d],i)=>{
      const t=path.progress[i]/length,current=height(repeat,z,t);
      const gap=repeat<0?firstHeightMm:current-height(repeat-1,z,t);
      requireThat(gap>=-1e-9,'Level motif transition reverses the nominal course stack; revise the motif heights.');
      heights.push(path.heights[i]*Math.max(0,gap)/rise);
      return [u+repeat*pattern.advance[0],current,d];
    });
    return {vertices,heights};
  })};
}
