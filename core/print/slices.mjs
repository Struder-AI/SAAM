// Slice constructs deposition from one prepared region/surface/gap description.
// Neither curvature, wrapping nor consumer names select a different pipeline.
import {evaluateSurface} from '../geom/surface-evaluation.mjs';
import {measureSurfaceRegion} from '../geom/surface-region-measure.mjs';
import {requireThat} from '../private/toolpath/numeric.mjs';
import {PRINT_RESOLUTION_MM} from '../dimensions.mjs';
import {layerStrokes,mapSliceStrokes,loopMaterial,fillMaterial} from '../region/layer-strokes.mjs';
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
  const report={depositionFamily:'slice',layers:0,skippedLayers:0,areaMm2:0,loops:0,fillRows:0,solidAreaMm2:0,...extra};
  for(const layer of layers){
    const {index,slice,region,preparedStrokes:strokes}=layer;
    requireThat(strokes&&layer.gap,'Slice needs prepared strokes and gap inputs.');
    const s=layer.settings,pitch=layer.pitchMm;
    const measure=loops=>measureSurfaceRegion(slice,loops,{sampleStepMm:s.sampleStepMm,lineWidthMm:width});
    const measured=measure(region);
    if(!measured.areaMm2){report.skippedLayers++;continue;}
    if(strokes.constructionReport){report.fillOrder=strokes.constructionReport;
      if(strokes.constructionReport.notes?.length)report.notes=[...(report.notes??[]),...strokes.constructionReport.notes.map(note=>'Slice '+id+' layer '+index+': '+note)];}
    const boundaries=mapSliceStrokes(strokes.walls,slice,{frames:true,sampleStepMm:s.sampleStepMm}).map(curve=>{
      const duplicate=curve.points.length>2&&Math.hypot(...curve.points[0].map((v,k)=>v-curve.points.at(-1)[k]))<=PRINT_RESOLUTION_MM;
      return !duplicate?curve:{...curve,closed:true,points:curve.points.slice(0,-1),chartPoints:curve.chartPoints.slice(0,-1),normals:curve.normals.slice(0,-1),frameSamples:curve.frameSamples?.slice(0,-1)};
    });
    stackLayers.push({...layer,curves:boundaries,fillCurves:strokes.fill,infillCurves:strokes.infill});
    report.solidAreaMm2+=measure(strokes.solidRegion).areaMm2;
    report.loops+=strokes.walls.length;report.fillRows+=strokes.infill.length+strokes.fill.length;
    const speedMmS=layer.firstBedLayer?process.firstLayerSpeedMmS:process.planarSpeedMmS;
    for(const [group,found] of [['walls',strokes.walls],['infill',strokes.infill],['fill',strokes.fill]]){
      if(!found.length)continue;
      const roles=s.roles??settings.roles;
      const deposited=evaluateRegionBatch({id,reference:slice,strokes:found.map(stroke=>({...stroke,role:roles?.[stroke.role]??stroke.role})),gap:layer.gap,speedMmS,process,filament,sampleStepMm:s.sampleStepMm});
      if(!deposited)continue;
      const lifted=deposited.strokes,heights=lifted.flatMap(stroke=>stroke.points.map(point=>point[2])),top=Math.max(...heights),planar=top-Math.min(...heights)<=PRINT_RESOLUTION_MM;
      const opId=id+':'+index+':'+group,spacing=group==='infill'?pitch/s.fillDensity:pitch;
      let covered;
      operations.push({...deposited,id:opId,layerId:stackId+':layer:'+index,stackId,phase:planar?'planar':'curves',layer:index,rank:top,
        after:[],strokes:lifted,connectNearby:s.connectNearby??true,layerIndex:layer.ordinal,layerCount:totalLayerCount,
        stackDirection:layer.direction??null,...(s.continuous?{continuous:true,regionId:id+':'+index}:{}),
        order:s.order??(group==='walls'?(lifted.every(stroke=>stroke.closed&&!stroke.volumesMm3)?'nearest':'given'):lifted.every(stroke=>stroke.scanlineCell!==undefined)?'nearest-cells':'given'),
        region:measured.worldRegion,slice,ownershipIndex:index,
        get materialRegion(){return covered??=(group==='walls'?loopMaterial(region,{widthMm:width,loops:s.loops,spacingFactor:s.spacingFactor},{outward:layer.outward??false,slice,sampleStepMm:s.sampleStepMm}):
          fillMaterial(group==='infill'?strokes.sparseRegion:strokes.solidRegion,width,{slice,sampleStepMm:s.sampleStepMm})).map(loop=>loop.map(uv=>evaluateSurface(slice,uv).point.slice(0,2)));},
        materialCoverage:group!=='walls'&&spacing>width+PRINT_RESOLUTION_MM?'sparse':'area',materialGeometry:measured.materialGeometry,
        ...((Object.hasOwn(s.process??{},'fanPercent')||layer.ordinal===1)?{fanPercent:process.fanPercent}:{}),...(filament===null?{}:{filament})});
    }
    report.layers++;report.areaMm2+=measured.areaMm2;
  }
  const widths=operations.flatMap(operation=>operation.strokes.flatMap(stroke=>stroke.segmentMetadata?.map(m=>m.beadWidthMm).filter(Number.isFinite)??[]));
  if(widths.length){report.minBeadWidthMm=Math.min(...widths);report.maxBeadWidthMm=Math.max(...widths);}
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
  const curves=strokes.fill.map(stroke=>({closed:stroke.closed,uv:{reference:{kind:'slice',assignment:source.stackId,index},points:stroke.points},role,
    beadWidthMm:width,sampleStepMm:settings.sampleStepMm}));
  return {curves,report:{curves:curves.length,widthMm:width,pitchMm:lineSpacing(width,settings),angleDeg:angle}};
}


export function sliceContextResult(record,{layerIndex=null}={}){
  const layers=layerIndex===null?record.spec.layers:record.spec.layers.filter(layer=>layer.index===layerIndex);
  requireThat(layers.length,'Slice construction context has no requested layer.');
  const result=sliceResult({...record.spec,stackId:record.stackId??record.spec.id,layers},record.context);
  return {...result,referenceStack:{...record.referenceStack,layers:result.stackLayers},stackId:record.stackId};
}
