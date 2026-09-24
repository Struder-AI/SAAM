// Mesh estimation and unilateral contact feed the same vase path producer.
import {fitMeshSleeve} from '../../../core/geom/mesh-sleeve.mjs';
import {prepareLooseSleeveOffsets} from '../../../core/geom/sleeve-frame.mjs';
import {prepareRadialSleeveContact} from '../../../core/geom/prepared-radial-contact.mjs';
import {createMeshDistanceQuery} from '../../../core/geom/mesh-distance.mjs';
import {requireThat} from '../../../core/geom/tolerance.mjs';
import {loopArea} from '../../../core/region/region2d.mjs';
import {union} from '../../../core/region/intersection.mjs';

export const MESH_SLEEVE_SETTINGS={fidelity:1,offsetTightness:0,contactSide:'inside',circumferentialControls:12,heightControls:6,detailToleranceMm:.05};

// Growing periodic control resolution for the automatic standard-mode fit. Each
// step costs one separable least-squares solve; the first meeting the requested
// sampled tolerance wins, so a near-constant sleeve stops immediately.
const STANDARD_SLEEVE_CONTROLS=[[16,8],[16,16],[24,24],[32,32],[40,48],[48,64]];

// Standard continuous vase walls fit one periodic NURBS sleeve to the mesh and
// follow its loose horizontal offset, replacing an exact planar section, offset
// and contour rebuild at every rising sample. sleeveToleranceMm is a target that
// drives the control resolution: the fit scales up until its sampled residual
// meets the target, then uses the best fit and reports the residual actually
// achieved. It falls back to null — leaving the exact per-section path — only
// when disabled or when the geometry is not a single sleeve (the fit rejects a
// collapsed, branching or multi-bore section). A localized near-crease that the
// smooth sleeve cannot fully resolve stays on the fast path rather than failing
// generation, since the exact path is not guaranteed to complete either.
export function createStandardVaseSleeve({shell,settings,start,end,width,onProgress}){
  const tolerance=settings.sleeveToleranceMm;
  if(!(tolerance>0)||shell.kind!=='triangle-mesh')return null;
  onProgress?.({stage:'Fitting vase sleeve reference',completed:0,total:1});
  let best=null;
  for(const [circumferentialControls,heightControls] of STANDARD_SLEEVE_CONTROLS){
    let candidate;
    // A rejected fit means this is not a single sleeve at this resolution. Stop
    // scaling and keep the best coarser fit; if none ever fit, use the exact path.
    try{candidate=fitMeshSleeve(shell,{zMinMm:start,zMaxMm:end,circumferentialControls,heightControls,
      circumferentialSamples:Math.max(2*circumferentialControls,circumferentialControls*3),heightSamples:Math.max(heightControls+1,heightControls*3),
      toleranceMm:Math.min(settings.toleranceMm,tolerance)/8});}
    catch{break;}
    if(!best||candidate.report.maxSampledFitResidualMm<best.report.maxSampledFitResidualMm)best=candidate;
    if(candidate.report.maxSampledFitResidualMm<=tolerance)break;
  }
  if(!best)return null;
  const fit=best,achievedMm=fit.report.maxSampledFitResidualMm;
  // Accept when the sampled deviation meets the tolerance, or stays within it on
  // average with only isolated near-crease points exceeding it (a smooth surface
  // whose one sharp feature the periodic fit cannot fully resolve). A globally
  // poor fit — a shape the smooth sleeve misrepresents everywhere — returns to
  // the exact per-section wall, which preserves it.
  if(achievedMm>tolerance&&fit.report.rmsFitResidualMm>tolerance)return null;
  const frame=prepareLooseSleeveOffsets({patch:fit.patch,rangeMm:fit.rangeMm});
  // The standard wall deposits just inside the outer boundary, matching the
  // exact path's inward centerline offset of one bead half width.
  const beadOffset=-width/2;
  // The centerline fit is validated per height, but the bead-width offset can
  // still cross itself where the wall is thinner than the bead. Sample the
  // offset loop across the interval; a collapsed or self-intersecting offset
  // returns to the exact path, which reports the specific too-thin rejection.
  const segments=fit.report.sectionSegments,checks=Math.max(2*fit.report.heightControls,48);
  for(let h=0;h<=checks;h++){
    const z=start+(end-start)*Math.min(1,h/checks);
    const loop=Array.from({length:segments},(_,i)=>{const p=frame.at(i/segments,z,beadOffset,0);return [p[0],p[1]];});
    const area=loopArea(loop),normalized=union([loop],[],{precisionMm:1e-7});
    if(!(area>1e-9&&normalized.length===1&&loopArea(normalized[0])>0&&Math.abs(loopArea(normalized[0])-area)<Math.max(1e-5,area*1e-8)))return null;
  }
  onProgress?.({stage:'Fitting vase sleeve reference',completed:1,total:1});
  return {sectionAt:fit.sectionAt,mappingErrorMm:0,referenceLengthMm:fit.sectionAt(start).curve.length,
    pointAt:(u,z,offset=0)=>frame.at(u,z,offset+beadOffset,0),
    map:point=>point,
    report:()=>({sleeve:{mode:'loose-offset',fidelity:0,contactSide:'inside',sleeveToleranceMm:tolerance,
      achievedResidualMm:achievedMm,meetsTolerance:achievedMm<=tolerance,...fit.report,...frame.report(),
      scope:'Standard vase wall follows a periodic NURBS sleeve fitted to the mesh, offset inward by the bead half width through the loose horizontal surface offset. achievedResidualMm bounds deviation at the fit sample heights only; it is not a global surface-error certificate. Set sleeveToleranceMm to 0 for the exact per-section wall.'}})};
}

export function createVaseMeshReference({shell,settings,start,end,width,onProgress}){
  const config=settings.meshSleeve;
  if(!config)return null;
  requireThat(shell.kind==='triangle-mesh','Fitted mesh sleeve settings require a mesh component; use the native reference directly for spline geometry.');
  onProgress?.({stage:'Fitting mesh sleeve',completed:0,total:1});
  const tolerance=Math.min(settings.toleranceMm,settings.boundaryToleranceMm),fit=fitMeshSleeve(shell,{
    zMinMm:start,zMaxMm:end,circumferentialControls:config.circumferentialControls,heightControls:config.heightControls,
    circumferentialSamples:Math.max(96,config.circumferentialControls*3),heightSamples:Math.max(25,config.heightControls*2),toleranceMm:tolerance/8
  });
  onProgress?.({stage:'Fitting mesh sleeve',completed:1,total:1});
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
    report:()=>({meshSleeve:{...config,...fit.report,...frame.report(),... (contact?contact.report():{}),contactPreparation:contact?contact.report():null,
      referenceChart:'Periodic U fitted to normalized source-section arc length; the same U is retained at every pattern depth. Z remains the authored height.',
      contactMetric:'horizontal radial clamp from fitted centerline; only forbidden-side points move',
      contactTarget:'path-centerline',
      beadEnvelopeScope:'The contact limit constrains path centers. The deposited bead can extend beyond that limit by its half width.',
      contactDomain:'Single contours admitting bounded angular unfolding about the fitted center; larger folds reject.',
      detailScope:'Planar correspondence bound to original mesh sections at prepared profiles, plus sampled polar-profile interpolation. Narrow ledge transitions use original-triangle 3D distances at quarter/mid heights with adaptive angular checks. This is neither a global mesh Hausdorff certificate nor a radial point-correspondence bound. Unilateral classification uses the approximated boundary.'}})};
}
