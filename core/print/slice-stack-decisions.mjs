// All choices involving the recipe or other members are fixed before a member
// constructs walls or infill. The resulting members have no shared fill cursor.
import {solidMasks} from '../region/solid-masks.mjs';
import {intersect,union} from '../region/intersection.mjs';
import {lineSpacing} from '../path/spacing.mjs';
import {PRINT_RESOLUTION_MM,ROUNDING_RELATIVE} from '../dimensions.mjs';

const parallel=(a,b)=>a&&b&&Math.abs(a[0]*b[0]+a[1]*b[1]+a[2]*b[2]-1)<=ROUNDING_RELATIVE;
// Two members' regions share one chart when their surfaces differ only by a
// translation along the stack (planes) or are the same translated patch.
function sharedChart(a,b){
  if(a.kind==='patch'&&b.kind==='patch')return true;
  if(a.kind!=='plane'||b.kind!=='plane'||!parallel(a.normal,b.normal)||!parallel(a.xAxis,b.xAxis))return false;
  const offset=b.origin.map((v,k)=>v-a.origin[k]),along=offset.reduce((sum,v,k)=>sum+v*a.normal[k],0);
  return Math.hypot(...offset.map((v,k)=>v-along*a.normal[k]))<=PRINT_RESOLUTION_MM/16;
}
// The bed is material in the XY plane. A horizontal member is first on the bed
// when its material reaches that plane; any other first member keeps the
// recipe's own declaration.
function restsOnBed(layer,process,materialOrdinal,onSubstrate){
  const slice=layer.slice;
  if(slice?.kind==='plane'&&parallel(slice.normal,[0,0,1]))
    return Math.abs(slice.origin[2]-(layer.heightMm??process.layerMm))<=PRINT_RESOLUTION_MM*2;
  return materialOrdinal===0&&!onSubstrate;
}
// What the stack itself declares each member rests on. Inside `region` the
// member rests on its native predecessor; `outside` is the declaration for the
// rest: undefined defers to the operation's declared prerequisites (the first
// member, or a member naming its own), false leaves it to the Scheduler.
function memberFoundation(layer,previous,materialOrdinal,{reference=false}={}){
  const own=Boolean(layer.prerequisites?.length||layer.settings?.operationAfter?.all?.length);
  if(!previous||materialOrdinal===0)return {region:null,outside:undefined};
  if(reference)return {region:null,outside:true};
  const region=previous.region.length&&sharedChart(previous.slice,layer.slice)?intersect(layer.region,previous.region):[];
  return {region:region.length?region:null,outside:own?undefined:false};
}

function memberSettings(settings,layer){
  const characterIndex=layer.characterIndex??layer.index,override=settings.sliceOverrides?.[characterIndex];
  const resolved={...settings,...layer.settings,...override};
  if(Array.isArray(resolved.loops))resolved.loops=resolved.loops[characterIndex%resolved.loops.length];
  return resolved;
}

function fullFillRegions(layer,settings,bodyLayers,solidRegions){
  if(!layer.region.length)return [];
  if(settings.fillDensity===1)return layer.region;
  const grid=layer.materialGrid?.layers??bodyLayers,index=layer.materialGrid?.index??layer.index;
  const skins=settings.solidBottom>0||settings.solidTop>0?
    solidMasks(grid,index,{bottomLayers:settings.solidBottom,topLayers:settings.solidTop}).solid:[];
  const explicit=solidRegions.get(layer.index)??[];
  return skins.length||explicit.length?intersect(layer.region,union(skins,union(explicit,[]))):[];
}

