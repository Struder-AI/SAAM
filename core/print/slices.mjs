import {horizontal,sliceKey} from '../geom/slice.mjs';
import {evaluateSurface} from '../geom/surface-evaluation.mjs';
import {requireThat} from "../private/toolpath/numeric.mjs";
// Slice deposits within prepared material regions over a supplied reference.

import {resolveSliceStack} from "./slice-stacks.mjs";

import {depositedBeadSegments,depositedBeadsContain,depositedBeadBounds} from '../path/deposited-curves.mjs';
import {materialContact} from '../region/material-contact.mjs';
import {heightSliceNormal} from "../geom/height-slice.mjs";

import {BUILD_SCALE_MM,PRINT_RESOLUTION_MM} from '../dimensions.mjs';
import {patchMeanNormal} from "../geom/slice.mjs";

import {surfaceGapCurves} from '../region/surface-curves.mjs';
import {contactCurveGaps,contactSpanNote} from '../path/contact-curves.mjs';

import {solidMasks} from "../region/layer-region.mjs";
import { layerStrokes, mapSliceStrokes, sliceFrame, loopMaterial, fillMaterial } from '../region/layer-strokes.mjs';

import { regionArea } from '../region/region2d.mjs';
import {intersect,union} from "../region/intersection.mjs";

import {depositCurveBatches} from '../path/curve-batches.mjs';
import {contactCurveCourses} from '../path/contact-curves.mjs';
import { lineSpacing, spacingFactor } from '../path/spacing.mjs';
import { publishFinishedBoundary } from '../path/finished-surface.mjs';

// Where a tilted layer first meets the horizontal part base, its bead gap
// tapers to that base. Split at the full-gap crossing so the trapezoidal segment
// integration is exact for a planar reference. Later parallel planes are uniform.
function planeContactGaps(curves, { slice, heightMm }, bottom) {
  if(slice.kind==='patch')return curves;
  if(slice.kind==='height-field')return curves.map(curve=>{
    const gaps=curve.points.map(point=>Math.max(0,Math.min(heightMm,point[2]-bottom))*heightSliceNormal(slice,point)[2]);
    return {...curve,heightsMm:gaps.slice(1).map((gap,i)=>(gap+gaps[i])/2)};
  });
  if (horizontal(slice)) return curves;
  const cosine = slice.normal[2], ceiling = bottom + heightMm / cosine;
  return curves.map(curve => {
    if (curve.points.every(p => p[2] >= ceiling - PRINT_RESOLUTION_MM)) return curve;
    const source = curve.closed ? [...curve.points, curve.points[0]] : curve.points, points = [source[0]], heightsMm = [];
    const gap = point => Math.max(0, Math.min(heightMm, (point[2] - bottom) * cosine));
    for (let i = 1; i < source.length; i++) {
      const a = source[i - 1], b = source[i], cuts = [];
      if ((a[2] < ceiling && b[2] > ceiling) || (a[2] > ceiling && b[2] < ceiling)) {
        const t = (ceiling - a[2]) / (b[2] - a[2]);
        cuts.push(a.map((v, k) => v + t * (b[k] - v)));
      }
      cuts.push(b);
      for (const point of cuts) { heightsMm.push((gap(points.at(-1)) + gap(point)) / 2); points.push(point); }
    }
    const chartPoints=points.map(point=>[slice.xAxis,slice.yAxis].map(axis=>axis.reduce((sum,v,k)=>sum+v*(point[k]-slice.origin[k]),0)));
    return { ...curve, closed: false, points, heightsMm,chartPoints,normals:points.map(()=>slice.normal),frameSamples:chartPoints.map(point=>sliceFrame(slice,point)) };
  });
}

