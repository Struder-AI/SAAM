import {requireThat} from '../../../core/geom/tolerance.mjs';
import {circlePoints,cylindricalPoint,cylindricalPose} from '../../../core/geom/cylinder.mjs';
import {createSectionQuery} from '../../../core/geom/query.mjs';
import {intersect} from '../../../core/region/intersection.mjs';
import {validateSurfaceSelection} from '../../../core/geom/surface-region.mjs';
import {surfaceCladdingResult} from './surface-clad.mjs';
import {lineSpacing,spacingFactor} from '../../../core/path/spacing.mjs';
import {CLADDING_PATTERNS,claddingCourse} from './course.mjs';

export const PIPE_CLADDING_DEFAULTS={enabled:false,part:null,pattern:'axial-hoop',spacingFactor:1,shells:4,normalMm:0.2,tiltDeg:45,sampleStepMm:1,toleranceMm:0.01,maxPoints:500000,surface:null};
export function validateCladding(plan,machine){
  const s=plan.skills['pipe-cladding'];
  requireThat(CLADDING_PATTERNS.includes(s.pattern),'Cladding pattern must be axial-hoop or crossed-helices.');
  requireThat(s.part===null||typeof s.part==='string','Cladding part must be null or a component ID.');
  requireThat(typeof s.enabled==='boolean'&&Number.isInteger(s.shells)&&s.shells>0,'Cladding needs a positive integer shell count.');
  for(const k of ['normalMm','sampleStepMm','toleranceMm'])requireThat(Number.isFinite(s[k])&&s[k]>0,'Invalid cladding '+k+'.');
  requireThat(Number.isFinite(s.tiltDeg)&&s.tiltDeg>0&&s.tiltDeg<90,'Cladding tilt must be between 0 and 90 degrees from downward.');
  requireThat(Number.isSafeInteger(s.maxPoints)&&s.maxPoints>=100,'Cladding maxPoints must be at least 100.');
  if(s.surface)validateSurfaceSelection(s.surface);
  if(!s.enabled)return;
  requireThat(machine.capabilities?.includes('tool-orientation')&&machine.capabilities?.includes('coordinated-rotary'),'Pipe cladding requires tool orientation and a coordinated rotary.');
  requireThat(s.surface||plan.geometry.shape==='pipe','Cladding needs a native pipe or an explicit surface selection.');
  if(s.surface){
    requireThat(plan.geometry.shape==='assembly'?plan.geometry.parts.some(part=>part.id===s.part):s.part===null,'Select the printed component whose finished surface will be clad.');
    return;
  }
  requireThat(s.part===null,'The legacy circular-pipe recipe cannot select an assembly component; use a finished surface selection.');
  requireThat(!plan.composition.regions.length,'Pipe cladding currently owns an explicit radial band; Z-region assignments are not yet supported for it.');
  requireThat(plan.skills['full-fill'].enabled&&!plan.skills['planar-infill'].enabled&&!plan.skills['draped-skin'].enabled&&!plan.skills['vase-wall'].enabled,'Pipe substrate requires full-fill; other patterns must not own the same material.');
  requireThat(plan.geometry.outerRadiusMm-s.shells*s.normalMm>plan.geometry.innerRadiusMm+plan.process.lineWidthMm,'Cladding leaves less than one bead for the substrate.');
  requireThat(plan.geometry.heightMm>2*plan.process.lineWidthMm,'Pipe is too short for axial cladding tracks.');
  const center=plan.setup.denso?.rotaryCenterMm;
  requireThat(center&&Math.abs(center[0]-plan.placement.xMm)<1e-9&&Math.abs(center[1]-plan.placement.yMm)<1e-9,'Pipe axis must coincide with the configured rotary center for this cladding pattern.');
}

// The ordinary fill skill consumes its actual section clipped to the substrate.
export function substrateSection(shell,plan){
  const radius=plan.geometry.outerRadiusMm-plan.skills['pipe-cladding'].shells*plan.skills['pipe-cladding'].normalMm;
  const mask=[circlePoints(radius,[plan.placement.xMm,plan.placement.yMm],plan.geometry.toleranceMm)];
  const sectionAt=createSectionQuery(shell,{minFeatureMm:plan.skills['full-fill'].minFeatureMm});
  return z=>{const section=sectionAt(z);return {...section,loops:intersect(section.loops,mask)};};
}

// With no separate perimeter bands, sample this native pipe's radial chart
// once from bore to outside, allowing odd counts without duplicate center loops.
export function substrateLoops(plan){
  const inner=plan.geometry.innerRadiusMm,outer=plan.geometry.outerRadiusMm-plan.skills['pipe-cladding'].shells*plan.skills['pipe-cladding'].normalMm;
  const width=plan.process.lineWidthMm,pitch=lineSpacing(width,plan.skills['full-fill']),count=Math.max(2,Math.round(pitch===width?(outer-inner)/width:(outer-inner-width)/pitch+1));
  const spacing=(outer-inner-width)/(count-1),center=[plan.placement.xMm,plan.placement.yMm];
  return Array.from({length:count},(_,i)=>({closed:true,points:circlePoints(inner+width/2+i*spacing,center,plan.geometry.toleranceMm)}));
}

