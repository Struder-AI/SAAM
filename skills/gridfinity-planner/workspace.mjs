import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {CATALOG,DEFAULT_DESIGN,PITCH_MM,normalizeDesign,planPlates,binParameters,summary} from './design.mjs';

const LABEL_FONT=Object.freeze({name:'Abel',license:'SIL Open Font License'});
// Bin floor top for the gridfinity extension's default 2.25 mm floor.
const BIN_FLOOR_Z=4.75+2.25,WALL_MM=1.2;
// Display: palette cards draw one 42 mm cell in about 40 px, so half a pixel.
const THUMBNAIL_CHORD_MM=PITCH_MM/80;

async function labelFont(){
  const bytes=await readFile(new URL('./fonts/Abel-Regular.ttf',import.meta.url));
  return {data:bytes.toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex'),postscriptName:null};
}
// Raised lettering on the floor of the front-left compartment, or on the top
// face of a blank, sized to fit its width.
function labelFeature(bin,font){
  const compartments=bin.kind==='bin'?bin.compartmentsX:1,inside=PITCH_MM*bin.xUnits-0.5-(bin.kind==='bin'?2*WALL_MM:0);
  const width=(inside-(compartments-1)*WALL_MM)/compartments-3;
  const sizeMm=Math.max(3,Math.min(6,width/(0.5*bin.label.length)));
  const z=bin.kind==='bin'?BIN_FLOOR_Z:7*bin.heightUnits,inset=bin.kind==='bin'?0.25+WALL_MM+1.5:2;
  return {id:'label',text:bin.label,font,mode:'raised',sizeMm,positionMm:[inset,inset],depthMm:0.6,
    reference:{kind:'plane',origin:[0,0,z],xAxis:[1,0,0],yAxis:[0,1,0]}};
}

export function createGridfinityPlannerWorkspace({Geometry,Toolpath,Extensions,Machine}){
  const normalize=design=>normalizeDesign(design,{printer:Machine.printer});
  const compile=parameters=>Extensions.gridfinity.create(parameters);
  const thumbnails=new Map();
  // Coarse meshes of each catalog type for the palette's 3D previews.
  async function catalogPreviews(){
    const previews=[];
    for(const entry of CATALOG){
      if(!thumbnails.has(entry.type)){
        const bin={...entry,heightUnits:entry.kind==='blank'?2:3,magnetHoles:false,stackingLip:true,compartmentsX:entry.compartmentsX??1,compartmentsY:entry.compartmentsY??1};
        const {geometry}=await compile(binParameters(bin)),[mesh]=await Geometry.constructSolids([geometry.solid],{toleranceMm:THUMBNAIL_CHORD_MM});
        thumbnails.set(entry.type,{vertices:mesh.vertices.map(v=>v.map(n=>Math.round(n*100)/100)),triangles:mesh.triangles});
      }
      previews.push({...entry,mesh:thumbnails.get(entry.type)});
    }
    return previews;
  }
  return {
    defaults:structuredClone(DEFAULT_DESIGN),
    normalize,
    preview:async design=>summary(design,Machine.printer(design.printer.machineId)),
    resources:async()=>({catalog:await catalogPreviews(),printers:Machine.printers(),labelFont:LABEL_FONT}),
    pieces:design=>planPlates(design,Machine.printer(design.printer.machineId)).map(plate=>({id:plate.id,filaments:plate.filaments,items:plate.items.map(item=>item.id)})),
    construct:async(design,pieceId)=>{
      const printer=Machine.printer(design.printer.machineId),bed=printer.printableMm;
      const plate=planPlates(design,printer).find(entry=>entry.id===pieceId);
      if(!plate)throw Error(`No build plate ${pieceId} in this plan.`);
      // Parts are placed around the centre of the printable area; Studio places
      // the plate on whichever printer is chosen there.
      const centre=[(bed.min[0]+bed.max[0])/2,(bed.min[1]+bed.max[1])/2];
      const compiled=new Map(),parts=[],notes=[];
      for(const item of plate.items){
        const parameters=item.kind==='baseplate'
          ?{kind:'baseplate',xUnits:item.xUnits,yUnits:item.yUnits,floorMm:design.baseplate.floorMm,
            paddingLeftMm:item.padding.left,paddingRightMm:item.padding.right,paddingFrontMm:item.padding.front,paddingBackMm:item.padding.back}
          :binParameters(item.bin);
        const key=JSON.stringify(parameters);
        if(!compiled.has(key)){const built=await compile(parameters);compiled.set(key,built.geometry);notes.push(...built.report?.notes??[]);}
        parts.push({id:item.id,xMm:item.bedMm[0]-item.originMm[0]-centre[0],yMm:item.bedMm[1]-item.originMm[1]-centre[1],zMm:0,geometry:compiled.get(key)});
      }
      // Labels go through the text extension, the same tool a Studio session uses.
      const font=plate.items.some(item=>item.bin?.label)?await labelFont():null;
      for(const part of parts){
        const bin=plate.items.find(item=>item.id===part.id).bin;
        if(!bin?.label)continue;
        const lettered=await Extensions.text.compileText(part.geometry,[labelFeature(bin,font)],{...Geometry,toleranceMm:Geometry.dimensions.FEATURE_TOLERANCE_MM,maxEdgeMm:1});
        part.geometry=lettered.geometry;notes.push(...lettered.notes);
      }
      // Logical materials are chosen in Studio. A mixed plate gets one slice per
      // part so each bin can take its own filament there; colours stay intent.
      const base=Toolpath.recipeDefaults(),body=base.slices.assignments[0],mixed=plate.filaments.length>1;
      const assignments=mixed?parts.map(part=>({...structuredClone(body),id:part.id,part:part.id,filament:null})):base.slices.assignments;
      const colour=index=>design.filaments[index];
      return {
        plan:{...base,geometry:{shape:'assembly',parts},slices:{...base.slices,assignments}},
        source:{kind:'gridfinity-planner',version:2,plate:plate.id,intendedPrinter:{id:printer.id,name:printer.name},
          items:plate.items.map(item=>({id:item.id,kind:item.kind,bedMm:item.bedMm,...(item.bin?{bin:item.bin}:{xUnits:item.xUnits,yUnits:item.yUnits,padding:item.padding})})),
          ...(font?{font:{name:'Abel Regular',sha256:font.sha256,license:'SIL-OFL-1.1'}}:{})},
        requirements:{orientation:'feet down on the bed, as laid out',
          assembly:'baseplate tiles butt together in the drawer; bins drop into the sockets',
          layout:`laid out for the ${printer.name} printable area; choose the printer and setup in Studio`,
          materialRoles:mixed?plate.items.map(item=>({part:item.id,filament:plate.filaments.indexOf(item.filament),color:colour(item.filament).colour,name:colour(item.filament).name}))
            :[{part:null,filament:0,color:colour(plate.filaments[0]).colour,name:colour(plate.filaments[0]).name}],
          fitStatus:'unverified'},
        report:{plate:plate.id,parts:plate.items.length,labels:plate.items.filter(item=>item.bin?.label).length,...(notes.length?{notes:[...new Set(notes)]}:{})}
      };
    }
  };
}
