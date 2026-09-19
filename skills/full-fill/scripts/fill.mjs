// full-fill: solid planar layers for any closed shell.
//
// Each layer is the shell's own section at that height, so the pattern follows
// whatever the part actually is rather than a parameterised outline. Perimeter
// loops are inward offsets of that section; the interior is filled solid at the
// bead spacing, with the fill direction alternating between layers.
//
// When a draped skin is also being printed, the body must stop short of the top
// surface by the skin's thickness. That reservation arrives as a height field
// and is applied by intersecting each layer with the level set where the
// reserved surface is still above the layer - the general form of a flat
// "core plane" reservation.

import { composeResults } from '../../../core/path/compose.mjs';
import { createSectionQuery } from '../../../core/geom/query.mjs';
import { scanlineFill, regionArea, loopArea, pointInRegion } from '../../../core/region/region2d.mjs';
import { offsetRegion } from '../../../core/region/offset.mjs';
import { perimeterLoops } from '../../../core/region/perimeters.mjs';
import { difference, union } from '../../../core/region/boolean.mjs';
import {lineSpacing} from '../../../core/path/spacing.mjs';
import { planarPolicy } from '../../../core/path/builder.mjs';
import { requireThat, distance2, TOLERANCE } from '../../../core/geom/tolerance.mjs';
import {clipReservedRegion,clipAboveSurface,surfaceStroke} from '../../../core/region/reservation.mjs';
import {cleanPlanarLoop} from '../../../core/geom/polyline.mjs';
import {planarWallTolerance} from '../../../core/machine/rules.mjs';

export const FULL_FILL_DEFAULTS = {
  spacingFactor: 1,
  mode: 'body',
  bottomLayers: 3,
  topLayers: 3,
  perimeters: 2,
  perimeterScope: 'all',
  holeLineWidthMm: null,
  fillAnglesDeg: [45, 135],
  fillOverlap: 0.15,
  minFeatureMm: 0.4
};

// Layer heights from the first layer up to the top of what this skill prints.
// The part's height and the layer height decide how many there are; a tall or
// finely layered part is sliced, never refused. A non-advancing layer height
// would never reach the top, so it is rejected as an invalid process.
export function layerHeights(process, fromMm, toMm) {
  requireThat(Number.isFinite(process.layerMm) && process.layerMm > 0 && Number.isFinite(process.firstLayerMm),
    'Layer heights need a positive layer height; this process would never advance.');
  const heights = [];
  for (let index = 0; ; index++) {
    const z = fromMm + process.firstLayerMm + index * process.layerMm;
    if (z > toMm + 1e-9) break;
    heights.push(z);
  }
  return heights;
}

