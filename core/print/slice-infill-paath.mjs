// Infill stages exchange spatial Paath. Chart algorithms are private numerical
// computations; clipping selects native source ranges and row groups retain
// that source geometry, its attributes and each cell's local sequence.
import {lineSpacing} from '../path/spacing.mjs';
import {surfacePatternStrokes} from '../region/surface-patterns.mjs';
import {metricFillStrokes} from '../region/metric-fill.mjs';
import {sliceStrokesPaath,combineSlicePaath,emptySlicePaath} from './slice-paath.mjs';
import {clipInfillPaath,groupInfillPaathRows} from './slice-infill-operations.mjs';

function chartBoundsRegion(region){
  const low=[Infinity,Infinity],high=[-Infinity,-Infinity];
  for(const loop of region)for(const point of loop)for(let k=0;k<2;k++){
    low[k]=Math.min(low[k],point[k]);high[k]=Math.max(high[k],point[k]);
  }
  return [[low,[high[0],low[1]],high,[low[0],high[1]]]];
}

function patternPaath(region,role,layer,choices,identity){
  const {widthMm,spacingFactor,fillPattern,patternAngleDeg,rowPhaseMm=0,sampleStepMm,direction}=choices;
  const numerical=surfacePatternStrokes(layer.slice,fillPattern==='concentric'?region:chartBoundsRegion(region),{
    pitch:lineSpacing(widthMm,{spacingFactor}),fillDensity:choices.density,fillPattern,patternAngleDeg,rowPhaseMm,
    sampleStepMm,direction,ungrouped:true});
  return {paath:sliceStrokesPaath([[role,numerical.map(stroke=>({...stroke,role}))]],layer,identity)};
}

function metricCellsPaath(region,role,layer,choices,identity){
  const order=choices.fillOrder;
  const metric=metricFillStrokes(layer.slice,chartBoundsRegion(region),{widthMm:choices.widthMm,density:choices.density,
    spacingFactor:choices.spacingFactor,sampleStepMm:choices.sampleStepMm,toleranceMm:order.toleranceMm,
    direction:choices.fillDirection??order.directions[(layer.characterIndex??layer.index)%order.directions.length],
    heightMm:layer.heightMm??layer.process?.layerMm,speedMmS:layer.firstBedLayer?layer.process.firstLayerSpeedMmS:layer.process.planarSpeedMmS,
    layoutChart:choices.layoutReference??layer.slice,startU:choices.startU??0,axialStart:choices.axialStart??0});
  return {paath:sliceStrokesPaath([[role,metric.strokes.map(stroke=>({...stroke,materialRole:role,cellDirection:stroke.role,
    directionRequired:stroke.directionRequired??true}))]],layer,identity),report:metric.report};
}

export function constructSliceInfill(layer,{solidRegion,sparseRegion},choices,{id,stackId=id,filament=null}={}){
  const identity={id,stackId,filament},stages=[];
  for(const [role,region,density,fillPattern,patternAngleDeg] of [
    ['infill',sparseRegion,choices.fillDensity,choices.fillPattern,choices.patternAngleDeg],
    ['fill',solidRegion,1,choices.solidPattern??'rectilinear',choices.fillAngleDeg],
  ]){
    if(!region.length||density===0)continue;
    const selected={...choices,density,fillPattern,patternAngleDeg};
    const source=choices.fillOrder?.kind==='surface-cells'?metricCellsPaath(region,role,layer,selected,identity):patternPaath(region,role,layer,selected,identity);
    const sourcePaath=source.paath,clippedPaath=clipInfillPaath(sourcePaath,region,{surface:layer.slice});
    const paath=groupInfillPaathRows(clippedPaath,{surface:layer.slice});
    stages.push({role,sourcePaath,clippedPaath,paath,...(source.report?{report:source.report}:{})});
  }
  const paath=stages.length?combineSlicePaath(stages.map(stage=>stage.paath)):emptySlicePaath(layer,identity);
  const metric=stages.filter(stage=>stage.report),last=metric.at(-1)?.report;
  const report=last?{...last,points:metric.reduce((sum,stage)=>sum+(stage.report.points??0),0),
    materials:Object.fromEntries(metric.map(stage=>[stage.role,stage.report]))}:null;
  return {paath,stages,report};
}
