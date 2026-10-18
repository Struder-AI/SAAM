// Material preparation resolves layout before Toolpath constructs deposition.
import {PRINT_RESOLUTION_MM} from '../dimensions.mjs';
import {solidMasks} from '../region/layer-region.mjs';
import {sliceLayerLayout,layerStrokes} from '../region/layer-strokes.mjs';
import {lineSpacing} from '../path/spacing.mjs';
import {intersect,union} from '../region/intersection.mjs';

// Nominal layout is shared by Slice and extension preparation. It contains no
// deposited strokes, modulation results or execution state.
export function prepareSliceLayer({settings,layers,material=null,solidRegions=new Map()},{process},layer){
  const {index,slice,region}=layer,width=process.lineWidthMm,characterIndex=layer.characterIndex??index;
  const resolved={...settings,...layer.settings,...settings.sliceOverrides?.[characterIndex],
    loops:settings.sliceOverrides?.[characterIndex]?.loops??layer.settings?.loops??(Array.isArray(settings.loops)?settings.loops[characterIndex%settings.loops.length]:settings.loops)};
  const pitch=lineSpacing(width,resolved),angles=resolved.fillAnglesDeg,angleAt=index=>resolved.rotateFill?angles[index%angles.length]:angles[0];
  const masked=resolved.fillDensity<1&&(resolved.solidTop>0||resolved.solidBottom>0||solidRegions.size>0);
  const maskLayers=layer.materialGrid?.layers??(material?[...material].map(([index,region])=>({index,region})):layers);
  const solid=masked?union(solidMasks(maskLayers,layer.materialGrid?.index??index,{bottomLayers:resolved.solidBottom,topLayers:resolved.solidTop}).solid,
    intersect(region,union(solidRegions.get(index)??[],[]))):null;
  const strokeSettings={...resolved,widthMm:width,fillAngleDeg:angleAt(characterIndex),solidDensity:1,direction:layer.patternDirection??layer.direction,
    patternAngleDeg:resolved.fillPattern==='rectilinear'?angleAt(characterIndex):angles[0],phaseMm:layer.offsetMm??0,
    solid,material:layer.material??region,outward:layer.outward??false,slice,loopBoundary:layer.loopBoundary??region,
    layer:{...layer,speedMmS:process.planarSpeedMmS},fillState:layer.fillState,layoutReference:layer.layoutReference??slice,
    wallToleranceMm:resolved.wallToleranceMm??process.planarWallToleranceMm};
  const layout=sliceLayerLayout(region,strokeSettings);
  return {...layer,settings:resolved,process,widthMm:width,pitchMm:pitch,wallInsetMm:resolved.loopInsetMm??width/2,
    perimeters:layout.walls,solidRegion:layout.solidRegion,sparseRegion:layout.sparseRegion,
    denseRegion:pitch<=width+PRINT_RESOLUTION_MM?layout.solidRegion:[],strokeSettings,preparedLayout:layout};
}

