// Surface coverage producer. Geometry and normal offsets live in shared core;
// this skill only chooses courses, local cell widths, poses and dependencies.
import {surfaceRegion} from '../../../core/geom/surface-region.mjs';
import {prepareSurfaceOffsets} from '../../../core/geom/surface-offset.mjs';
import {sampleSurfaceCurve} from '../../../core/region/normal-surface.mjs';
import {requireThat,distance,normalize,cross,scale,add,dot,findRoot,subtract} from '../../../core/geom/tolerance.mjs';
import {lineSpacing,spacingFactor} from '../../../core/path/spacing.mjs';
import {claddingCourse} from './course.mjs';

export function surfaceCladdingResult({shell,plan,after=[],id='pipe-cladding',finishedSurface=null}){
  const s=plan.skills['pipe-cladding'],p=plan.process,chart=finishedSurface??surfaceRegion(shell,s.surface),w=p.lineWidthMm;
  // Mesh strips retain their interpolated normal metric. The optional loose
  // field is only meaningful for an explicit native spline chart.
  let offsetField=null;
  if(s.surface?.kind==='spline'&&s.offsetTightness<1){
    const patch=shell.patches?.find(p=>p.name===s.surface.patch);
    requireThat(patch,'Selected native spline patch is missing.');
    offsetField=prepareSurfaceOffsets({patch,mode:'normal',periodicU:s.surface.periodicU});
  }
  const offsetChart=(depth)=>offsetField?{...chart,at:(u,v)=>{const e=chart.at(u,v);return {...e,point:offsetField.at(s.surface.uvBounds[0][0]+u*(s.surface.uvBounds[0][1]-s.surface.uvBounds[0][0]),s.surface.uvBounds[1][0]+v*(s.surface.uvBounds[1][1]-s.surface.uvBounds[1][0]),depth*s.surface.normalSide,s.offsetTightness)};}}:chart;
  const trackPitch=lineSpacing(w,s),factor=spacingFactor(s);
  requireThat(chart.periodicU,'This wrapping producer needs a periodic U region; open-patch raster cladding is not yet implemented.');
  const center=plan.setup.denso.rotaryCenterMm;
  const options={toleranceMm:s.toleranceMm,maxStepMm:s.sampleStepMm,maxPoints:s.maxPoints};
  let points=0,angle=0,previous=[...new Set([...after,...(chart.sourceOperationIds??[])])],helixStartU=0;const operations=[];
  const report={backend:chart.backend,shells:s.shells,points:0,partialAxialPasses:0,fullAxialPasses:0,axialPasses:0,
    offsetTightness:offsetField?s.offsetTightness:1,
    minBeadWidthMm:Infinity,maxBeadWidthMm:0,interface:'outward normal offsets from selected substrate surface',
    coverage:'Arc-length cells in each U sector; partial axial courses start/end where a cell appears/disappears. Sampled coverage, not a global geodesic guarantee.',
    physicalValidation:'not performed'};
  const newStroke=role=>({role,closed:false,points:[],poses:[],volumesMm3:[],speedMmS:p.skinSpeedMmS});
  const pose=e=>{
    const radius=Math.hypot(e.point[0]-center[0],e.point[1]-center[1]);requireThat(radius>1e-6,'Cladding crosses the rotary axis.');
    const raw=-Math.atan2(e.point[1]-center[1],e.point[0]-center[0])*180/Math.PI;
    angle=raw+360*Math.round((angle-raw)/360);
    const n=e.normal,v=normalize(subtract(e.dv,scale(n,dot(e.dv,n)))),up=normalize(cross(v,n)),t=s.tiltDeg*Math.PI/180;
    return {rotaryDeg:angle,toolAxis:add(scale(n,-Math.sin(t)),scale(v,-Math.cos(t))),toolUp:up};
  };
  const emit=(stroke,samples,widths)=>{
    for(let i=0;i<samples.length;i++){
      requireThat(++points<=s.maxPoints,`Surface cladding exceeds maxPoints (${s.maxPoints}); increase pipe-cladding.maxPoints.`);
      const e=samples[i];stroke.points.push(e.point);stroke.poses.push(pose(e));
      if(i){const a=samples[i-1],length=distance(a.point,e.point),width=(widths[i-1]+widths[i])/2;
        // Cell width is along U for axial courses, V for hoops. Project it
        // perpendicular to the actual stroke to account for skewed charts.
        const across=normalize(stroke.role==='axial'?e.du:e.dv),tangent=normalize(subtract(e.point,a.point));
        const effective=width*Math.hypot(...cross(across,tangent));
        stroke.volumesMm3.push(length*effective*s.normalMm);
        report.minBeadWidthMm=Math.min(report.minBeadWidthMm,effective);report.maxBeadWidthMm=Math.max(report.maxBeadWidthMm,effective);
      }
    }
  };
  // Sampled longest meridian controls V survey resolution and hoop pitch.
  let meridianMax=0;
  for(let i=0;i<32;i++){
    const samples=sampleSurfaceCurve(offsetChart(s.shells*s.normalMm),t=>[i/32,t],offsetField?0:s.shells*s.normalMm,options);
    meridianMax=Math.max(meridianMax,samples.slice(1).reduce((n,e,j)=>n+distance(samples[j].point,e.point),0));
  }
  requireThat(meridianMax>2*w,'Surface region is too short for cladding.');
  const margin=w/(2*meridianMax),v0=margin,v1=1-margin;
  const nv=Math.max(32,Math.ceil(meridianMax/s.sampleStepMm));
  requireThat(nv*chart.breaksU.length<s.maxPoints,'Surface coverage survey exceeds maxPoints.');
  const vs=Array.from({length:nv+1},(_,i)=>v0+(v1-v0)*i/nv);
  const cuts=[...new Set([...chart.breaksU,...Array.from({length:17},(_,i)=>i/16)])].sort((a,b)=>a-b);
  for(let layer=0;layer<s.shells;layer++){
    const offset=(layer+.5)*s.normalMm,strokes=[],{axial,direction,phase}=claddingCourse(s,layer);
    if(axial){
      for(let sector=0;sector<cuts.length-1;sector++){
        const ua=cuts[sector],ub=cuts[sector+1],cache=new Map();
        const ring=v=>{
          if(cache.has(v))return cache.get(v);
          const samples=sampleSurfaceCurve(offsetChart(offset),t=>[ua+(ub-ua)*t,v],offsetField?0:offset,options),lengths=[0];
          for(let i=1;i<samples.length;i++)lengths.push(lengths.at(-1)+distance(samples[i-1].point,samples[i].point));
          const result={samples,lengths,length:lengths.at(-1)};cache.set(v,result);return result;
        };
        const lengths=vs.map(v=>ring(v).length),count=Math.ceil(Math.max(...lengths)/trackPitch);
        requireThat(count*vs.length<s.maxPoints,'Surface course survey exceeds maxPoints.');
        for(let k=0;k<count;k++){
          const threshold=k*trackPitch;
          const centerAt=v=>{
            const r=ring(v),cellWidth=Math.max(0,Math.min(trackPitch,r.length-threshold)),width=cellWidth/factor,arc=Math.min(r.length,threshold+cellWidth/2);
            let lo=0,hi=r.lengths.length-1;while(hi-lo>1){const m=(lo+hi)>>1;if(r.lengths[m]<arc)lo=m;else hi=m;}
            const f=(arc-r.lengths[lo])/(r.lengths[hi]-r.lengths[lo]||1),u=r.samples[lo].u+(r.samples[hi].u-r.samples[lo].u)*f;
            return {u,width};
          };
          let start=lengths[0]>threshold?v0:null;
          const run=(a,b)=>{
            if(b-a<1e-8)return;
            let samples=sampleSurfaceCurve(offsetChart(offset),t=>{const v=a+(b-a)*t;return [centerAt(v).u,v];},offsetField?0:offset,options);
            let widths=samples.map(e=>centerAt(e.v).width);
            if(report.axialPasses%2){samples.reverse();widths.reverse();}
            const stroke=newStroke('axial');emit(stroke,samples,widths);strokes.push(stroke);
            report.axialPasses++;
            if(a>v0+1e-7||b<v1-1e-7)report.partialAxialPasses++;else report.fullAxialPasses++;
          };
          for(let j=1;j<vs.length;j++){
            const active=lengths[j]>threshold,before=lengths[j-1]>threshold;
            if(active!==before){const root=findRoot(v=>ring(v).length-threshold,vs[j-1],vs[j],lengths[j-1]-threshold,lengths[j]-threshold);
              if(active)start=root;else{run(start,root);start=null;}}
          }
          if(start!==null)run(start,v1);
        }
      }
    }else{
      // A continuous periodic course. V advances by physical meridian pitch;
      // local width scales with the native metric, rather than assuming U/V mm.
      const turns=Math.ceil(meridianMax/trackPitch)+1,pitch=1/(turns-1),beadPitch=pitch/factor,totalTurns=turns-1+1/factor;
      let circumferenceMax=0;
      for(const v of [0,.25,.5,.75,1]){const ring=sampleSurfaceCurve(offsetChart(offset),t=>[t,v],offsetField?0:offset,options);
        circumferenceMax=Math.max(circumferenceMax,ring.slice(1).reduce((n,e,j)=>n+distance(ring[j].point,e.point),0));}
      const perTurn=Math.max(64,Math.ceil(circumferenceMax/s.sampleStepMm)),count=Math.ceil(totalTurns*perTurn),stroke=newStroke('circumferential');
      requireThat(count+points<=s.maxPoints,'Surface helix exceeds maxPoints; increase pipe-cladding.maxPoints.');
      const samples=[],widths=[];
      const uvAt=progress=>{const raw=-beadPitch/2+progress*pitch,u=helixStartU+direction*progress;return [u-Math.floor(u),Math.max(v0,Math.min(v1,raw))];};
      for(let i=0;i<count;i++){
        // Seed below one turn to prevent periodic aliasing, then refine the
        // normal-offset curve to the same chord and step targets as axial paths.
        // Rescale the fractional last interval instead of clamping an interior
        // part of it: repeated endpoint samples have no tangent.
        const start=i/perTurn,end=Math.min(totalTurns,(i+1)/perTurn);
        const progressAt=t=>end<(i+1)/perTurn?start+(end-start)*t:(i+t)/perTurn;
        // A fractional final turn can round count upward at an exact endpoint.
        // Do not sample a zero-length parameter interval as another segment.
        if(end<=start)continue;
        const section=sampleSurfaceCurve(offsetChart(offset),t=>uvAt(progressAt(t)),offsetField?0:offset,options);
        for(const e of section.slice(i?1:0)){
          const rawV=-beadPitch/2+progressAt(e.t)*pitch,local=Math.hypot(...e.dv);
          samples.push(e);widths.push(Math.max(0,Math.min(beadPitch,rawV+beadPitch/2,1+beadPitch/2-rawV))*local);
          requireThat(samples.length+points<=s.maxPoints,'Surface helix exceeds maxPoints; increase pipe-cladding.maxPoints.');
        }
      }
      emit(stroke,samples,widths);strokes.push(stroke);
      if(s.pattern==='crossed-helices')helixStartU=uvAt(totalTurns)[0];
    }
    const operationId=id+':'+layer,maxZ=strokes.reduce((best,stroke)=>stroke.points.reduce((m,p)=>Math.max(m,p[2]),best),shell.bounds.max[2]);
    operations.push({id:operationId,layerId:operationId,phase,layer,rank:layer,after:previous,
      strokes,order:'given',continuous:true,regionId:operationId,travelPolicy:{maxCombMm:0,clearanceFor:()=>maxZ+p.liftMm,poseJoinMm:0},clearanceZ:maxZ+p.liftMm});
    previous=[operationId];
  }
  report.points=points;report.meridianSurveyMm=meridianMax;report.axialSurveyRows=nv+1;
  if(finishedSurface)report.substrate={sourceOperationIds:finishedSurface.sourceOperationIds,coverage:finishedSurface.coverage,part:s.part};
  return {id,operations,report};
}