function sliceMaterialGeometry(slice,region,worldRegion,maxZ,process){
  const lineWidthMm=process.lineWidthMm;
  if(horizontal(slice))return {kind:'planar',loops:region,zMm:slice.origin[2],maxZ:slice.origin[2],lineWidthMm};
  if(slice.kind==='patch'||slice.kind==='surface-chart'||Math.abs(slice.normal?.[2]??1)<PRINT_RESOLUTION_MM/BUILD_SCALE_MM)return {kind:'bounds',maxZ};
  return {kind:'surface',loops:worldRegion,surface:slice,maxZ,lineWidthMm,sampleStepMm:0.5,sagMm:0};
}

// One owner's operations from its owned layers. spec: {id, settings, layers,
// material?: Map(index -> sliced material) for solid masks (the layers' own
// regions when absent), solidRegions?: Map(index -> loops) always filled
// solid, filament}; context: {process, shell, startMm, endMm, report}.
// One evaluated region-batch boundary for cut regions and reference stacks.
// Geometry strokes retain their chart/metric; gap adaptation precedes the same
// joining and bead construction for every Slice producer.
export function evaluateRegionBatch({id,batch,process,filament=null,contact=null,contactPlacement=null,contactGaps=null,baseZMm=null,sampleStepMm=.2}){
  const {reference,strokes,...construction}=batch;
  const mapped=mapSliceStrokes(strokes,reference,{frames:!contactPlacement,sampleStepMm});
  const placed=contactPlacement?contactCurveCourses(mapped,contactPlacement):{curves:mapped,spans:[]};
  const gapped=contactGaps?contactCurveGaps(placed.curves,{...contactGaps,contactRole:null,heightMm:batch.heightMm}):{curves:placed.curves,spans:[]};
  const opened=contact?gapped.curves.map(curve=>!curve.closed?curve:{...curve,closed:false,
    ...Object.fromEntries(['points','chartPoints','normals','frameSamples'].map(key=>[key,[...curve[key],curve[key][0]]]))}):null;
  const measured=contact?materialContact(opened,contact):null;
  const surfaced=contact?surfaceGapCurves(opened,{slice:reference,direction:measured.direction,distancesMm:measured.distancesMm}):null;
  const curves=surfaced?surfaced.curves:baseZMm!==null?planeContactGaps(gapped.curves,{slice:reference,heightMm:batch.heightMm},baseZMm):gapped.curves;
  const [operation]=depositCurveBatches({id,batches:[{...construction,curves,after:[...(construction.after??[]),...(measured?.after??[])]}],process,filament,sequential:false});
  return {operation,contactReport:measured?.report,contactSpans:[...placed.spans,...gapped.spans,...(surfaced?.spans??[])]};
}

