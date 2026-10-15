// Every extension host supplies these same CAD operations. Backend loading and
// native objects stay here; callers supply ordinary geometry and explicit options.
import {rhino} from './runtime.mjs';
import {buildShell,resolveGeometrySelections,resolveMaterialGeometry,translateShell} from './build.mjs';
import {booleanShell as combineSolids} from './boolean-solid.mjs';
import {constructSolids} from './solid-operations.mjs';
import {makeMesh} from './mesh.mjs';
import {mappedRegionMaterial} from './mapped-region-material.mjs';
import {textOutlines} from './text-outline.mjs';
import {textLayout} from './text-layout.mjs';
import {matchCurveControls} from './curve-controls.mjs';
import {ribbon} from './curve-material.mjs';
import {loftPolygons} from './loft.mjs';
import {topAt,createSectionQuery,containsPoint} from './query.mjs';
import {closeMeshPatchToPlane} from './mesh-patch-solid.mjs';
import {horizontalSlice,planeSlice,patchSlice,sliceStack} from './slice.mjs';
import {section,prepareSection} from '../region/section.mjs';
import {offsetRegion} from '../region/offset.mjs';
import {difference,intersect,union} from '../region/intersection.mjs';
import {regionArea,loopArea,pointSegmentDistance} from '../region/region2d.mjs';
import {clipLineToRegion,clipPlanarCurveToRegion} from './curve-region.mjs';
import {intersectSurfaceSheet,offsetSliceRegion,strokeSliceRegion,clipSliceCurves} from '../region/surface-operations.mjs';
import {evaluateSurface,mappedSurface} from './surface-evaluation.mjs';
import {surfaceDerivatives} from './surface-derivatives.mjs';
import {surfaceIsoCurve,curvePoint} from './surface-curves.mjs';
import {sampleCurveIntervals} from './curve-sampling.mjs';
import {sampleSpatialCurve,distinctPolyline,curveLength} from './spatial-curve.mjs';
import {transportCurveFrames} from './curve-frame.mjs';
import {prepareContourSleeve} from './sleeve/contour-sleeve.mjs';
import {detectMeshSleeveInterval} from './sleeve/mesh-sleeve.mjs';
import {strokeTopology,widenPlanarStrokes} from './stroke-topology.mjs';
import {referenceSurface} from './reference-surface.mjs';
import {surfaceRegion} from './surface-region.mjs';
import {prepareSolidDistance,solidDistance} from './solid-distance.mjs';
import {extrudedSegmentBounds,extrudedSegmentsContain,raycastExtrudedSegments,prepareExtrudedSegmentQuery} from './extruded-segments.mjs';
import {rodFrame,point} from './frame.mjs';
import {convexVolume} from './convex-clearance.mjs';
import {geometrySelections} from './selections.mjs';

async function buildGeometry(geometry){return buildShell(await rhino(),geometry,{native:false});}
const operations=Object.freeze({buildGeometry,combineSolids,constructSolids,makeMesh,convexVolume,rodFrame,point,geometrySelections,
    resolveGeometrySelections,resolveMaterialGeometry,translateShell,mappedRegionMaterial,textOutlines,textLayout,
    matchCurveControls,ribbon,loftPolygons,topAt,createSectionQuery,containsPoint,
    closeMeshPatchToPlane,horizontalSlice,planeSlice,patchSlice,sliceStack,section,prepareSection,
    offsetRegion,difference,intersect,union,regionArea,loopArea,pointSegmentDistance,
    clipLineToRegion,clipPlanarCurveToRegion,intersectSurfaceSheet,offsetSliceRegion,strokeSliceRegion,clipSliceCurves,
    evaluateSurface,mappedSurface,surfaceDerivatives,surfaceIsoCurve,curvePoint,sampleCurveIntervals,
    sampleSpatialCurve,distinctPolyline,curveLength,transportCurveFrames,
    prepareContourSleeve,detectMeshSleeveInterval,strokeTopology,widenPlanarStrokes,
    referenceSurface,surfaceRegion,prepareSolidDistance,solidDistance,
    extrudedSegmentBounds,extrudedSegmentsContain,raycastExtrudedSegments,prepareExtrudedSegmentQuery});

export function geometryOperations(){return operations;}
