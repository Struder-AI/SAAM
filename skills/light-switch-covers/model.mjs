import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {normalizeDesign,fitLayout,overlaps,requireCover} from './design.mjs';

// Feature dimensions remain here; Geometry owns curved profiles and conversion.
const TOLERANCE_MM=.03,OVERLAP_MM=.05;
function extrusion(loop,bottom,height){return {operation:'loft',rings:[loop.map(p=>[...p,bottom]),loop.map(p=>[...p,bottom+height])]};}
function box(w,h,height,x,y,bottom){return {operation:'translate',offset:[x-w/2,y-h/2,bottom],geometry:{operation:'box',size:[w,h,height]}};}
function subtract(body,cutter){return {operation:'difference',operands:[body,cutter]};}
function combine(body,addition){return {operation:'union',operands:[body,addition]};}
function asMesh(mesh){return {shape:'mesh',source:null,vertices:mesh.vertices,triangles:mesh.triangles};}
function xyBounds(bounds,down,height){return [bounds.min[0],down?height-bounds.max[1]:bounds.min[1],bounds.max[0],down?height-bounds.min[1]:bounds.max[1]];}
async function savedFont(){
  const bytes=await readFile(new URL('./fonts/Abel-Regular.ttf',import.meta.url));
  return {data:bytes.toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex'),postscriptName:null};
}
function plateConstruction(d,slots,Geometry){
  const cylinder=(height,radius,x,y,bottom)=>Geometry.revolvedProfile({positionMm:[x,y,bottom],axis:[0,0,1],profile:[[0,radius],[height,radius]]});
  const work={body:Geometry.loftProfiles({profiles:[0,d.thickness].map(z=>Geometry.roundedRectangleProfile({widthMm:d.width,heightMm:d.height,radiusMm:d.cornerRadius,centerMm:[d.width/2,d.height/2,z]})),centers:[[d.width/2,d.height/2,0],[d.width/2,d.height/2,d.thickness]]})};
  if(d.rearPocketDepth){
    const pocket={body:box(d.width-2*d.rimWidth,d.height-2*d.rimWidth,d.rearPocketDepth+OVERLAP_MM,d.width/2,d.height/2,-OVERLAP_MM)};
    for(const s of slots)for(const y of [s.y-s.screwPitch/2,s.y+s.screwPitch/2])pocket.body=subtract(pocket.body,cylinder(d.rearPocketDepth+2*OVERLAP_MM,d.screwHeadDiameter/2+1.5,s.x,y,-OVERLAP_MM));
    work.body=subtract(work.body,pocket.body);
  }
  for(const s of slots){
    if(s.kind!=='blank')work.body=subtract(work.body,box(s.width,s.height,d.thickness+2*OVERLAP_MM,s.x,s.y,-OVERLAP_MM));
    for(const y of [s.y-s.screwPitch/2,s.y+s.screwPitch/2]){
      const profile=[[0,d.screwDiameter/2]];
      if(d.countersinkDepth)profile.push([d.thickness-d.countersinkDepth+OVERLAP_MM,d.screwDiameter/2],[d.thickness+2*OVERLAP_MM,d.screwHeadDiameter/2]);
      else profile.push([d.thickness+2*OVERLAP_MM,d.screwDiameter/2]);
      work.body=subtract(work.body,Geometry.revolvedProfile({positionMm:[s.x,y,-OVERLAP_MM],axis:[0,0,1],profile}));
    }
  }
  for(const m of d.decoration){
    const bottom=m.mode==='raised'?d.thickness-OVERLAP_MM:d.thickness-m.depth;
    const loop=m.shape==='diamond'?[[m.x,m.y-m.size/2],[m.x+m.size/2,m.y],[m.x,m.y+m.size/2],[m.x-m.size/2,m.y]]:[[m.x-m.size/2,m.y-.4],[m.x+m.size/2,m.y-.4],[m.x+m.size/2,m.y+.4],[m.x-m.size/2,m.y+.4]];
    const motif=m.shape==='circle'?cylinder(m.depth+2*OVERLAP_MM,m.size/2,m.x,m.y,bottom):extrusion(loop,bottom,m.depth+2*OVERLAP_MM);
    if(m.mode==='raised')work.body=combine(work.body,motif);else work.body=subtract(work.body,motif);
  }
  return work.body;
}
export async function buildCover(input,{Geometry,Extensions}){
  const d=normalizeDesign(input),{slots,protectedRects}=fitLayout(d),down=d.faceOrientation==='down';
  const faceOffset=down?Math.max(0,...d.decoration.filter(m=>m.mode==='raised').map(m=>m.depth+OVERLAP_MM)):0;
  const [plate]=await Geometry.constructGeometry([plateConstruction(d,slots,Geometry)],{toleranceMm:TOLERANCE_MM});
  requireCover(!plate.empty,'Cover construction leaves no material.');
  const base=down?Geometry.transformGeometry(plate.geometry,{translationMm:[0,d.height,d.thickness+faceOffset],rotation:[[1,0,0],[0,-1,0],[0,0,-1]]}):plate.geometry;
  const font=await savedFont(),features=[],labelBounds=[],notes=[...plate.notes];
  for(const [i,s] of slots.entries())if(s.label.trim()){
    const inset=['recessed','two-color-flush'].includes(d.treatment);
    const feature={id:`label-${i+1}`,text:s.label,font,mode:'raised',sizeMm:d.labelSize,lineHeightMm:d.labelSize*1.2,align:'center',outlineOffsetMm:.12,depthMm:d.reliefDepth,offsetMm:inset?-d.reliefDepth:0,overlapMm:inset?0:.1,positionMm:[s.x,s.labelPosition==='top'?d.height-23:15],reference:{kind:'plane',origin:down?[0,d.height,faceOffset]:[0,0,d.thickness],xAxis:[1,0,0],yAxis:down?[0,-1,0]:[0,1,0]}};
    const compiled=await Extensions.text.compileText(null,[feature],{...Geometry,standalone:true,toleranceMm:TOLERANCE_MM,maxEdgeMm:2});
    requireCover(!Geometry.buildGeometry(compiled.geometry).empty,`Label ${i+1} leaves no printable material.`);
    const bounds=xyBounds(Geometry.buildGeometry(compiled.geometry).bounds,down,d.height);
    requireCover(bounds[0]>=3&&bounds[1]>=3&&bounds[2]<=d.width-3&&bounds[3]<=d.height-3,`Label ${i+1} does not fit. Shorten it, use a smaller size or enlarge the plate.`);
    requireCover(!protectedRects.some(r=>overlaps(bounds,r,2)),`Label ${i+1} overlaps an opening or screw. Change its placement or size.`);
    requireCover(!labelBounds.some(r=>overlaps(bounds,r,1)),'Labels overlap. Reduce text size or shorten labels.');
    labelBounds.push(bounds);features.push(compiled.geometry);notes.push(...compiled.notes);
  }
  for(const m of d.decoration){
    const bounds=m.shape==='stripe'?[m.x-m.size/2,m.y-.4,m.x+m.size/2,m.y+.4]:[m.x-m.size/2,m.y-m.size/2,m.x+m.size/2,m.y+m.size/2];
    requireCover(bounds[0]>=3&&bounds[1]>=3&&bounds[2]<=d.width-3&&bounds[3]<=d.height-3,'Motif crosses a plate edge.');
    requireCover(!protectedRects.some(r=>overlaps(bounds,r,3))&&!labelBounds.some(r=>overlaps(bounds,r,2)),'Motif overlaps a label, opening or screw.');
  }
  requireCover(!d.treatment.startsWith('two-color')||features.length,'Two-color printing needs at least one visible label.');
  const result={geometry:base,materials:[]};
  if(features.length){
    const letters={operation:'union',operands:features},recessed=['recessed','two-color-flush'].includes(d.treatment);
    const solid=recessed?subtract(base,letters):combine(base,letters);
    if(d.treatment.startsWith('two-color')){
      const plate=recessed?solid:base,labelMaterial=recessed?{operation:'intersection',operands:[base,letters]}:subtract(letters,base);
      const built=await Geometry.constructGeometry([plate,labelMaterial],{toleranceMm:TOLERANCE_MM});
      requireCover(built.every(part=>!part.empty),'Color construction leaves an empty material part.');
      result.geometry={shape:'assembly',parts:built.map((part,i)=>({id:i?'labels':'plate',xMm:0,yMm:0,zMm:0,geometry:part.geometry}))};
      notes.push(...built.flatMap(part=>part.notes));
    }else{
      const [built]=await Geometry.constructGeometry([solid],{toleranceMm:TOLERANCE_MM});requireCover(!built.empty,'Lettering leaves no plate material.');result.geometry=built.geometry;notes.push(...built.notes);
    }
  }
  const parts=result.geometry.shape==='assembly'?result.geometry.parts:[];
  const meshes=await Geometry.constructSolids([result.geometry,...parts.map(part=>part.geometry)],{toleranceMm:TOLERANCE_MM});
  requireCover(meshes[0],'Cover construction leaves no display material.');result.mesh=asMesh(meshes[0]);
  result.materials=parts.map((part,i)=>({id:part.id,...asMesh(meshes[i+1])}));notes.push(...meshes.flatMap(mesh=>mesh?.notes??[]));
  return {...result,design:d,width:d.width,height:d.height,labelBounds,faceOffset,fontHash:font.sha256,printFace:down?'down':'up',warnings:[...new Set(notes),...(!down&&d.rearPocketDepth>0?[`Face-up printing leaves a ${d.rearPocketDepth.toFixed(2)} mm recessed underside. Add support beneath the rear pocket in Studio; review its roof and screw bosses before export.`]:[]),...(faceOffset>0?[`Face-down relief lifts the plate ${faceOffset.toFixed(2)} mm above the bed. Review support or bridging beneath the plate in Studio.`]:[]),'Draft fit geometry: verify openings, screw heads and rear clearance against your existing cover.','No physical fit or electrical material qualification recorded.']};
}