export function fullFillResult({ shell, plan, machine, reserve = null, id = 'full-fill', settings: overrides={}, spacingMm=null, interiorRegion=null, interiorStrokes=null, sectionAt=null, regionAt=null, fillRegionAt=null, zStartMm=null, zEndMm=null, layerOriginMm=null, layerIndexOffset=0, lowerSurface=null, detailsMode='deposit', onProgress }) {
  const operations=[];
  let previous=[];
  const process = plan.process, settings = { ...FULL_FILL_DEFAULTS, ...plan.skills['full-fill'],...overrides };
  sectionAt??=createSectionQuery(shell,{minFeatureMm:settings.minFeatureMm});
  const width = process.lineWidthMm,wallToleranceMm=planarWallTolerance(machine);
  const pitch=lineSpacing(width,settings),fillSpacing=spacingMm??pitch;
  const top = Math.min(shell.bounds.max[2],zEndMm??Infinity);
  const origin=layerOriginMm??shell.bounds.min[2];
  const heights = layerHeights(process, origin, top).filter(z=>z>(zStartMm??-Infinity)+1e-9);
  const reserves=Array.isArray(reserve)?reserve:[reserve].filter(Boolean);
  requireThat(heights.length > 0, 'No planar layers fit below the reserved surface; the part is thinner than one layer.');

  const report = { layers: 0, skippedLayers: 0, unclippedLayers: 0, areaMm2: 0, perimeterLoops: 0, fillRows: 0, nudgedLayers: 0 };
  // Identical XY sections recur throughout prisms and conventional supports.
  // Cache only this invocation's fixed-setting construction, by exact content;
  // layer heights, patterns, volumes and travel remain layer-local.
  const contours=new Map();
  let completed=0;
  const stage=settings.perimeters?'Planning walls and infill':'Planning solid layers';
  for (const z of heights) {
    onProgress?.({stage,completed:completed++,total:heights.length});
    const localIndex=Math.round((z-origin-process.firstLayerMm)/process.layerMm),index=localIndex+layerIndexOffset;
    const height = localIndex === 0 ? process.firstLayerMm : process.layerMm;
    const speed = localIndex === 0 ? process.firstLayerSpeedMmS : process.planarSpeedMmS;
    const section = sectionAt(z);
    if (section.nudgedByMm) report.nudgedLayers++;
    // Below the reserved surface the body prints solid; where the skin has
    // claimed the material, the body stops. A layer entirely below the reserve
    // needs no clipping at all, which is the common case low down in the part.
    let region = regionAt ? regionAt(z,localIndex) : section.loops;
    if(!regionAt){
      if(lowerSurface)region=clipAboveSurface(region,z,lowerSurface);
      for(const reservation of reserves)region=clipReservedRegion(region,z,reservation);
    }
    for(const reservation of shell.processReservations??[])region=clipReservedRegion(region,z,reservation);
    if(reserves.length&&Math.abs(regionArea(region)-regionArea(section.loops))<1e-8)report.unclippedLayers++;
    if (!region.length || regionArea(region) < width * width) { report.skippedLayers++; continue; }


    const detail=shell.planarDetails?.at(region,z,{widthMm:width,perimeters:settings.perimeters,pitchMm:pitch});
    const key=JSON.stringify([region,detail?.reservation]);
    let prepared=contours.get(key);
    if(!prepared){
      const walls=[],holeWidth=settings.holeLineWidthMm,holePitch=holeWidth===null?null:lineSpacing(holeWidth,settings);
      for (let ring = 0; ring < settings.perimeters; ring++) {
        const ordinary = perimeterLoops(region, width / 2 + ring * pitch);
        const loops = holeWidth===null?ordinary:[
          ...ordinary.filter(loop=>loopArea(loop)>0).map(loop=>({loop,beadWidthMm:width})),
          ...perimeterLoops(region,holeWidth/2+ring*holePitch).filter(loop=>loopArea(loop)<0).map(loop=>({loop,beadWidthMm:holeWidth}))
        ];
        if (!loops.length) break;
        // Simplify only the finished deposition contour to machine precision.
        // The original offset region continues to own material topology.
        const entries=holeWidth===null?loops.map(loop=>({loop,beadWidthMm:width})):loops;
        const holes=entries.filter(entry=>loopArea(entry.loop)<0).map(entry=>entry.loop);
        for (const {loop,beadWidthMm} of entries) if(!detail?.ownsWall(loop)&&(settings.perimeterScope==='all'||(loopArea(loop)>0&&!holes.some(hole=>pointInRegion(loop[0],[hole])))))walls.push({ role: ring === 0 ? 'perimeter' : 'perimeter-inner', closed: true, points: cleanPlanarLoop(loop,wallToleranceMm===0?TOLERANCE.plane:wallToleranceMm),beadWidthMm });
      }
      // Fill starts half a bead inside the last perimeter, less the overlap that
      // welds fill to perimeter.
      const inset = width * (settings.perimeters + 0.5 - settings.fillOverlap) - width / 2
        + Math.max(0,settings.perimeters-1)*(pitch-width);
      prepared={walls,interior:fillRegionAt?null:offsetRegion(detail?.interiorBoundary??region,settings.perimeters>0?-(width/2+inset):-width/2)};
      contours.set(key,prepared);
      if(contours.size>16)contours.delete(contours.keys().next().value);
    }
    const strokes=[...prepared.walls,...(detailsMode==='deposit'&&detail?[...detail.walls,...detail.fins]:[])];
    report.perimeterLoops+=strokes.filter(s=>s.closed).length;
    let fillRegion = fillRegionAt ? fillRegionAt(region,localIndex,z) : prepared.interior;
    if(detail?.fillExclusion.length)fillRegion=difference(fillRegion,offsetRegion(detail.fillExclusion,width/2));
    if(interiorRegion)fillRegion=interiorRegion(fillRegion,localIndex,z,region);
    const angle = settings.fillAnglesDeg[index % settings.fillAnglesDeg.length];
    const rows = fillRegion.length && !interiorStrokes ? scanlineFill(fillRegion, fillSpacing, angle) : [];
    report.fillRows += rows.length;
    // Alternate direction down the rows so consecutive strokes end where the
    // next one starts; the travel planner then joins or combs instead of hopping.
    rows.forEach((row, position) => {
      const points = position % 2 ? [row.to, row.from] : [row.from, row.to];
      strokes.push({ role: 'fill', closed: false, points, scanlineCell:row.cellId });
    });
    if(fillRegion.length&&interiorStrokes){
      const generated=interiorStrokes(fillRegion,localIndex,z);
      strokes.push(...generated.map(stroke=>({...stroke,role:'fill'})));
      report.fillRows+=generated.length;
    }

    // Empty solid/interface layers have no travel; retain their report and dependency updates.
    const policy = strokes.length ? planarPolicy(region, {
      layerZ: z,
      liftMm: process.liftMm,
      maxCombMm: process.maxCombMm,
      lineWidthMm: width
    }) : null;
    const current=[];
    for(const [role,closed] of [['walls',true],['fins',false],['fill',false]]) {
      const selected=strokes.filter(stroke=>role==='walls'?stroke.closed&&stroke.role!=='fill':role==='fins'?stroke.localDetail==='fin':stroke.role==='fill').map(stroke=>lowerSurface?{
        ...stroke,...surfaceStroke({points2d:stroke.points,z,nominalHeightMm:height,widthMm:stroke.beadWidthMm??width,surface:lowerSurface,closed:stroke.closed,maxStepMm:Math.min(0.2,settings.minFeatureMm/2)}),speedMmS:speed
      }:{...stroke,points:(stroke.closed&&stroke.role==='fill'?[...stroke.points,stroke.points[0]]:stroke.points).map(point=>[...point,z]),speedMmS:speed,beadAreaMm2:(stroke.beadWidthMm??width)*height});
      if(!selected.length)continue;
      const operationId=id+':'+index+':'+role;
      // Coverage is consumed by material-region publication, not ordinary
      // composition. Construct it on first use and retain it for that result.
      let materialRegion;
      operations.push({id:operationId,layerId:'planar:'+z,phase:'planar',layer:index,rank:z,
        after:[...previous,...current],strokes:selected,
        order:closed&&!lowerSurface?'nearest':!closed&&selected.every(s=>s.scanlineCell!==undefined)?'nearest-cells':'given',region,
        get materialRegion(){const boundary=detail?.interiorBoundary??region;return materialRegion??=role==='fins'?detail.finRegion:closed?union(detail?.wallRegion??[],pitch===width?difference(boundary,offsetRegion(boundary,-width*settings.perimeters)):
          union(Array.from({length:settings.perimeters},(_,ring)=>difference(ring?offsetRegion(boundary,-ring*pitch):boundary,offsetRegion(boundary,-ring*pitch-width))).flat(),[])):
          // Coverage participates in booleans: a coarse round-join chord can
          // leave artificial corner gaps despite the requested wall overlap.
          (fillRegion.length?offsetRegion(fillRegion,width/2,{arcToleranceMm:TOLERANCE.chord}):[]);},
        materialCoverage:role==='fill'&&fillSpacing>width+1e-8?'sparse':'area',
        travelPolicy:policy,
        ...(index===1?{fanPercent:process.fanPercent}:{})});
      current.push(operationId);
    }
    previous=current;
    report.layers++;
    report.areaMm2 += regionArea(region);
  }
  onProgress?.({stage,completed,total:heights.length});
  requireThat(!reserves.length || report.layers > 0,
    'No planar layers fit below the reserved surface; the reserved skin leaves no printable body.');
  return {id,operations,report};
}

// Compatibility callable, using the same result/composition implementation.
export function generateFullFill(builder,options){
  const result=fullFillResult(options);
  composeResults(builder,[result]);
  return result.report;
}
