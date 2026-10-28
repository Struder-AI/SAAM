// Physical parallel cells on an evaluated chart. This operation has no stack,
// source-result, ownership or deposition lifecycle; any slice surface can use it.
import {requireThat,distance} from '../private/toolpath/numeric.mjs';
import {PRINT_RESOLUTION_MM,ROUNDING_RELATIVE,CONSTRUCTION_TOLERANCE_MM} from '../dimensions.mjs';
import {sampleSurfaceCurve} from './normal-surface.mjs';
import {sampledPositiveIntervals} from '../geom/curve-sampling.mjs';
import {lineSpacing,spacingFactor} from '../path/spacing.mjs';
import {clipPatternCurves} from './fill-patterns.mjs';
import {evaluateSurface} from '../geom/surface-evaluation.mjs';
import {connectScanlineCells} from './region2d.mjs';

// Process scale: default sampling step and chord tolerance (a fortieth of a 0.4 mm line).
export function metricFillStrokes(chart,region,{widthMm:w,density=1,spacingFactor:spacing=1,sampleStepMm=.5,toleranceMm=CONSTRUCTION_TOLERANCE_MM,direction='axial',heightMm=.2,speedMmS,startU=0,axialStart=0,layoutChart=chart}){
  if(!region.length||density===0)return {strokes:[],report:{points:0}};
  // Cell coordinates are normalized locally; authored charts keep their domains.
  if(chart.kind!=='surface-chart'){
    const domains=chart.kind==='patch'?[chart.patch.domainU,chart.patch.domainV]:[0,1].map(k=>[Math.min(...region.flat().map(p=>p[k])),Math.max(...region.flat().map(p=>p[k]))]);
    const actual=([u,v])=>[u,v].map((n,k)=>domains[k][0]+n*(domains[k][1]-domains[k][0]));
    const normalized=source=>({kind:'surface-chart',periodicU:source.periodicU??source.patch?.periodicU??false,breaksU:[],at:(u,v)=>{const e=evaluateSurface(source,actual([u,v]));return {...e,du:e.du.map(n=>n*(domains[0][1]-domains[0][0])),dv:e.dv.map(n=>n*(domains[1][1]-domains[1][0]))};}});
    const result=metricFillStrokes(normalized(chart),region.map(loop=>loop.map(p=>p.map((n,k)=>(n-domains[k][0])/(domains[k][1]-domains[k][0])))),{widthMm:w,density,spacingFactor:spacing,sampleStepMm,toleranceMm,direction,heightMm,speedMmS,startU,axialStart,layoutChart:normalized(layoutChart)});
    return {...result,strokes:result.strokes.map(stroke=>({...stroke,surfaceSamples:stroke.surfaceSamples.map(e=>{const [u,v]=actual([e.u,e.v]);return {...e,u,v};})}))};
  }
  const s={normalMm:heightMm,spacingFactor:spacing,sampleStepMm,toleranceMm,directions:[direction]},p={planarSpeedMmS:speedMmS};
  const trackPitch=lineSpacing(w,s)/density,factor=spacingFactor(s);

  // Chord tolerance and step target decide how many samples every curve needs;
  // survey and cell counts follow the measured surface, not a fixed budget.
  const options={toleranceMm:s.toleranceMm,maxStepMm:s.sampleStepMm};
  let points=0;const emitted=[];
  const report={backend:chart.backend,slices:1,points:0,partialAxialPasses:0,fullAxialPasses:0,axialPasses:0,
    coverage:'Arc-length cells in each U sector; partial axial courses start/end where a cell appears/disappears. Sampled coverage, not a global geodesic guarantee.',
    physicalValidation:'not performed'};
  const newStroke=role=>({role,closed:false,surfaceSamples:[],cellWidthsMm:[],heightMm:s.normalMm,speedMmS:p.planarSpeedMmS});
  const emit=(stroke,samples,widths)=>{
    points+=samples.length;stroke.surfaceSamples.push(...samples);stroke.cellWidthsMm.push(...widths);
    stroke.widthAxis=stroke.role==='axial'?'du':'dv';
  };
  // Sampled longest meridian controls V survey resolution and hoop pitch.
  let meridianMax=0;
  for(let i=0;i<32;i++){
    const samples=sampleSurfaceCurve(layoutChart,t=>[i/32,t],0,options);
    meridianMax=Math.max(meridianMax,samples.slice(1).reduce((n,e,j)=>n+distance(samples[j].point,e.point),0));
  }
  requireThat(meridianMax>w,'Surface region must exceed one bead width to leave a positive centerline span.');
  // Print resolution in the normalized axial parameter, measured on the longest meridian.
  const margin=w/(2*meridianMax),v0=margin,v1=1-margin,vResolution=PRINT_RESOLUTION_MM/meridianMax;
  const nv=Math.max(32,Math.ceil(meridianMax/s.sampleStepMm));
  const vs=Array.from({length:nv+1},(_,i)=>v0+(v1-v0)*i/nv);
  const wrap=u=>u-Math.floor(u),phase=chart.periodicU?wrap(startU):0;
  const parameter=u=>chart.periodicU?wrap(u+phase):u;
  const cuts=[...new Set([0,1,...(chart.breaksU??[]).map(u=>chart.periodicU?wrap(u-phase):u).filter(u=>u>0&&u<1)])].sort((a,b)=>a-b);
  const strokes=[],mode=s.directions[0],axial=mode==='axial',windingSign=mode==='reverse'?-1:1;
    if(axial){
      for(let sector=0;sector<cuts.length-1;sector++){
        const ua=cuts[sector],ub=cuts[sector+1],cache=new Map();
        const ring=v=>{
          if(cache.has(v))return cache.get(v);
          const samples=sampleSurfaceCurve(chart,t=>[parameter(ua+(ub-ua)*t),v],0,options).map(e=>({...e,u:ua+(ub-ua)*e.t})),lengths=[0];
          for(let i=1;i<samples.length;i++)lengths.push(lengths.at(-1)+distance(samples[i-1].point,samples[i].point));
          const result={samples,lengths,length:lengths.at(-1)};cache.set(v,result);return result;
        };
        const lengths=vs.map(v=>ring(v).length),count=Math.ceil(Math.max(...lengths)/trackPitch);
        for(let k=0;k<count;k++){
          const threshold=k*trackPitch;
          const centerAt=v=>{
            const r=ring(v),cellWidth=Math.max(0,Math.min(trackPitch,r.length-threshold)),width=cellWidth*density/factor,arc=Math.min(r.length,threshold+cellWidth/2);
            let lo=0,hi=r.lengths.length-1;while(hi-lo>1){const m=(lo+hi)>>1;if(r.lengths[m]<arc)lo=m;else hi=m;}
            const f=(arc-r.lengths[lo])/(r.lengths[hi]-r.lengths[lo]||1),u=r.samples[lo].u+(r.samples[hi].u-r.samples[lo].u)*f;
            return {u:parameter(u),width};
          };
          const run=(a,b)=>{
            if(b-a<vResolution)return;
            let samples=sampleSurfaceCurve(chart,t=>{const v=a+(b-a)*t;return [centerAt(v).u,v];},0,options);
            let widths=samples.map(e=>centerAt(e.v).width);
            const stroke={...newStroke('axial'),cellFamily:sector,cellRow:k};emit(stroke,samples,widths);strokes.push(stroke);
            report.axialPasses++;
            if(a>v0+vResolution||b<v1-vResolution)report.partialAxialPasses++;else report.fullAxialPasses++;
          };
          for(const [a,b] of sampledPositiveIntervals(v=>ring(v).length-threshold,vs,lengths.map(n=>n-threshold)))run(a,b);
        }
      }
    }else if(!chart.periodicU){
      requireThat(mode==='circumferential','Helical traversal needs a periodic chart; choose axial or circumferential rows on an open chart.');
      const count=Math.ceil(meridianMax/trackPitch);
      for(let i=0;i<count;i++){
        const v=Math.min(v1,(i+.5)*trackPitch/meridianMax),samples=sampleSurfaceCurve(chart,t=>[t,v],0,options);
        const stroke={...newStroke('circumferential'),cellFamily:0,cellRow:i};emit(stroke,samples,samples.map(()=>w));strokes.push(stroke);
      }
    }else{
      // A continuous periodic course. V advances by physical meridian pitch;
      // local width scales with the native metric, rather than assuming U/V mm.
      const turns=Math.ceil(meridianMax/trackPitch)+1,pitch=1/(turns-1),beadPitch=pitch*density/factor,totalTurns=turns-1+density/factor;
      let circumferenceMax=0;
      for(const v of [0,.25,.5,.75,1]){const ring=sampleSurfaceCurve(layoutChart,t=>[t,v],0,options);
        circumferenceMax=Math.max(circumferenceMax,ring.slice(1).reduce((n,e,j)=>n+distance(ring[j].point,e.point),0));}
      const perTurn=Math.max(64,Math.ceil(circumferenceMax/s.sampleStepMm)),count=Math.ceil(totalTurns*perTurn),stroke={...newStroke('circumferential'),orderGroup:'metric:circumferential:0',cellId:'circumferential:0',directionRequired:mode==='forward'||mode==='reverse'};
      const samples=[],widths=[];
      const uvAt=progress=>{const raw=-beadPitch/2+progress*pitch,u=startU+windingSign*progress;return [u-Math.floor(u),Math.max(v0,Math.min(v1,raw))];};
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
        const section=sampleSurfaceCurve(chart,t=>uvAt(progressAt(t)),0,options);
        for(const e of section.slice(i?1:0)){
          const rawV=-beadPitch/2+progressAt(e.t)*pitch,local=Math.hypot(...e.dv);
          samples.push(e);widths.push(Math.max(0,Math.min(beadPitch,rawV+beadPitch/2,1+beadPitch/2-rawV))*local);
        }
      }
      emit(stroke,samples,widths);strokes.push(stroke);
    }
  emitted.push(...strokes);
  report.points=points;report.meridianSurveyMm=meridianMax;report.axialSurveyRows=nv+1;
  const full=region.length===1&&region[0].length===4&&region[0].every(([u,v])=>(u===0||u===1)&&(v===0||v===1));
  const clipped=full?emitted:emitted.flatMap(stroke=>{
    const {surfaceSamples,...attributes}=stroke;
    let turn=0;
    const path=surfaceSamples.map((e,i)=>{
      if(chart.periodicU&&i){const delta=e.u-surfaceSamples[i-1].u;if(delta>.5)turn--;else if(delta<-.5)turn++;}
      return [e.u+turn,e.v];
    });
    let clippingRegion=region;
    if(chart.periodicU){
      const us=path.map(p=>p[0]),lo=Math.floor(Math.min(...us)),hi=Math.floor(Math.max(...us));
      clippingRegion=[];
      for(let i=lo;i<=hi;i++)clippingRegion.push(...region.map(loop=>loop.map(([u,v])=>[u+i,v])));
    }
    return clipPatternCurves([{...attributes,points:path}],clippingRegion).map(({points,...fragment})=>({...fragment,
      surfaceSamples:points.map(([u,v])=>evaluateSurface(chart,[chart.periodicU?wrap(u):u,v]))}));
  });
  report.points=clipped.reduce((sum,stroke)=>sum+stroke.surfaceSamples.length,0);
  const families=new Map(),ungrouped=[];
  for(const stroke of clipped){
    if(stroke.cellFamily===undefined){ungrouped.push(stroke);continue;}
    if(!families.has(stroke.cellFamily))families.set(stroke.cellFamily,new Map());
    const rows=families.get(stroke.cellFamily),row=rows.get(stroke.cellRow)??[],values=stroke.surfaceSamples.map(p=>axial?p.v:p.u);
    row.push({left:Math.min(...values),right:Math.max(...values),row:stroke});rows.set(stroke.cellRow,row);
  }
  const grouped=[];
  for(const [family,rows] of families){
    const indices=[...rows.keys()].sort((a,b)=>a-b);
    function* intervals(){for(let i=indices[0];i<=indices.at(-1);i++)yield (rows.get(i)??[]).sort((a,b)=>a.left-b.left||a.right-b.right);}
    for(const [cell,members] of connectScanlineCells(intervals(),{tolerance:ROUNDING_RELATIVE,startReversed:axial&&Boolean(axialStart%2)}).entries())for(const member of members){
      const {cellFamily,cellRow,...stroke}=member;
      grouped.push({...stroke,cellId:family+':'+cell,orderGroup:'metric:'+family+':'+cell});
    }
  }
  return {strokes:[...grouped,...ungrouped],report};
}
