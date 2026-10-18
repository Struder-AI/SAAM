// Resolve a declared terminal boundary from prepared work, before deposition.
import {requireThat,distance} from '../private/toolpath/numeric.mjs';
import {PRINT_RESOLUTION_MM} from '../dimensions.mjs';
import {cleanPlanarLoop} from '../geom/polyline.mjs';
import {loopArea} from '../region/region2d.mjs';
import {horizontalSlice} from '../geom/slice.mjs';
import {section} from '../region/section.mjs';
import {sampleAuthoredCurve} from '../path/authored-curves.mjs';
import {evaluateSurface} from '../geom/surface-evaluation.mjs';

export function terminalBoundaryReference({assignment,source,references={}}){
  const authored=source?.owner?.assignment??source?.assignment;
  requireThat(authored?.id===assignment.surface.assignment&&(source.owner?.part??authored.part)===assignment.part,'A terminal reference needs prepared work on the same part.');
  if(source.spec){
    const layer=source.spec.layers.at(-1);
    requireThat(layer?.slice&&layer.region?.length,'The prepared source has no terminal material region.');
    return {...levelBoundary(layer.region.map(loop=>loop.map(uv=>evaluateSurface(layer.slice,uv).point)),true),prerequisites:[{assignment:authored.id,part:assignment.part,index:layer.index}]};
  }
  if(authored.construction==='curves'){
    requireThat(!authored.source||source.preparedCurves,'Trace source geometry must be prepared before selecting its terminal boundary.');
    const indices=authored.repeat?.stack?(authored.repeat.indices??references['slice:'+authored.repeat.stack]?.layers.map(layer=>layer.index)):null;
    const count=indices?.length??authored.repeat?.count??1,repetition=indices?.at(-1)??count-1,offset=(authored.repeat?.translation??[0,0,0]).map(v=>v*(count-1));
    const active=(source.preparedCurves??authored.curves).map((curve,index)=>({curve,index})).filter(({curve})=>!curve.repetitions||curve.repetitions.includes(repetition));
    const curves=active.map(({curve})=>sampleAuthoredCurve(curve,{references,repetition,offset,sampleStepMm:.2}));
    const top=Math.max(...curves.flatMap(curve=>curve.points.map(p=>p[2])));
    const closed=curves.filter(curve=>curve.points.every(p=>Math.abs(p[2]-top)<=PRINT_RESOLUTION_MM)&&distance(curve.points[0],curve.points.at(-1))<=PRINT_RESOLUTION_MM);
    requireThat(closed.length,'The prepared Trace has no closed level terminal curve; author one explicitly.');
    const prerequisites=authored.source?[{assignment:authored.id,part:assignment.part}]:closed.map(curve=>{
      const selected=active[curves.indexOf(curve)];
      return {assignment:authored.id,part:assignment.part,repetition:authored.repetitionIds?.[count-1]??count-1,edge:{curve:selected.curve.id??selected.index}};
    });
    return {...levelBoundary(closed.map(curve=>curve.points)),prerequisites};
  }
  requireThat(authored.endTransition==='level','The prepared source has no level ending; supply a level boundary.');
  const z=source.geometry?.end??source.endMm,shell=source.shell;
  requireThat(shell&&Number.isFinite(z),'The prepared source needs terminal geometry and height.');
  const boundary=section(shell,horizontalSlice(z),{minFeatureMm:assignment.surface.minFeatureMm,side:'negative'}).loops.filter(loop=>loopArea(loop)>0);
  requireThat(boundary.length,'Prepared terminal geometry has no outer contour.');
  return {boundary,zStartMm:z,prerequisites:[{assignment:authored.id,part:assignment.part}]};
}
function levelBoundary(curves,preserveOrientation=false){
  const points=curves.flat(),z=Math.max(...points.map(p=>p[2]));
  requireThat(points.length&&points.every(p=>Math.abs(p[2]-z)<=PRINT_RESOLUTION_MM),'A terminal reference needs a closed level boundary in prepared geometry.');
  const boundary=curves.map(curve=>cleanPlanarLoop(curve.map(p=>p.slice(0,2)),PRINT_RESOLUTION_MM)).map(loop=>preserveOrientation||loopArea(loop)>0?loop:loop.toReversed());
  return {boundary,zStartMm:z};
}
