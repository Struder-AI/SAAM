// Circular-pipe geometry and axial-hoop cladding for the DENSO development
// tools. SAAM recipes author a pipe as spline or mesh geometry and clad it
// through a surface selection; these tools keep the analytic pipe their saved
// source plans and robot programs were built from.
import {requireThat} from '../../core/geom/tolerance.mjs';
import {makeMesh} from '../../core/geom/mesh.mjs';
import {circlePoints} from '../../core/geom/cylinder.mjs';
import {createSectionQuery} from '../../core/geom/query.mjs';
import {intersect} from '../../core/region/intersection.mjs';
import {lineSpacing,spacingFactor} from '../../core/path/spacing.mjs';
// Preserve the saved analytic study's course schedule locally. Current recipes
// author explicit directions through ordinary Slice surface-cells instead.
function studyCourse(settings,layer){
  const crossed=settings.pattern==='crossed-helices',axial=!crossed&&layer%2===0;
  const direction=crossed&&layer%2===1?-1:1;
  return {axial,direction,phase:axial?'cladding-axial':crossed?
    (direction===1?'cladding-helix-forward':'cladding-helix-reverse'):'cladding-hoop'};
}

export function pipeMesh({innerRadiusMm,outerRadiusMm,heightMm,toleranceMm}){
  requireThat(innerRadiusMm>0&&outerRadiusMm>innerRadiusMm&&heightMm>0,'Pipe needs positive height and ordered radii.');
  const outer=circlePoints(outerRadiusMm,[0,0],toleranceMm),n=outer.length,vertices=[];
  for(const z of [0,heightMm])for(const r of [outerRadiusMm,innerRadiusMm])for(let i=0;i<n;i++){
    const a=2*Math.PI*i/n;vertices.push([r*Math.cos(a),r*Math.sin(a),z]);
  }
  const triangles=[],quad=(a,b,c,d)=>triangles.push([a,b,c],[a,c,d]);
  for(let i=0;i<n;i++){const j=(i+1)%n;quad(i,j,2*n+j,2*n+i);quad(n+j,n+i,3*n+i,3*n+j);quad(j,i,n+i,n+j);quad(2*n+i,2*n+j,3*n+j,3*n+i);}
  return makeMesh(vertices,triangles);
}
export function cylindricalPoint(center,radius,angle,z){const a=angle*Math.PI/180;return [center[0]+radius*Math.cos(a),center[1]+radius*Math.sin(a),z];}
export function cylindricalPose(angle,tiltDeg){const a=angle*Math.PI/180,t=tiltDeg*Math.PI/180;return {rotaryDeg:-angle,toolAxis:[-Math.sin(t)*Math.cos(a),-Math.sin(t)*Math.sin(a),-Math.cos(t)],toolUp:[-Math.sin(a),Math.cos(a),0]};}

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
  const s=plan.skills['pipe-cladding'],p=plan.process,g=plan.geometry,center=[plan.placement.xMm,plan.placement.yMm,0];
  const trackPitch=lineSpacing(p.lineWidthMm,s),factor=spacingFactor(s);
  const base=g.outerRadiusMm-s.shells*s.normalMm,operations=[];
  let used=0,angle=0,previous=after;
  const makeStroke=(radius,role)=>({points:[],poses:[],speedMmS:p.skinSpeedMmS,beadAreaMm2:p.lineWidthMm*s.normalMm,role,closed:false});
  // Sample counts follow sampleStepMm, toleranceMm and the pipe's own size;
  // the count is reported, never bounded in advance.
  const append=(stroke,r,a,z)=>{
    used++;stroke.points.push(cylindricalPoint(center,r,a,z));stroke.poses.push(cylindricalPose(a,s.tiltDeg));
  };
  for(let shell=0;shell<s.shells;shell++){
    const radius=base+(shell+.5)*s.normalMm,circumference=2*Math.PI*radius;
    const angularStep=Math.min(s.sampleStepMm/radius,2*Math.acos(Math.max(-1,1-Math.min(s.toleranceMm,radius)/radius)))*180/Math.PI;
    const strokes=[],{axial,direction,phase}=studyCourse(s,shell);
    if(axial){
      // Each end index continues deposition into the neighboring track. Each
      // axial bead has a unique circumferential cell; closing the seam does not
      // repeat the first bead.
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
      after:previous,strokes,order:'given',continuous:true,connectNearby:axial,regionId:operationId,
      travelPolicy:{maxCombMm:0,clearanceFor:()=>g.heightMm+p.liftMm,poseJoinMm:axial?p.lineWidthMm*1.01:0}});
    previous=[operationId];
  }
  return {id,operations,report:{shells:s.shells,points:used,substrateOuterRadiusMm:base,outerRadiusMm:g.outerRadiusMm,
    interface:'concentric outward shells',axialTurnarounds:'non-depositing bed indexing',physicalValidation:'not performed'}};
}