export function pipeCladdingResult({plan,shell,after=[],id='pipe-cladding',finishedSurface=null}){
  if(plan.skills['pipe-cladding'].surface)return surfaceCladdingResult({plan,shell,after,id,finishedSurface});
  const s=plan.skills['pipe-cladding'],p=plan.process,g=plan.geometry,center=[plan.placement.xMm,plan.placement.yMm,0];
  const trackPitch=lineSpacing(p.lineWidthMm,s),factor=spacingFactor(s);
  const base=g.outerRadiusMm-s.shells*s.normalMm,operations=[];
  let used=0,angle=0,previous=after;
  const makeStroke=(radius,role)=>({points:[],poses:[],speedMmS:p.skinSpeedMmS,beadAreaMm2:p.lineWidthMm*s.normalMm,role,closed:false});
  const append=(stroke,r,a,z)=>{
    requireThat(++used<=s.maxPoints,`Pipe cladding exceeds maxPoints (${s.maxPoints}); increase pipe-cladding.maxPoints.`);
    stroke.points.push(cylindricalPoint(center,r,a,z));stroke.poses.push(cylindricalPose(a,s.tiltDeg));
  };
  for(let shell=0;shell<s.shells;shell++){
    const radius=base+(shell+.5)*s.normalMm,circumference=2*Math.PI*radius;
    const angularStep=Math.min(s.sampleStepMm/radius,2*Math.acos(Math.max(-1,1-Math.min(s.toleranceMm,radius)/radius)))*180/Math.PI;
    const strokes=[],{axial,direction,phase}=claddingCourse(s,shell);
    if(axial){
      // Index with extrusion off at each end. Each axial bead has a unique
      // circumferential cell; closing the seam does not repeat the first bead.
      const tracks=2*Math.ceil(circumference/trackPitch/2),width=circumference/tracks/factor;
      const bottom=width/2,top=g.heightMm-width/2,start=angle;
      for(let i=0;i<tracks;i++){
        const stroke=makeStroke(radius,'axial');stroke.beadAreaMm2=width*s.normalMm;
        const z0=i%2?top:bottom,z1=i%2?bottom:top;
        angle=start+i*360/tracks;
        const count=Math.max(1,Math.ceil((top-bottom)/s.sampleStepMm));
        for(let k=0;k<=count;k++)append(stroke,radius,angle,z0+(z1-z0)*k/count);
        strokes.push(stroke);
      }
    }else{
      // One helix with partial-width edge turns. Volume follows the portion of
      // the bead inside the axial domain, keeping open ends within the pipe.
      const pitch=trackPitch,beadWidth=p.lineWidthMm,start=angle,turns=(g.heightMm+beadWidth)/pitch;
      // Wide-pitch helices need their vertical advance included in the step
      // bound as well as the circumferential chord bound.
      const count=Math.ceil(Math.max(turns*360/angularStep,Math.hypot(turns*circumference,g.heightMm+beadWidth)/s.sampleStepMm)),stroke=makeStroke(radius,'circumferential');
      stroke.volumesMm3=[];
      for(let k=0;k<=count;k++){
        const advance=k/count*turns*pitch,z=-beadWidth/2+advance;
        // Clip the helix centerline to the usable half-bead domain. The first
        // and final revolutions become level edge rings with tapered volume.
        append(stroke,radius,start+direction*advance/pitch*360,Math.max(beadWidth/2,Math.min(g.heightMm-beadWidth/2,z)));
        if(k){
          const mid=-beadWidth/2+(k-.5)/count*turns*pitch;
          const width=Math.max(0,Math.min(beadWidth,mid+beadWidth/2,g.heightMm+beadWidth/2-mid));
          const a=stroke.points[k-1],b=stroke.points[k];
          stroke.volumesMm3.push(Math.hypot(...b.map((v,i)=>v-a[i]))*width*s.normalMm);
        }
      }
      angle=start+direction*turns*360;strokes.push(stroke);
    }
    const operationId=id+':'+shell;
    operations.push({id:operationId,layerId:operationId,phase,layer:shell,rank:radius,
      after:previous,strokes,order:'given',continuous:true,regionId:operationId,
      travelPolicy:{maxCombMm:0,clearanceFor:()=>g.heightMm+p.liftMm,poseJoinMm:axial?p.lineWidthMm*1.01:0},clearanceZ:g.heightMm+p.liftMm});
    previous=[operationId];
  }
  return {id,operations,report:{shells:s.shells,points:used,substrateOuterRadiusMm:base,outerRadiusMm:g.outerRadiusMm,
    interface:'concentric outward shells',axialTurnarounds:'non-depositing bed indexing',physicalValidation:'not performed'}};
}
