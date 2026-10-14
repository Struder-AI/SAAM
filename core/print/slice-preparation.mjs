// Material preparation resolves layout before Toolpath constructs deposition.
import {PRINT_RESOLUTION_MM} from '../dimensions.mjs';
import {solidMasks} from '../region/layer-region.mjs';
import {sliceLayerLayout,layerStrokes} from '../region/layer-strokes.mjs';
import {lineSpacing} from '../path/spacing.mjs';
import {intersect,union} from '../region/intersection.mjs';
import {evaluateSurface} from '../geom/surface-evaluation.mjs';
import {surfaceChartBounds,surfaceChartStep} from '../region/surface-operations.mjs';
import {prepareSurfaceRay,surfaceRayIntersections} from '../geom/surface-ray.mjs';
import {sampledChartRegion} from '../geom/height-slice.mjs';
import {pointInRegion} from '../region/region2d.mjs';

// A front's seed is an upstream material footprint, never finalized beads.
export function prepareFrontSeed(layer,{predecessors=[],bedZMm=null,sampleStepMm=.2,toleranceMm=.01}={}){
  const bounds=surfaceChartBounds(layer.slice,layer.region.flat()),direction=layer.direction??[0,0,1];
  const queries=predecessors.map(source=>({region:source.region,query:prepareSurfaceRay(source.slice,direction,{points:source.region.flat(),sampleStepMm})}));
  const advance=layer.translationMm??layer.gap?.advanceMm??layer.heightMm;
  return sampledChartRegion({min:bounds.map(b=>b[0]),max:bounds.map(b=>b[1])},surfaceChartStep(layer.slice,bounds,sampleStepMm),uv=>{
    if(!pointInRegion(uv,layer.region))return false;
    const e=evaluateSurface(layer.slice,uv),maxDistanceMm=advance+toleranceMm;
    if(bedZMm!==null&&direction[2]>0){const distance=(e.point[2]-bedZMm)/direction[2];if(distance>=-toleranceMm&&distance<=maxDistanceMm)return true;}
    return queries.some(({query,region})=>surfaceRayIntersections(query,e.point).some(hit=>hit.distanceMm>=-toleranceMm&&hit.distanceMm<=maxDistanceMm&&pointInRegion(hit.chartPoint,region)));
  },{surface:layer.slice});
}
// Nominal layout is shared by Slice and extension preparation. It contains no
// deposited strokes, modulation results or execution state.
export function prepareSliceLayer({settings,layers,material=null,solidRegions=new Map()},{process},layer){
  const {index,slice,region}=layer,width=process.lineWidthMm;
  const resolved={...settings,...layer.settings,...settings.sliceOverrides?.[index],
    loops:settings.sliceOverrides?.[index]?.loops??layer.settings?.loops??(Array.isArray(settings.loops)?settings.loops[index%settings.loops.length]:settings.loops)};
  const pitch=lineSpacing(width,resolved),angles=resolved.fillAnglesDeg,angleAt=index=>resolved.rotateFill?angles[index%angles.length]:angles[0];
  const masked=resolved.fillDensity<1&&(resolved.solidTop>0||resolved.solidBottom>0||solidRegions.size>0);
  const maskLayers=material?[...material].map(([index,region])=>({index,region})):layers;
  const solid=masked?union(solidMasks(maskLayers,index,{bottomLayers:resolved.solidBottom,topLayers:resolved.solidTop}).solid,
    intersect(region,union(solidRegions.get(index)??[],[]))):null;
  const strokeSettings={...resolved,widthMm:width,fillAngleDeg:angleAt(index),solidDensity:1,direction:layer.direction,
    patternAngleDeg:resolved.fillPattern==='rectilinear'?angleAt(index):angles[0],phaseMm:slice.origin?.[2]??slice.offsetMm??0,
    solid,material:layer.material??region,outward:layer.outward??false,slice,loopBoundary:layer.loopBoundary??region,
    layer:{...layer,speedMmS:process.planarSpeedMmS},fillState:layer.fillState,layoutReference:layer.layoutReference??slice,
    wallToleranceMm:resolved.wallToleranceMm??process.planarWallToleranceMm};
  const layout=sliceLayerLayout(region,strokeSettings);
  return {...layer,settings:resolved,process,widthMm:width,pitchMm:pitch,wallInsetMm:resolved.loopInsetMm??width/2,
    perimeters:layout.walls,solidRegion:layout.solidRegion,sparseRegion:layout.sparseRegion,
    denseRegion:pitch<=width+PRINT_RESOLUTION_MM?layout.solidRegion:[],strokeSettings,preparedLayout:layout};
}