export function sliceResult({ id, settings, layers, material = null, solidRegions = new Map(), filament = null,totalLayerCount=layers.length,contactSegments=[],otherStackContactSegments=[],seedSegments=[],contactFragments=[],predecessorReference=null,predecessorRegions=new Map(),substrateAdaptation=false,requiredContact=false }, { process, shell, startMm, endMm,report: extra = {} }) {
  const width = process.lineWidthMm, wallToleranceMm = process.planarWallToleranceMm;
  const solidDensity = 1;
  const maskLayers = material ? [...material].map(([index, region]) => ({ index, region })) : layers;
  const roles = settings.roles;
  let operations = [],nextFillState;const stackLayers=[], report = { depositionFamily:'slice',layers: 0, skippedLayers: 0, areaMm2: 0, loops: 0, fillRows: 0, solidAreaMm2: 0, ...extra };
  let previous = [];
  for (const layer of layers) {
    const {index,slice,region}=layer,z=slice.origin?.[2]??slice.offsetMm??0;
    const layerSettings={...settings,...layer.settings,...settings.sliceOverrides?.[layer.index],
      loops:settings.sliceOverrides?.[layer.index]?.loops??layer.settings?.loops??(Array.isArray(settings.loops)?settings.loops[layer.index%settings.loops.length]:settings.loops)};
    const pitch=lineSpacing(width,layerSettings),angles=layerSettings.fillAnglesDeg,angleAt=index=>layerSettings.rotateFill?angles[index%angles.length]:angles[0];
    const masked=layerSettings.fillDensity<1&&(layerSettings.solidTop>0||layerSettings.solidBottom>0||solidRegions.size>0);
    const area=loops=>!loops.length?0:slice.kind==='patch'?patchMeanNormal(slice.patch,loops,{sampleStepMm:layerSettings.sampleStepMm}).areaMm2:regionArea(loops);
    const regionAreaMm2=area(region);
    if (!regionAreaMm2) { report.skippedLayers++; continue; }
    const own = layer.material ?? region, outward = layer.outward ?? false;
    const solid = masked ? union(solidMasks(maskLayers, index, { bottomLayers: layerSettings.solidBottom, topLayers: layerSettings.solidTop }).solid,
      intersect(region, union(solidRegions.get(index) ?? [], []))) : null;
    const strokeSettings={ ...layerSettings, widthMm: width, fillAngleDeg: angleAt(index), solidDensity,direction:layer.direction,layer,supportSegments:seedSegments,
      patternAngleDeg: layerSettings.fillPattern === 'rectilinear' ? angleAt(index) : angles[0], phaseMm: z, wallToleranceMm, solid,
      material: own, outward,slice,loopBoundary:layer.loopBoundary??region,layer:{...layer,speedMmS:process.planarSpeedMmS},fillState:layer.fillState,layoutReference:layer.layoutReference??slice,wallToleranceMm:layerSettings.wallToleranceMm??wallToleranceMm };
    const strokes=layerStrokes(region,strokeSettings);
    nextFillState=strokes.nextFillState;
    if(strokes.constructionReport){
      report.fillOrder=strokes.constructionReport;
      if(strokes.constructionReport.notes?.length)report.notes=[...(report.notes??[]),...strokes.constructionReport.notes.map(note=>`Slice ${id} layer ${index}: ${note}`)];
    }
    const boundaries=mapSliceStrokes(strokes.walls,slice,{frames:true,sampleStepMm:layerSettings.sampleStepMm}).map(curve=>{
      const duplicate=curve.points.length>2&&Math.hypot(...curve.points[0].map((v,k)=>v-curve.points.at(-1)[k]))<=PRINT_RESOLUTION_MM;
      return !duplicate?curve:{...curve,closed:true,points:curve.points.slice(0,-1),chartPoints:curve.chartPoints.slice(0,-1),normals:curve.normals.slice(0,-1),frameSamples:curve.frameSamples.slice(0,-1)};
    });
    stackLayers.push({...layer,curves:boundaries,perimeters:strokes.walls,settings:layerSettings,process,widthMm:width,pitchMm:pitch,wallInsetMm:layerSettings.loopInsetMm??width/2,
      solidRegion:strokes.solidRegion,sparseRegion:strokes.sparseRegion,denseRegion:strokes.fill.length&&pitch<=width+PRINT_RESOLUTION_MM?strokes.solidRegion:[],fillCurves:strokes.fill,infillCurves:strokes.infill});
    const wallMaterial = () => loopMaterial(region, { widthMm: width, loops: layerSettings.loops, spacingFactor: layerSettings.spacingFactor }, { outward });
    report.solidAreaMm2 += area(strokes.solidRegion);
    report.loops += strokes.walls.length; report.fillRows += strokes.infill.length + strokes.fill.length;
    const ordinal=(extra.layerStartOrdinal??0)+report.layers;
    const speedMmS = (layer.onSubstrate?false:horizontal(slice) ? index === 0 : ordinal === 0) ? process.firstLayerSpeedMmS : process.planarSpeedMmS;
    const worldRegion = region.map(loop => loop.map(point => evaluateSurface(slice,point).point.slice(0, 2)));
    const maxZ = Math.max(...region.flatMap(loop => loop.map(point => evaluateSurface(slice,point).point[2])));
    const materialGeometry = sliceMaterialGeometry(slice,region,worldRegion,maxZ,process);
    const current = [];
    for (const [group, found] of [['walls', strokes.walls], ['infill', strokes.infill], ['fill', strokes.fill]]) {
      if (!found.length) continue;
      const spacing = group === 'infill' ? pitch / layerSettings.fillDensity : pitch / solidDensity;
      const opId = `${id}:${index}:${group}`;
      let covered;
      const framed=!layer.nominalThickness&&(slice.kind==='patch'||slice.kind==='height-field'||predecessorReference!==null||contactFragments.length>0||contactSegments.length>0||otherStackContactSegments.length>0);
      const evaluated=evaluateRegionBatch({id,batch:{key:`${index}:${group}`,reference:slice,strokes:found.map(stroke=>({...stroke,role:roles?.[stroke.role]??layerSettings.roles?.[stroke.role]??stroke.role})),heightMm:layer.heightMm,speedMmS},
        process,filament,sampleStepMm:layerSettings.sampleStepMm,baseZMm:framed||layer.nominalThickness||layer.contactPlacement?null:shell?.bounds.min[2]??null,contactPlacement:layer.contactPlacement,contactGaps:layer.nominalThickness&&!layer.contactPlacement&&contactSegments.length?{segments:contactSegments}:null,contact:framed?
          {id,layer,bounds:shell.bounds,support:{previousRegion:predecessorRegions.get(index)??[],previousSegments:contactSegments,surroundingSegments:otherStackContactSegments},
            contactFragments,predecessorReference,substrateAdaptation,required:requiredContact}:null});
      const deposited=evaluated.operation,lifted=deposited.strokes;
      const heights=lifted.flatMap(stroke=>stroke.points.map(point=>point[2])),top=Math.max(...heights),planarBatch=top-Math.min(...heights)<=PRINT_RESOLUTION_MM;
      const batchMaterial=layer.contactPlacement?(planarBatch?{kind:'planar',loops:worldRegion,zMm:top,maxZ:top,lineWidthMm:width}:{kind:'bounds',maxZ:top}):materialGeometry;
      const contactAfter=deposited.after;
      const measured=evaluated.contactReport;
      if(evaluated.contactSpans.length)report.notes=[...(report.notes??[]),...evaluated.contactSpans.map(span=>contactSpanNote(`Slice ${id} layer ${index}`,span))];
      if(measured){
        if(measured.notes?.length)report.notes=[...(report.notes??[]),...measured.notes];
        report.substrateContactQueries=(report.substrateContactQueries??0)+measured.queries;
        report.uncoveredContactSamples=(report.uncoveredContactSamples??0)+measured.uncoveredSamples;
        if(measured.samples){report.contactSamples=(report.contactSamples??0)+measured.samples;report.minContactGapMm=Math.min(report.minContactGapMm??Infinity,measured.minGapMm);report.maxContactGapMm=Math.max(report.maxContactGapMm??0,measured.maxGapMm);}
      }
      operations.push({ ...deposited,id: opId, layerId: horizontal(slice) ? 'planar:' + top : 'slice:' + sliceKey(slice), phase: planarBatch?'planar':'curves', layer: index, rank: top, after: [...new Set([...previous,...current,...contactAfter])],
        strokes: roles||layerSettings.roles ? lifted.map(stroke => ({ ...stroke, role: roles?.[stroke.role]??layerSettings.roles?.[stroke.role]??stroke.role })) : lifted, connectNearby:(layerSettings.connectNearby??!framed)&&(!layer.contactPlacement||planarBatch),layerIndex:ordinal,layerCount:totalLayerCount,stackDirection:layer.direction??slice.normal??[0,0,1],...(layerSettings.continuous?{continuous:true,regionId:id+':'+index}:{}),
        // Loops a boundary between owners cuts open are laid in the order found.
        order:layerSettings.order??(group === 'walls' ? (lifted.every(s => s.closed && !s.volumesMm3) ? 'nearest' : 'given') : lifted.every(s => s.scanlineCell !== undefined) ? 'nearest-cells' : 'given'), region: worldRegion, slice, ownershipIndex: index,
        // Coverage is consumed by material-region publication; built on first use.
        get materialRegion() {
          return covered ??= (slice.kind==='patch'||slice.kind==='surface-chart'?region:group === 'walls' ? wallMaterial()
            : fillMaterial(group === 'infill' ? strokes.sparseRegion : strokes.solidRegion, width)).map(loop => loop.map(point => evaluateSurface(slice,point).point.slice(0, 2)));
        },
        materialCoverage: group !== 'walls' && spacing > width + PRINT_RESOLUTION_MM ? 'sparse' : 'area',
        materialGeometry:batchMaterial, ...((Object.hasOwn(layerSettings.process??{},'fanPercent')||(horizontal(slice) ? index === 1 : ordinal === 1)) ? { fanPercent: process.fanPercent } : {}), ...(filament === null ? {} : { filament }) });
      current.push(opId);
    }
    previous = current;
    report.layers++; report.areaMm2 += regionAreaMm2;
  }
  if(layers.some(layer=>layer.slice.kind==='surface-chart')){report.areaChart2=report.areaMm2;report.solidAreaChart2=report.solidAreaMm2;delete report.areaMm2;delete report.solidAreaMm2;}
  const widths=operations.flatMap(operation=>operation.strokes.flatMap(stroke=>stroke.segmentMetadata?.map(m=>m.beadWidthMm).filter(Number.isFinite)??[]));
  if(widths.length){report.minBeadWidthMm=Math.min(...widths);report.maxBeadWidthMm=Math.max(...widths);}
  const coverage = layers.every(layer=>{const s={...settings,...layer.settings,...settings.sliceOverrides?.[layer.index]};return s.fillDensity>=1&&lineSpacing(width,s)<=width+PRINT_RESOLUTION_MM;}) ? 'nominal' : 'sparse';
  const segments=depositedBeadSegments(operations,{widthMm:width});
  if(!shell)return {id,operations,report,stackLayers,nextFillState};
  return publishFinishedBoundary({id,operations,report,stackLayers,nextFillState}, { shell, startMm, endMm, coverage,contains:({point})=>depositedBeadsContain(segments,point) });
}

