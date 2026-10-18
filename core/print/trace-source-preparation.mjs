// Generated Trace curves are authored from prepared layer geometry, before
// deposition. Construction consumes these cached descriptions.
import {requireThat} from '../private/toolpath/numeric.mjs';
import {geometrySelections} from '../geom/selections.mjs';
import {validateCurveAssignment} from './curves.mjs';
export function prepareTraceSourceLayer(context,record,layer,plan){
  const assignment=context.assignment;
  if(context.sourceError)throw context.sourceError;
  requireThat(context.curveSource&&typeof context.curveSource.constructLayer==='function','Trace source entry must provide constructLayer.');
  const selection=plan.geometry?geometrySelections(plan.geometry).get(record.owner.part):null;
  const source={slice:layer.slice,region:layer.region,material:layer.material,perimeters:layer.perimeters,
    sectionReport:layer.sectionReport,solidRegion:layer.solidRegion,sparseRegion:layer.sparseRegion,
    denseRegion:layer.denseRegion??[],
    widthMm:layer.widthMm,pitchMm:layer.pitchMm,wallInsetMm:layer.wallInsetMm,heightMm:layer.heightMm,
    index:layer.index,sourceId:record.owner.assignment.id,stackId:record.stackId??record.spec.id,part:record.owner.part,
    placement:{offset:selection?[selection.xMm,selection.yMm,selection.zMm]:[0,0,0]},
    settings:layer.settings??record.spec.settings,process:layer.process??record.context.process,
    key:record.spec.id+':'+layer.index,ordinal:record.spec.layers.findIndex(item=>item.index===layer.index),count:record.spec.totalLayerCount,
    rank:record.layerOrder.find(item=>item.index===layer.index)?.rank,layerId:(record.stackId??record.spec.id)+':layer:'+layer.index,
    speedMmS:layer.firstBedLayer?layer.process.firstLayerSpeedMmS:layer.process.planarSpeedMmS};
  const produced=context.curveSource.constructLayer({source,parameters:assignment.source.parameters});
  requireThat(produced&&Array.isArray(produced.curves)&&(produced.sliceMember===undefined||typeof produced.sliceMember==='boolean'),'Trace source must return curves, optional sliceMember and report.');
  const authored={...assignment,source:null,curves:produced.curves,filament:assignment.filament??record.spec.filament};
  if(authored.curves.length)validateCurveAssignment(authored);
  return {source,produced,authored};
}
