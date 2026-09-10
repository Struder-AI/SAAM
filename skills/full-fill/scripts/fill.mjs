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
// reserved surface is still above the layer - the general form of the wedge
// demo's flat "core plane".

import { composeResults } from '../../../core/path/compose.mjs';
import { sectionGeometry as sectionShell } from '../../../core/geom/query.mjs';
import { scanlineFill, regionArea } from '../../../core/region/region2d.mjs';
import { offsetRegion } from '../../../core/region/offset.mjs';
import { perimeterLoops } from '../../../core/region/perimeters.mjs';
import { difference } from '../../../core/region/boolean.mjs';
import { planarPolicy } from '../../../core/path/builder.mjs';
import { requireThat, distance2, TOLERANCE } from '../../../core/geom/tolerance.mjs';
import {clipReservedRegion,clipAboveSurface,surfaceStroke} from '../../../core/region/reservation.mjs';
import {cleanPlanarLoop} from '../../../core/geom/polyline.mjs';

export const FULL_FILL_DEFAULTS = {
  mode: 'body',
  bottomLayers: 3,
  topLayers: 3,
  perimeters: 2,
  fillAnglesDeg: [45, 135],
  fillOverlap: 0.15,
  minFeatureMm: 0.4
};

// Layer heights from the first layer up to the top of what this skill prints.
export function layerHeights(process, fromMm, toMm) {
  const heights = [];
  for (let index = 0; ; index++) {
    const z = fromMm + process.firstLayerMm + index * process.layerMm;
    if (z > toMm + 1e-9) break;
    heights.push(z);
    if (heights.length > 20000) throw new Error('Layer count exceeds the supported limit.');
  }
  return heights;
}

export function fullFillResult({ shell, plan, reserve = null, id = 'full-fill', settings: overrides={}, spacingMm=null, interiorRegion=null, interiorStrokes=null, sectionAt=null, zStartMm=null, zEndMm=null, lowerSurface=null }) {
  const operations=[];
  let previous=[];
  const process = plan.process, settings = { ...FULL_FILL_DEFAULTS, ...plan.skills['full-fill'],...overrides };
  const width = process.lineWidthMm;
  const top = Math.min(shell.bounds.max[2],zEndMm??Infinity);
  const heights = layerHeights(process, shell.bounds.min[2], top).filter(z=>z>(zStartMm??-Infinity)+1e-9);
  const reserves=Array.isArray(reserve)?reserve:[reserve].filter(Boolean);
  requireThat(heights.length > 0, 'No planar layers fit below the reserved surface; the part is thinner than one layer.');

  const report = { layers: 0, skippedLayers: 0, unclippedLayers: 0, areaMm2: 0, perimeterLoops: 0, fillRows: 0, nudgedLayers: 0 };
  for (const z of heights) {
    const index=Math.round((z-shell.bounds.min[2]-process.firstLayerMm)/process.layerMm);
    const height = index === 0 ? process.firstLayerMm : process.layerMm;
    const speed = index === 0 ? process.firstLayerSpeedMmS : process.planarSpeedMmS;
    const section = sectionAt?sectionAt(z):sectionShell(shell, z, { minFeatureMm: settings.minFeatureMm });
    if (section.nudgedByMm) report.nudgedLayers++;
    // Below the reserved surface the body prints solid; where the skin has
    // claimed the material, the body stops. A layer entirely below the reserve
    // needs no clipping at all, which is the common case low down in the part.
    let region = section.loops;
    if(lowerSurface)region=clipAboveSurface(region,z,lowerSurface);
    for(const reservation of reserves)region=clipReservedRegion(region,z,reservation);
    if(reserves.length&&Math.abs(regionArea(region)-regionArea(section.loops))<1e-8)report.unclippedLayers++;
    if (!region.length || regionArea(region) < width * width) { report.skippedLayers++; continue; }


    const strokes = [];
    for (let ring = 0; ring < settings.perimeters; ring++) {
      const loops = perimeterLoops(region, width / 2 + ring * width);
      if (!loops.length) break;
      // Offset rounding can reintroduce numerical seams. Retain the offset
      // region for topology operations and clean only its deposition contour.
      for (const loop of loops) strokes.push({ role: ring === 0 ? 'perimeter' : 'perimeter-inner', closed: true, points: cleanPlanarLoop(loop) });
      report.perimeterLoops += loops.length;
    }
    // Fill starts half a bead inside the last perimeter, less the overlap that
    // welds fill to perimeter.
    const inset = width * (settings.perimeters + 0.5 - settings.fillOverlap) - width / 2;
    let fillRegion = settings.perimeters > 0 ? offsetRegion(region, -(width / 2 + inset)) : offsetRegion(region,-width/2);
    if(interiorRegion)fillRegion=interiorRegion(fillRegion,index,z,region);
    const angle = settings.fillAnglesDeg[index % settings.fillAnglesDeg.length];
    const rows = fillRegion.length && !interiorStrokes ? scanlineFill(fillRegion, spacingMm??width, angle) : [];
    report.fillRows += rows.length;
    // Alternate direction down the rows so consecutive strokes end where the
    // next one starts; the travel planner then joins or combs instead of hopping.
    rows.forEach((row, position) => {
      const points = position % 2 ? [row.to, row.from] : [row.from, row.to];
      strokes.push({ role: 'fill', closed: false, points, scanlineCell:row.cellId });
    });
    if(fillRegion.length&&interiorStrokes){
      const generated=interiorStrokes(fillRegion,index,z);
      strokes.push(...generated.map(stroke=>({...stroke,role:'fill'})));
      report.fillRows+=generated.length;
    }

    const policy = planarPolicy(region, {
      layerZ: z,
      liftMm: process.liftMm,
      maxCombMm: process.maxCombMm,
      lineWidthMm: width
    });
    const current=[];
    for(const [role,closed] of [['walls',true],['fill',false]]) {
      const selected=strokes.filter(stroke=>closed?stroke.role!=='fill':stroke.role==='fill').map(stroke=>lowerSurface?{
        ...stroke,...surfaceStroke({points2d:stroke.points,z,nominalHeightMm:height,widthMm:width,surface:lowerSurface,closed:stroke.closed,maxStepMm:Math.min(0.2,settings.minFeatureMm/2)}),speedMmS:speed
      }:{...stroke,points:(stroke.closed&&stroke.role==='fill'?[...stroke.points,stroke.points[0]]:stroke.points).map(point=>[...point,z]),speedMmS:speed,beadAreaMm2:width*height});
      if(!selected.length)continue;
      const operationId=id+':'+index+':'+role;
      operations.push({id:operationId,layerId:'planar:'+z,phase:'planar',layer:index,rank:z,
        after:[...previous,...current],strokes:selected,
        order:closed&&!lowerSurface?'nearest':!closed&&selected.every(s=>s.scanlineCell!==undefined)?'nearest-cells':'given',region,
        materialRegion:closed?difference(region,offsetRegion(region,-width*settings.perimeters)):
          // Coverage participates in booleans: a coarse round-join chord can
          // leave artificial corner gaps despite the requested wall overlap.
          (fillRegion.length?offsetRegion(fillRegion,width/2,{arcToleranceMm:TOLERANCE.chord}):[]),
        materialCoverage:!closed&&(spacingMm??width)>width+1e-8?'sparse':'area',
        travelPolicy:policy,clearanceZ:z+process.liftMm,
        ...(index===1?{fanPercent:process.fanPercent}:{})});
      current.push(operationId);
    }
    previous=current;
    report.layers++;
    report.areaMm2 += regionArea(region);
  }
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
