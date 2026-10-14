import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {normalizeDesign,fitLayout,overlaps,requireCover} from './design.mjs';

// Print-resolution tessellation; overlap and fit lands are authored dimensions.
const TOLERANCE_MM=.03,OVERLAP_MM=.05;
function rectangleLoop(w,h,r){
  if(!r)return [[0,0],[w,0],[w,h],[0,h]];
  const out=[];for(const [cx,cy,start] of [[w-r,r,-90],[w-r,h-r,0],[r,h-r,90],[r,r,180]]){
    const steps=Math.ceil(Math.PI*r/2/Math.sqrt(8*r*TOLERANCE_MM));
    for(let j=0;j<=steps;j++){const a=(start+j*90/steps)*Math.PI/180;out.push([cx+r*Math.cos(a),cy+r*Math.sin(a)]);}
  }return out;
}
function circleLoop(radius,x,y){
  const count=Math.max(8,Math.ceil(Math.PI/Math.acos(1-Math.min(TOLERANCE_MM/radius,1))));
  return Array.from({length:count},(_,i)=>{const a=i*2*Math.PI/count;return [x+radius*Math.cos(a),y+radius*Math.sin(a)];});
}
function extrusion(loop,bottom,height){return {operation:'loft',rings:[loop.map(p=>[...p,bottom]),loop.map(p=>[...p,bottom+height])],centers:[centroid(loop,bottom),centroid(loop,bottom+height)]};}
function centroid(loop,z){return [0,1].map(k=>loop.reduce((sum,p)=>sum+p[k],0)/loop.length).concat(z);}
function box(w,h,height,x,y,bottom){return {operation:'translate',offset:[x-w/2,y-h/2,bottom],geometry:{operation:'box',size:[w,h,height]}};}
function cylinder(height,radius,x,y,bottom){return extrusion(circleLoop(radius,x,y),bottom,height);}
function subtract(body,cutter){return {operation:'difference',operands:[body,cutter]};}
function combine(body,addition){return {operation:'union',operands:[body,addition]};}
function asMesh(mesh){return {shape:'mesh',source:null,vertices:mesh.vertices,triangles:mesh.triangles};}
function flipMesh(mesh,d,faceOffset){return {...mesh,vertices:mesh.vertices.map(([x,y,z])=>[x,d.height-y,d.thickness+faceOffset-z])};}
function xyBounds(mesh,down,height){
  const points=mesh.vertices.map(([x,y])=>[x,down?height-y:y]);
  return [Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];
}
async function savedFont(){
  const bytes=await readFile(new URL('./fonts/Abel-Regular.ttf',import.meta.url));
  return {data:bytes.toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex'),postscriptName:null};
}
function plateConstruction(d,slots){
  const work={body:extrusion(rectangleLoop(d.width,d.height,d.cornerRadius),0,d.thickness)};
  if(d.rearPocketDepth){
    const pocket={body:box(d.width-2*d.rimWidth,d.height-2*d.rimWidth,d.rearPocketDepth+OVERLAP_MM,d.width/2,d.height/2,-OVERLAP_MM)};
    for(const s of slots)for(const y of [s.y-s.screwPitch/2,s.y+s.screwPitch/2])pocket.body=subtract(pocket.body,cylinder(d.rearPocketDepth+2*OVERLAP_MM,d.screwHeadDiameter/2+1.5,s.x,y,-OVERLAP_MM));
    work.body=subtract(work.body,pocket.body);
  }
  for(const s of slots){
    if(s.kind!=='blank')work.body=subtract(work.body,box(s.width,s.height,d.thickness+2*OVERLAP_MM,s.x,s.y,-OVERLAP_MM));
    for(const y of [s.y-s.screwPitch/2,s.y+s.screwPitch/2]){
      work.body=subtract(work.body,cylinder(d.thickness+2*OVERLAP_MM,d.screwDiameter/2,s.x,y,-OVERLAP_MM));
      if(d.countersinkDepth){
        // Matched angular vertices preserve a tapered screw-head seat.
        const top=circleLoop(d.screwHeadDiameter/2,s.x,y),bottom=top.map(([x,z])=>[s.x+(x-s.x)*d.screwDiameter/d.screwHeadDiameter,y+(z-y)*d.screwDiameter/d.screwHeadDiameter]);
        const z=d.thickness-d.countersinkDepth;
        work.body=subtract(work.body,{operation:'loft',rings:[bottom.map(p=>[...p,z]),top.map(p=>[...p,d.thickness+OVERLAP_MM])],centers:[[s.x,y,z],[s.x,y,d.thickness+OVERLAP_MM]]});
      }
    }
  }
  for(const m of d.decoration){
    const bottom=m.mode==='raised'?d.thickness-OVERLAP_MM:d.thickness-m.depth;
    const loop=m.shape==='circle'?circleLoop(m.size/2,m.x,m.y):m.shape==='diamond'?[[m.x,m.y-m.size/2],[m.x+m.size/2,m.y],[m.x,m.y+m.size/2],[m.x-m.size/2,m.y]]:[[m.x-m.size/2,m.y-.4],[m.x+m.size/2,m.y-.4],[m.x+m.size/2,m.y+.4],[m.x-m.size/2,m.y+.4]];
    const motif=extrusion(loop,bottom,m.depth+2*OVERLAP_MM);
    if(m.mode==='raised')work.body=combine(work.body,motif);else work.body=subtract(work.body,motif);
  }
  return work.body;
}
export async function buildCover(input,{Geometry,Extensions}){
  const d=normalizeDesign(input),{slots,protectedRects}=fitLayout(d),down=d.faceOrientation==='down';
  const faceOffset=down?Math.max(0,...d.decoration.filter(m=>m.mode==='raised').map(m=>m.depth+OVERLAP_MM)):0;
  const [plateMesh]=await Geometry.constructSolids([plateConstruction(d,slots)],{toleranceMm:TOLERANCE_MM});
  requireCover(plateMesh,'Cover construction leaves no material.');
  const base=asMesh(down?flipMesh(plateMesh,d,faceOffset):plateMesh),font=await savedFont(),features=[],labelBounds=[],notes=[...plateMesh.notes??[]];
  for(const [i,s] of slots.entries())if(s.label.trim()){
    const inset=['recessed','two-color-flush'].includes(d.treatment);
    const feature={id:`label-${i+1}`,text:s.label,font,mode:'raised',sizeMm:d.labelSize,lineHeightMm:d.labelSize*1.2,align:'center',outlineOffsetMm:.12,depthMm:d.reliefDepth,offsetMm:inset?-d.reliefDepth:0,overlapMm:inset?0:.1,positionMm:[s.x,s.labelPosition==='top'?d.height-23:15],reference:{kind:'plane',origin:down?[0,d.height,faceOffset]:[0,0,d.thickness],xAxis:[1,0,0],yAxis:down?[0,-1,0]:[0,1,0]}};
    const compiled=await Extensions.text.compileText(null,[feature],{...Geometry,standalone:true,toleranceMm:TOLERANCE_MM,maxEdgeMm:2});
    requireCover(compiled.geometry.vertices.length,`Label ${i+1} leaves no printable material.`);
    const bounds=xyBounds(compiled.geometry,down,d.height);
    requireCover(bounds[0]>=3&&bounds[1]>=3&&bounds[2]<=d.width-3&&bounds[3]<=d.height-3,`Label ${i+1} does not fit. Shorten it, use a smaller size or enlarge the plate.`);
    requireCover(!protectedRects.some(r=>overlaps(bounds,r,2)),`Label ${i+1} overlaps an opening or screw. Change its placement or size.`);
    requireCover(!labelBounds.some(r=>overlaps(bounds,r,1)),'Labels overlap. Reduce text size or shorten labels.');
    labelBounds.push(bounds);features.push(asMesh(compiled.geometry));notes.push(...compiled.notes);
  }
  for(const m of d.decoration){
    const bounds=m.shape==='stripe'?[m.x-m.size/2,m.y-.4,m.x+m.size/2,m.y+.4]:[m.x-m.size/2,m.y-m.size/2,m.x+m.size/2,m.y+m.size/2];
    requireCover(bounds[0]>=3&&bounds[1]>=3&&bounds[2]<=d.width-3&&bounds[3]<=d.height-3,'Motif crosses a plate edge.');
    requireCover(!protectedRects.some(r=>overlaps(bounds,r,3))&&!labelBounds.some(r=>overlaps(bounds,r,2)),'Motif overlaps a label, opening or screw.');
  }
  requireCover(!d.treatment.startsWith('two-color')||features.length,'Two-color printing needs at least one visible label.');
  const result={geometry:base,mesh:base,materials:[]};
  if(features.length){
    const baseShell=await Geometry.buildGeometry(base),letters={operation:'union',operands:await Promise.all(features.map(feature=>Geometry.buildGeometry(feature)))},recessed=['recessed','two-color-flush'].includes(d.treatment);
    const solid=recessed?subtract(baseShell,letters):combine(baseShell,letters);
    if(d.treatment.startsWith('two-color')){
      const plate=recessed?solid:baseShell,labelMaterial=recessed?{operation:'intersection',operands:[baseShell,letters]}:subtract(letters,baseShell);
      const [whole,platePart,labelPart]=await Geometry.constructSolids([recessed?baseShell:solid,plate,labelMaterial],{toleranceMm:TOLERANCE_MM});
      requireCover(whole&&platePart&&labelPart,'Color construction leaves an empty material part.');
      result.mesh=asMesh(whole);result.materials=[{id:'plate',...asMesh(platePart)},{id:'labels',...asMesh(labelPart)}];
      result.geometry={shape:'assembly',parts:result.materials.map(({id,...geometry})=>({id,xMm:0,yMm:0,zMm:0,geometry}))};
      notes.push(...whole.notes??[],...platePart.notes??[],...labelPart.notes??[]);
    }else{
      const [mesh]=await Geometry.constructSolids([solid],{toleranceMm:TOLERANCE_MM});requireCover(mesh,'Lettering leaves no plate material.');result.geometry=asMesh(mesh);result.mesh=result.geometry;notes.push(...mesh.notes??[]);
    }
  }
  return {...result,design:d,width:d.width,height:d.height,labelBounds,faceOffset,fontHash:font.sha256,printFace:down?'down':'up',warnings:[...new Set(notes),...(!down&&d.rearPocketDepth>0?[`Face-up printing leaves a ${d.rearPocketDepth.toFixed(2)} mm recessed underside. Add support beneath the rear pocket in Studio; review its roof and screw bosses before export.`]:[]),...(faceOffset>0?[`Face-down relief lifts the plate ${faceOffset.toFixed(2)} mm above the bed. Review support or bridging beneath the plate in Studio.`]:[]),'Draft fit geometry: verify openings, screw heads and rear clearance against your existing cover.','No physical fit or electrical material qualification recorded.']};
}
