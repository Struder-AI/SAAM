// Physical cell fields on a periodic reference family. Samples carry the
// evaluated geometry/metric; mapping, deposition and machine motion are downstream.
import {prepareSurfaceOffset} from '../geom/surface-offset.mjs';
import {evaluate} from '../geom/nurbs.mjs';
import {sampleSurfaceCurve} from '../region/normal-surface.mjs';
import {requireThat,distance,normalize,cross,scale,add,dot,findRoot,subtract} from '../geom/tolerance.mjs';
import {lineSpacing,spacingFactor} from '../path/spacing.mjs';
import {claddingCourse} from '../path/surface-courses.mjs';

export function surfaceCellField({shell,settings,process,chart,courses=null,startU=0,axialStart=0,surveyOffsetMm=settings.shells*settings.normalMm,layoutChart=chart}){
  const s=settings,p=process,w=p.lineWidthMm;
  // Mesh strips retain their interpolated normal metric. The optional loose
  // surface offset is only meaningful for an explicit native spline chart;
  // offsetTightness blends its point toward the exact unit-normal offset.
  const patch=s.surface?.kind==='spline'&&s.offsetTightness<1?shell.patches?.find(p=>p.name===s.surface.patch):null;
  requireThat(patch!==undefined,'Selected native spline patch is missing.');
  const offsetField=patch?prepareSurfaceOffset({patch,periodicU:s.surface.periodicU}):null;
  const offsetPoint=(u,v,depth)=>{
    const [[u0,u1],[v0,v1]]=s.surface.uvBounds,U=u0+u*(u1-u0),V=v0+v*(v1-v0),d=depth*s.surface.normalSide,loose=offsetField.at(U,V,d);
    if(s.offsetTightness===0)return loose;
    const exact=offsetField.exactAt(U,V,d);
    return loose.map((x,k)=>x+s.offsetTightness*(exact[k]-x));
  };
  const offsetChart=(depth,selectedChart=chart)=>offsetField?{...selectedChart,at:(u,v)=>{
    const actual=selectedChart.at(u,v),offset=offsetPoint(u,v,depth);
    if(selectedChart.contactGeometry!=='final-deposited-beads')return {...actual,point:offset};
    // Preserve the declared fitted-vs-exact offset displacement, but anchor it
    // on the actual substrate and orient its normal component to that surface.
    const original=evaluate(patch,s.surface.uvBounds[0][0]+u*(s.surface.uvBounds[0][1]-s.surface.uvBounds[0][0]),s.surface.uvBounds[1][0]+v*(s.surface.uvBounds[1][1]-s.surface.uvBounds[1][0]));
    const displacement=subtract(offset,original.point),oldNormal=scale(original.normal,s.surface.normalSide),oldU=normalize(original.du),oldV=cross(oldNormal,oldU);
    const newU=normalize(subtract(actual.du,scale(actual.normal,dot(actual.du,actual.normal)))),newV=cross(actual.normal,newU);
    const transported=add(add(scale(newU,dot(displacement,oldU)),scale(newV,dot(displacement,oldV))),scale(actual.normal,dot(displacement,oldNormal)));
    return {...actual,point:add(actual.point,transported)};
  }}:selectedChart;
  const trackPitch=lineSpacing(w,s),factor=spacingFactor(s);
  requireThat(chart.periodicU,'This wrapping producer needs a periodic U region; open-patch raster cladding is not yet implemented.');
  // Chord tolerance and step target decide how many samples every curve needs;
  // survey and course counts follow the measured surface, not a fixed budget.
  const options={toleranceMm:s.toleranceMm,maxStepMm:s.sampleStepMm};
  let points=0,helixStartU=startU;const emitted=[];
  const selected=(courses??Array.from({length:s.shells},(_,index)=>({index,fieldIndex:index,offsetMm:(index+.5)*s.normalMm,heightMm:s.normalMm})))
    .map(course=>({...course,offsetMm:course.toMm??course.offsetMm,heightMm:course.toMm===undefined?course.heightMm:course.toMm-course.fromMm}));
  const report={backend:chart.backend,shells:selected.length,points:0,partialAxialPasses:0,fullAxialPasses:0,axialPasses:0,
    offsetTightness:offsetField?s.offsetTightness:1,
    minBeadWidthMm:Infinity,maxBeadWidthMm:0,interface:'outward normal offsets from selected substrate surface',
    coverage:'Arc-length cells in each U sector; partial axial courses start/end where a cell appears/disappears. Sampled coverage, not a global geodesic guarantee.',
    physicalValidation:'not performed'};
  const newStroke=role=>({role,closed:false,surfaceSamples:[],cellWidthsMm:[],heightMm:s.normalMm,speedMmS:p.skinSpeedMmS});
  const emit=(stroke,samples,widths)=>{
    points+=samples.length;stroke.surfaceSamples.push(...samples);stroke.cellWidthsMm.push(...widths);
    stroke.widthAxis=stroke.role==='axial'?'du':'dv';
  };
  // Sampled longest meridian controls V survey resolution and hoop pitch.
  let meridianMax=0;
  for(let i=0;i<32;i++){
    const samples=sampleSurfaceCurve(offsetChart(surveyOffsetMm,layoutChart),t=>[i/32,t],offsetField?0:surveyOffsetMm,options);
    meridianMax=Math.max(meridianMax,samples.slice(1).reduce((n,e,j)=>n+distance(samples[j].point,e.point),0));
  }
  requireThat(meridianMax>2*w,'Surface region is too short for cladding.');
  const margin=w/(2*meridianMax),v0=margin,v1=1-margin;
  const nv=Math.max(32,Math.ceil(meridianMax/s.sampleStepMm));
  const vs=Array.from({length:nv+1},(_,i)=>v0+(v1-v0)*i/nv);
  const cuts=[...new Set([...chart.breaksU,...Array.from({length:17},(_,i)=>i/16)])].sort((a,b)=>a-b);
  for(const course of selected){
    const layer=course.index,offset=course.offsetMm,strokes=[],{axial,direction,phase}=claddingCourse(s,course.fieldIndex);
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
            if((axialStart+report.axialPasses)%2){samples.reverse();widths.reverse();}
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
      for(const v of [0,.25,.5,.75,1]){const ring=sampleSurfaceCurve(offsetChart(offset,layoutChart),t=>[t,v],offsetField?0:offset,options);
        circumferenceMax=Math.max(circumferenceMax,ring.slice(1).reduce((n,e,j)=>n+distance(ring[j].point,e.point),0));}
      const perTurn=Math.max(64,Math.ceil(circumferenceMax/s.sampleStepMm)),count=Math.ceil(totalTurns*perTurn),stroke=newStroke('circumferential');
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
        }
      }
      emit(stroke,samples,widths);strokes.push(stroke);
      if(s.pattern==='crossed-helices')helixStartU=uvAt(totalTurns)[0];
    }
    const maxZ=strokes.reduce((best,stroke)=>stroke.surfaceSamples.reduce((m,e)=>Math.max(m,e.point[2]),best),shell.bounds.max[2]);
    for(const stroke of strokes)stroke.heightMm=course.heightMm;
    emitted.push({layer,phase,strokes,region:[[[0,v0],[1,v0],[1,v1],[0,v1]]],reference:offsetChart(offset),axial,maxZ});
  }
  report.points=points;report.meridianSurveyMm=meridianMax;report.axialSurveyRows=nv+1;
  return {courses:emitted,report,nextU:helixStartU,nextAxial:axialStart+report.axialPasses};
}