export function decideSliceStack({settings,layers,material=null,solidRegions=new Map()},context){
  const bodyLayers=Object.freeze(layers.map(layer=>Object.freeze({index:layer.index,
    region:material?.get(layer.index)??layer.material??layer.region})));
  let materialOrdinal=-1;
  return layers.map((layer,ordinal)=>{
    const resolved=memberSettings(settings,layer),characterIndex=layer.characterIndex??layer.index;
    const process={...context.process,...settings.process,...layer.process,...layer.settings?.process,
      ...settings.sliceOverrides?.[characterIndex]?.process};
    const widthMm=process.lineWidthMm,pitchMm=lineSpacing(widthMm,resolved),wallInsetMm=resolved.loopInsetMm??widthMm/2;
    const onSubstrate=layer.onSubstrate??context.onSubstrate??Boolean(settings.contact??settings.substrate);
    if(layer.region.length)materialOrdinal++;
    const firstBedLayer=layer.region.length>0&&restsOnBed(layer,process,materialOrdinal,onSubstrate);
    const foundation=layer.region.length?memberFoundation(layer,layers[ordinal-1],materialOrdinal,context):null;
    const gap=layer.gap??{advanceMm:layer.translationMm??layer.heightMm,direction:layer.direction,
      substrate:onSubstrate?null:context.substrate??null};
    const fullFill=fullFillRegions(layer,resolved,bodyLayers,solidRegions),angles=resolved.fillAnglesDeg;
    const fillAngleDeg=resolved.rotateFill?angles[characterIndex%angles.length]:angles[0];
    const speedMmS=firstBedLayer?process.firstLayerSpeedMmS:process.planarSpeedMmS;
    const decided={...layer,ordinal,characterIndex,settings:resolved,process,widthMm,pitchMm,wallInsetMm,
      onSubstrate,firstBedLayer,foundation,materialOrdinal:layer.region.length?materialOrdinal:null,gap,fullFillRegions:fullFill};
    const strokeSettings={...resolved,widthMm,fillAngleDeg,solidDensity:1,
      direction:layer.patternDirection??layer.direction,
      patternAngleDeg:fillAngleDeg,phaseMm:layer.phaseMm??layer.offsetMm??0,
      rowPhaseMm:layer.rowPhaseMm??resolved.rowPhaseMm,
      solid:fullFill,material:layer.material??layer.region,outward:layer.outward??false,slice:layer.slice,
      loopBoundary:layer.loopBoundary??layer.region,layer:{index:layer.index,heightMm:layer.heightMm,speedMmS},
      startU:layer.startU??resolved.startU??0,axialStart:layer.axialStart??resolved.axialStart??0,
      layoutReference:layer.layoutReference??layer.slice,wallToleranceMm:resolved.wallToleranceMm??process.planarWallToleranceMm};
    return {...decided,strokeSettings,sliceChoices:{
      walls:{count:resolved.loops,insetMm:wallInsetMm,pitchMm,outward:layer.outward??false},
      fill:{fullFillRegions:fullFill,overlap:resolved.fillOverlap},
      pattern:{density:resolved.fillDensity,sparse:resolved.fillPattern,solid:'rectilinear',angleDeg:fillAngleDeg,
        patternAngleDeg:strokeSettings.patternAngleDeg,phaseMm:strokeSettings.phaseMm,rowPhaseMm:strokeSettings.rowPhaseMm??0},
      process:{...process,firstBedLayer,speedMmS,gap},
    }};
  });
}

// Later stages query these member choices; the member command carries only
// the member's surface, material and wall choices.
export function sliceStackChoices(members){
  const byIndex=new Map(members.map(member=>[member.index,member]));
  const member=index=>{const found=byIndex.get(index);if(!found)throw Error('Slice has no decided member '+index+'.');return found;};
  return {
    fill:index=>{const {strokeSettings:s}=member(index);return {fullFillRegions:s.solid,density:s.fillDensity,overlap:s.fillOverlap};},
    pattern:index=>{const {strokeSettings:s}=member(index);return {widthMm:s.widthMm,spacingFactor:s.spacingFactor,sampleStepMm:s.sampleStepMm,
      direction:s.direction,fillDensity:s.fillDensity,fillPattern:s.fillPattern,patternAngleDeg:s.patternAngleDeg,solidPattern:s.solidPattern,
      fillAngleDeg:s.fillAngleDeg,rowPhaseMm:s.rowPhaseMm,fillOrder:s.fillOrder,fillDirection:s.fillDirection,layoutReference:s.layoutReference,
      startU:s.startU,axialStart:s.axialStart};},
    process:index=>{const {process,firstBedLayer,gap,settings,widthMm}=member(index);
      return {process,firstBedLayer,gap,flowMultiplier:settings.flowMultiplier??process.flowMultiplier??1,widthMm:widthMm??process.lineWidthMm};},
  };
}
