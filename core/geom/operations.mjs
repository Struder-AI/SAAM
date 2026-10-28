import {prepareSurfaceRay,surfaceRayIntersections} from './surface-ray.mjs';
import {enclosedAxialProfile} from './enclosed-profile.mjs';
import * as dimensions from '../dimensions.mjs';
import {PRINT_RESOLUTION_MM} from '../dimensions.mjs';
import {randomUUID} from 'node:crypto';
import {getObservationFlow,observeContractValue} from '../contracts/observations.mjs';
import {numericalGeometryRecord} from './surface-record.mjs';
import {curvePairSurface,closedEdgeSpans} from './edge-surface.mjs';
// Every extension host supplies these same CAD operations. Backend loading and
// native objects stay here; callers supply ordinary geometry and explicit options.
import {compileBlobField} from './blob-field-compile.mjs';
import {buildShell,prepareGeometrySelections,resolveGeometrySelections,resolveMaterialGeometry,translateShell} from './build.mjs';
import {booleanShell as combineSolids} from './boolean-solid.mjs';
import {constructSolids,constructGeometry,materialPresence} from './solid-operations.mjs';
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
import {surfaceCurveImages} from './surface-curve-image.mjs';
import {sampleCurveIntervals} from './curve-sampling.mjs';
import {sampleSpatialCurve,trimSpatialCurve,distinctPolyline,curveLength} from './spatial-curve.mjs';
import {modelEdges} from './model-edges.mjs';
import {curveSliceContacts} from './curve-slices.mjs';
import {transportCurveFrames} from './curve-frame.mjs';
import {prepareContourSleeve} from './sleeve/contour-sleeve.mjs';
import {detectMeshSleeveInterval} from './sleeve/mesh-sleeve.mjs';
import {strokeTopology,widenPlanarStrokes} from './stroke-topology.mjs';
import {referenceSurface,selectedFace} from './reference-surface.mjs';
import {surfaceRegion} from './surface-region.mjs';
import {prepareSolidDistance,solidDistance,solidNormal} from './solid-distance.mjs';
import {extrudedSegmentBounds,extrudedSegmentsContain,raycastExtrudedSegments,prepareExtrudedSegmentQuery} from './extruded-segments.mjs';
import {rodFrame,point} from './frame.mjs';
import {convexVolume} from './convex-clearance.mjs';
import {revolvedProfile} from './revolved-profile.mjs';
import {loftProfiles,roundedRectangleProfile,transformGeometry} from './solid-profiles.mjs';
import {geometrySelections} from './selections.mjs';
import {extendSurface} from './surface-extend.mjs';

function buildGeometry(geometry){return buildShell(null,geometry,{native:false});}
function observedSurfaceCurveImages(patch,definition,options={}){
  if(!getObservationFlow())return surfaceCurveImages(patch,definition,options);
  const occurrenceId=randomUUID(),toleranceMm=options.toleranceMm??PRINT_RESOLUTION_MM/4;
  const captured={request:null};
  try{captured.request=observeContractValue({wireId:'query-representation',phase:'request',typeId:'geometry-request',
    implementationSchema:'saam-uv-image-request/1',occurrenceId,stageId:'surfaceCurveImages:request',consumerId:'surfaceCurveImages',
    value:{patch:numericalGeometryRecord(patch),definition:numericalGeometryRecord(definition),toleranceMm}});}catch{/* Inspection cannot change the Geometry query. */}
  const result=surfaceCurveImages(patch,definition,options);
  observeContractValue({wireId:'query-representation',phase:'reply',typeId:'geometry-answer',implementationSchema:'saam-uv-images/1',
    occurrenceId,stageId:'surfaceCurveImages:result',consumerId:'Geometry surface image caller',
    ...(captured.request?.id?{requestIdentity:{id:captured.request.id,valueId:captured.request.valueId,flowId:captured.request.flowId}}:{}),value:result});
  return result;
}
const operations=Object.freeze({enclosedAxialProfile,prepareSurfaceRay,surfaceRayIntersections,resolutionMm:PRINT_RESOLUTION_MM,dimensions:Object.freeze({...dimensions}),curvePairSurface,closedEdgeSpans,compileBlobField,buildGeometry,combineSolids,constructSolids,constructGeometry,materialPresence,makeMesh,convexVolume,rodFrame,point,revolvedProfile,loftProfiles,roundedRectangleProfile,transformGeometry,geometrySelections,
    prepareGeometrySelections,resolveGeometrySelections,resolveMaterialGeometry,translateShell,mappedRegionMaterial,textOutlines,textLayout,
    matchCurveControls,ribbon,loftPolygons,topAt,createSectionQuery,containsPoint,
    closeMeshPatchToPlane,horizontalSlice,planeSlice,patchSlice,sliceStack,section,prepareSection,
    offsetRegion,difference,intersect,union,regionArea,loopArea,pointSegmentDistance,
    clipLineToRegion,clipPlanarCurveToRegion,intersectSurfaceSheet,offsetSliceRegion,strokeSliceRegion,clipSliceCurves,
    evaluateSurface,mappedSurface,surfaceDerivatives,surfaceIsoCurve,surfaceCurveImages:observedSurfaceCurveImages,curvePoint,sampleCurveIntervals,
    sampleSpatialCurve,trimSpatialCurve,modelEdges,curveSliceContacts,distinctPolyline,curveLength,transportCurveFrames,
    prepareContourSleeve,detectMeshSleeveInterval,strokeTopology,widenPlanarStrokes,
    referenceSurface,selectedFace,surfaceRegion,extendSurface,prepareSolidDistance,solidDistance,solidNormal,
    extrudedSegmentBounds,extrudedSegmentsContain,raycastExtrudedSegments,prepareExtrudedSegmentQuery});

export function geometryOperations({signal,progress,timeoutMs}={}){
  if(signal===undefined&&progress===undefined&&timeoutMs===undefined)return operations;
  const context={...(signal===undefined?{}:{signal}),...(progress===undefined?{}:{progress}),...(timeoutMs===undefined?{}:{timeoutMs})};
  function constructOwnedGeometry(requests,options={}){return constructGeometry(requests,{...options,...context});}
  function prepareOwnedSelections(geometry,requests,options={}){return prepareGeometrySelections(geometry,requests,{...options,...context});}
  return Object.freeze({...operations,constructGeometry:constructOwnedGeometry,prepareGeometrySelections:prepareOwnedSelections});
}
