// Slice constructs deposition from one prepared region/surface/gap description.
// Neither curvature, wrapping nor consumer names select a different pipeline.
import {surfaceConnectionMaterial} from '../geom/material-envelope.mjs';
import {requireThat} from '../private/toolpath/numeric.mjs';
import {PRINT_RESOLUTION_MM} from '../dimensions.mjs';
import {layerStrokes,mapSliceStrokes} from '../region/layer-strokes.mjs';
import {sliceGapCurves} from '../region/slice-gaps.mjs';
import {depositCurveBatches} from '../path/curve-batches.mjs';
import {lineSpacing} from '../path/spacing.mjs';

function evaluateRegionBatch({id,reference,strokes,gap,speedMmS,process,filament,sampleStepMm}){
  const mapped=mapSliceStrokes(strokes,reference,{frames:true,sampleStepMm});
  const curves=sliceGapCurves(mapped,reference,gap);
  if(!curves.length)return null;
  return depositCurveBatches({id,batches:[{key:0,curves,speedMmS}],process,filament,sequential:false})[0];
}

function sliceResult({id,stackId=id,settings,layers,filament=null,totalLayerCount=layers.length},{process,report:extra={}}){
  const width=process.lineWidthMm,operations=[],stackLayers=[];
  const report={depositionFamily:'slice',layers:0,skippedLayers:0,loops:0,fillRows:0,...extra};
  for(const layer of layers){
    const {index,slice,region,preparedStrokes:strokes}=layer;
    requireThat(strokes&&layer.gap,'Slice needs prepared strokes and gap inputs.');
    const s=layer.settings;
    if(!region.length){report.skippedLayers++;continue;}
    const connectionMaterial=surfaceConnectionMaterial(slice,region,{sampleStepMm:s.sampleStepMm,lineWidthMm:width});
    if(strokes.constructionReport){report.fillOrder=strokes.constructionReport;
      if(strokes.constructionReport.notes?.length)report.notes=[...(report.notes??[]),...strokes.constructionReport.notes.map(note=>'Slice '+id+' layer '+index+': '+note)];}
    const boundaries=mapSliceStrokes(strokes.walls,slice,{frames:true,sampleStepMm:s.sampleStepMm}).map(curve=>{
      const duplicate=curve.points.length>2&&Math.hypot(...curve.points[0].map((v,k)=>v-curve.points.at(-1)[k]))<=PRINT_RESOLUTION_MM;
      return !duplicate?curve:{...curve,closed:true,points:curve.points.slice(0,-1),chartPoints:curve.chartPoints.slice(0,-1),normals:curve.normals.slice(0,-1),frameSamples:curve.frameSamples?.slice(0,-1)};
    });
    stackLayers.push({...layer,curves:boundaries,fillCurves:strokes.fill,infillCurves:strokes.infill});
    report.loops+=strokes.walls.length;report.fillRows+=strokes.infill.length+strokes.fill.length;
    const speedMmS=layer.firstBedLayer?process.firstLayerSpeedMmS:process.planarSpeedMmS;
    for(const [group,found] of [['walls',strokes.walls],['infill',strokes.infill],['fill',strokes.fill]]){
      if(!found.length)continue;
      const roles=s.roles??settings.roles;
      const deposited=evaluateRegionBatch({id,reference:slice,strokes:found.map(stroke=>({...stroke,directionRequired:false,seamRequired:false,role:roles?.[stroke.role]??stroke.role})),gap:layer.gap,speedMmS,process,filament,sampleStepMm:s.sampleStepMm});
      if(!deposited)continue;
      const lifted=deposited.strokes,heights=lifted.flatMap(stroke=>stroke.points.map(point=>point[2])),top=Math.max(...heights),planar=top-Math.min(...heights)<=PRINT_RESOLUTION_MM;
      const opId=id+':'+index+':'+group;
      operations.push({...deposited,id:opId,layerId:stackId+':layer:'+index,stackId,phase:planar?'planar':'curves',layer:index,rank:top,
        after:[...(s.operationAfter?.[group]??[])],strokes:lifted,connectNearby:s.connectNearby??true,layerIndex:layer.ordinal,layerCount:totalLayerCount,
        stackDirection:layer.direction??null,...(s.continuous?{continuous:true,regionId:id+':'+index}:{}),
        order:s.order??(group==='walls'?(lifted.every(stroke=>stroke.closed&&!stroke.volumesMm3)?'nearest':'given'):lifted.every(stroke=>stroke.scanlineCell!==undefined)?'nearest-cells':'given'),
        slice,ownershipIndex:index,
        materialGeometry:connectionMaterial??{kind:'bounds',maxZ:top},
        ...((Object.hasOwn(s.process??{},'fanPercent')||layer.ordinal===1)?{fanPercent:process.fanPercent}:{}),...(filament===null?{}:{filament})});
    }
    report.layers++;
  }
  return {id,operations,report,stackLayers};
}

export function fillSliceRegion(region,{source,angleDeg=null,role='fill'}={}){
  requireThat(source?.slice&&source.settings&&source.process,'Region fill needs a resolved source layer.');
  const settings=source.settings,index=source.index??0,angles=settings.fillAnglesDeg;
  const angle=angleDeg??(settings.rotateFill?angles[index%angles.length]:angles[0]);
  const width=source.widthMm??source.process.lineWidthMm;
  const strokes=layerStrokes(region,{...settings,widthMm:width,loops:0,fillDensity:1,solidDensity:1,fillPattern:'rectilinear',fillAngleDeg:angle,patternAngleDeg:angle,
    solid:null,fillOrder:null,slice:source.slice,direction:source.direction,layer:source,material:region,outward:false,
    loopBoundary:region,wallToleranceMm:source.process.planarWallToleranceMm,phaseMm:source.slice.origin?.[2]??source.slice.offsetMm??0});
  const curves=strokes.fill.map(stroke=>({closed:stroke.closed,orderGroup:stroke.scanlineCell,directionRequired:false,seamRequired:false,
    uv:{reference:{kind:'slice',assignment:source.stackId,index},points:stroke.points},role,
    beadWidthMm:width,sampleStepMm:settings.sampleStepMm}));
  return {curves,report:{curves:curves.length,widthMm:width,pitchMm:lineSpacing(width,settings),angleDeg:angle}};
}


export function sliceContextResult(record,{layerIndex=null}={}){
  const layers=layerIndex===null?record.spec.layers:record.spec.layers.filter(layer=>layer.index===layerIndex);
  requireThat(layers.length,'Slice construction context has no requested layer.');
  const result=sliceResult({...record.spec,stackId:record.stackId??record.spec.id,layers},record.context);
  return {...result,referenceStack:{...record.referenceStack,layers:result.stackLayers},stackId:record.stackId};
}
