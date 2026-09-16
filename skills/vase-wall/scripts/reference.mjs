// Mesh estimation and unilateral contact feed the same vase path producer.
import {fitMeshSleeve} from '../../../core/geom/mesh-sleeve.mjs';
import {prepareLooseSleeveOffsets} from '../../../core/geom/sleeve-frame.mjs';
import {prepareRadialSleeveContact} from '../../../core/geom/prepared-radial-contact.mjs';
import {createMeshDistanceQuery} from '../../../core/geom/mesh-distance.mjs';
import {requireThat} from '../../../core/geom/tolerance.mjs';

export const MESH_SLEEVE_SETTINGS={fidelity:1,offsetTightness:0,contactSide:'inside',circumferentialControls:12,heightControls:6,detailToleranceMm:.05};

export function createVaseMeshReference({shell,settings,start,end,width,onProgress}){
  const config=settings.meshSleeve;
  if(!config)return null;
  requireThat(shell.kind==='triangle-mesh','Fitted mesh sleeve settings require a mesh component; use the native reference directly for spline geometry.');
  onProgress?.({stage:'Fitting mesh reference sleeve',completed:0,total:1});
  const tolerance=Math.min(settings.toleranceMm,settings.boundaryToleranceMm),fit=fitMeshSleeve(shell,{
    zMinMm:start,zMaxMm:end,circumferentialControls:config.circumferentialControls,heightControls:config.heightControls,
    circumferentialSamples:Math.max(96,config.circumferentialControls*3),heightSamples:Math.max(25,config.heightControls*2),toleranceMm:tolerance/8
  });
  onProgress?.({stage:'Fitting mesh reference sleeve',completed:1,total:1});
  const frame=prepareLooseSleeveOffsets({patch:fit.patch,rangeMm:fit.rangeMm});
  const beadOffset=(config.contactSide==='inside'?-1:1)*width/2;
  const sourceCurves=new Map();
  const curveAt=z=>{
    if(sourceCurves.has(z))return sourceCurves.get(z);
    const source=fit.sourceSectionAt(z);
    requireThat(Math.abs(source.nudgedByMm??0)<=settings.boundaryToleranceMm,'Mesh contact section nudge exceeds boundaryToleranceMm.');
    // The requested contact target is the path centerline against the original
    // mesh boundary. A Boolean bead inset can delete narrow mesh details and
    // change topology; bead placement belongs to the loose reference field.
    const curve=source.curve;
    if(sourceCurves.size>=128)sourceCurves.delete(sourceCurves.keys().next().value);
    sourceCurves.set(z,curve);return curve;
  };
  // Source-detail error is separate from the final path chord tolerance. The
  // radial field is continuous across prepared height intervals; its sampled
  // interpolation target does not certify global mesh or toolpath error.
  const mappingErrorMm=0;
  // Uniform samples of the periodic fitted spline define a smooth centerline,
  // independent of changing polygon vertices or the fine contact boundary.
  const anchorAt=z=>{
    const center=[0,0],count=config.circumferentialControls;
    for(let i=0;i<count;i++){const p=fit.pointAt(i/count,z);center[0]+=p[0]/count;center[1]+=p[1]/count;}
    return center;
  };
  const contact=config.fidelity>0?prepareRadialSleeveContact({side:config.contactSide,anchorAt,curveAt,
    startMm:start,endMm:end,stepMm:settings.minFeatureMm,toleranceMm:config.detailToleranceMm,distanceToSourceWithin:createMeshDistanceQuery(shell),onProgress}):null;
  return {sectionAt:fit.sectionAt,mappingErrorMm,referenceLengthMm:fit.sectionAt(start).curve.length,
    pointAt:(u,z,offset=0)=>frame.at(u,z,offset+beadOffset,config.offsetTightness??0),
    map:point=>contact?contact.at(point,config.fidelity):point,
    report:()=>({meshSleeve:{...config,...fit.report,...frame.report(),... (contact?contact.report:{}),contactPreparation:contact?{...contact.report}:null,
      referenceChart:'Periodic U fitted to normalized source-section arc length; the same U is retained at every motif depth. Z remains the authored height.',
      contactMetric:'horizontal radial clamp from fitted centerline; only forbidden-side points move',
      contactTarget:'path-centerline',
      beadEnvelopeScope:'The contact limit constrains path centers. The deposited bead can extend beyond that limit by its half width.',
      contactDomain:'Single contours admitting bounded angular unfolding about the fitted center; larger folds reject.',
      detailScope:'Planar correspondence bound to original mesh sections at prepared profiles, plus sampled polar-profile interpolation. Narrow ledge transitions use original-triangle 3D distances at quarter/mid heights with adaptive angular checks. This is neither a global mesh Hausdorff certificate nor a radial point-correspondence bound. Unilateral classification uses the approximated boundary.'}})};
}