// Every slice assignment uses the same ownership, layer and result route.
// -> {contexts, notes}: notes say what the stacks could not cover (sectionNotes).
// envelopes: [{part, solidRegionAt(z)}] regions a process (a plastic-weld
// rivet) needs solid in the slices of its part.

// Solid chart fill uses the same region-to-stroke kernels as Slice. It owns no
// stack, reservation or lifecycle; extensions submit the returned curves to Trace.
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

// Boundary geometry for extensions that trace curves across a reference stack.
// It uses the same ownership, region and physical loop operation as Slice.

export function sliceContextResult(record,{layerIndex=null,priorResults=[],substrateAdaptation=false,contactSegments=[],otherStackContactSegments=[],seedSegments=[],contactFragments=[],predecessorReference=null,requiredContact=false}={}){
  record=resolveSliceStack(record,priorResults,{substrateAdaptation});
  const layers=layerIndex===null?record.spec.layers:record.spec.layers.filter(layer=>layer.index===layerIndex);
  requireThat(layers.length,'Slice construction context has no requested layer.');
  const own=priorResults.filter(result=>result.report?.owner===record.owner.assignment.id||result.id===record.spec.id);
  const previous=own.at(-1),segments=substrateAdaptation?priorResults.flatMap(result=>depositedBeadSegments(result.operations)):[];
  const selected=layers.map(layer=>({...layer,fillState:previous?.nextFillState,
    contactPlacement:layer.contactPlacement?{...layer.contactPlacement,segments,ceilingMm:depositedBeadBounds(segments).max[2]}:null}));
  const context=layerIndex===null?record.context:{...record.context,report:{...record.context.report,layerStartOrdinal:record.spec.layers.findIndex(layer=>layer.index===layerIndex)}};
  const result=sliceResult({...record.spec,layers:selected,contactSegments,otherStackContactSegments,seedSegments,contactFragments,predecessorReference,substrateAdaptation,requiredContact},context);
  return {...result,referenceStack:{...record.referenceStack,layers:result.stackLayers},stackId:record.stackId};
}
