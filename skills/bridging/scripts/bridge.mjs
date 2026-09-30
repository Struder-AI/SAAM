import {requireThat,distance} from '../../../core/geom/tolerance.mjs';
import {pointSegmentDistance} from '../../../core/region/region2d.mjs';

export const BRIDGING_DEFAULTS={enabled:false,maxExcursionMm:10,bridges:[]};
const fields='attachmentSpeedMmS,flowMultiplier,id,jogMm,leadInMm,mode,overlapMm,pressMm,rails,speedMmS';
const point=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);

export function validateBridging(settings){
  requireThat(typeof settings.enabled==='boolean'&&Number.isFinite(settings.maxExcursionMm)&&settings.maxExcursionMm>0&&Array.isArray(settings.bridges),'Invalid bridging settings.');
  const ids=new Set();
  for(const b of settings.bridges){
    requireThat(b&&Object.keys(b).filter(k=>!['endAttachment','supportBridge','maxSegmentMm'].includes(k)).sort().join()===fields&&/^[a-z][a-z0-9-]*$/.test(b.id)&&!ids.has(b.id),'Invalid or duplicate bridge record.');
    if(b.maxSegmentMm!==undefined)requireThat(Number.isFinite(b.maxSegmentMm)&&b.maxSegmentMm>0,'Bridge maxSegmentMm must be positive.');
    if(b.supportBridge!==undefined)requireThat(typeof b.supportBridge==='string'&&ids.has(b.supportBridge),'Bridge support must name an earlier bridge in the recipe.');
    ids.add(b.id);
    if(b.endAttachment!==undefined){
      const end=b.endAttachment;
      requireThat(end&&Object.keys(end).sort().join()==='flowMultiplier,jogMm,overlapMm,pressMm,speedMmS','Invalid end attachment settings.');
      for(const k of ['flowMultiplier','overlapMm','speedMmS'])requireThat(Number.isFinite(end[k])&&end[k]>0,`End ${k} must be positive.`);
      for(const k of ['jogMm','pressMm'])requireThat(Number.isFinite(end[k])&&end[k]>=0,`End ${k} must be nonnegative.`);
      requireThat(b.mode==='one-way','Independent end controls require one-way mode.');
    }
    requireThat(['alternating','one-way'].includes(b.mode),'Bridge mode must be alternating or one-way.');
    requireThat(Array.isArray(b.rails)&&b.rails.length===2&&b.rails.every(r=>Array.isArray(r)&&r.length>=2&&r.every(point))&&b.rails[0].length===b.rails[1].length,'Bridge rails need matching arrays of at least two XYZ gap-edge points.');
    for(const key of ['speedMmS','attachmentSpeedMmS','flowMultiplier','overlapMm'])requireThat(Number.isFinite(b[key])&&b[key]>0,`Bridge ${key} must be positive.`);
    for(const key of ['pressMm','jogMm','leadInMm'])requireThat(Number.isFinite(b[key])&&b[key]>=0,`Bridge ${key} must be nonnegative.`);
    b.rails[0].forEach((p,i)=>requireThat(Math.hypot(p[0]-b.rails[1][i][0],p[1]-b.rails[1][i][1])>0,'Bridge span needs nonzero XY length.'));
  }
}

// Gap edges and process controls are the recipe. Support walls are supplied by
// other producers; this skill never slices geometry or emits support loops.
export function bridgingResult({plan,modelResults,bounds=null}){
  const settings=plan.skills.bridging,width=plan.process.lineWidthMm,height=plan.process.layerMm;
  validateBridging(settings);
  const supportSegments=[];
  for(const result of modelResults)for(const op of result.operations)for(const s of op.strokes){
    if(!s.beadAreaMm2||s.points.length<2)continue;
    const ps=s.closed?[...s.points,s.points[0]]:s.points;
    for(let i=1;i<ps.length;i++)if(Math.abs(ps[i][2]-ps[i-1][2])<1e-8&&distance(ps[i],ps[i-1])>1e-8)
      supportSegments.push({a:ps[i-1],b:ps[i],source:null,radius:(s.beadWidthMm??width)/2});
  }
  const supported=(p,z,source)=>supportSegments.some(s=>s.source===(source??null)&&
    p[0]>=Math.min(s.a[0],s.b[0])-s.radius-.015&&p[0]<=Math.max(s.a[0],s.b[0])+s.radius+.015&&
    p[1]>=Math.min(s.a[1],s.b[1])-s.radius-.015&&p[1]<=Math.max(s.a[1],s.b[1])+s.radius+.015&&
    pointSegmentDistance(p,s.a,s.b)<=s.radius+.015&&atSupportHeight(p,z-height,s.a,s.b));
  const operations=[],reports=[];
  let after=modelResults.flatMap(r=>r.operations.map(op=>op.id));
  for(const [index,b] of settings.bridges.entries()){
    const end=b.endAttachment??{overlapMm:b.overlapMm,pressMm:b.pressMm,jogMm:0,speedMmS:b.attachmentSpeedMmS,flowMultiplier:1};
    const rails=b.rails.map(r=>r.map(([x,y,z])=>[x+plan.placement.xMm,y+plan.placement.yMm,z]));
    const anchors=rails.map((rail,side)=>rail.map((p,i)=>{
      const q=rails[1-side][i],d=Math.hypot(p[0]-q[0],p[1]-q[1]);
      const overlap=b.mode==='one-way'&&side===1?end.overlapMm:b.overlapMm;
      return [p[0]+(p[0]-q[0])*overlap/d,p[1]+(p[1]-q[1])*overlap/d,p[2]];
    }));
    const strokes=[];
    const add=(role,points,speed=b.attachmentSpeedMmS,flow=1)=>{
      if(points.every(p=>distance(p,points[0])<1e-9))return;
      strokes.push({role,closed:false,points,speedMmS:speed,beadAreaMm2:width*height*flow});
    };
    const press=(a,depth=b.pressMm,speed=b.attachmentSpeedMmS,flow=1)=>{if(depth)add('bridge-press',[a,[a[0],a[1],a[2]-depth],a],speed,flow);};
    const along=(side,i,mm)=>{
      const a=anchors[side][i],next=anchors[side][i+1]??anchors[side][i-1];
      const sign=i+1<anchors[side].length?1:-1,d=distance(a,next);
      requireThat(d>0,'Consecutive bridge anchors must differ.');
      return a.map((v,k)=>v+sign*(next[k]-a[k])*mm/d);
    };
    for(let i=0;i<rails[0].length;i++){
      const side=b.mode==='alternating'?i%2:0,a=anchors[side][i],z=anchors[1-side][i];
      if(i&&b.mode==='alternating')add('bridge-turn',[anchors[side][i-1],a]);
      if(b.leadInMm){const start=along(side,i,-b.leadInMm);if(i&&b.mode==='alternating')add('bridge-lead-position',[a,start]);add('bridge-lead',[start,a]);}
      if(b.jogMm)add('bridge-jog',[a,along(side,i,-b.jogMm),a]);
      press(a);
      add('bridge-attach',[a,rails[side][i]]);
      const from=rails[side][i],to=rails[1-side][i],segments=b.maxSegmentMm?Math.ceil(distance(from,to)/b.maxSegmentMm):1;
      add('bridge-span',Array.from({length:segments+1},(_,j)=>from.map((v,k)=>v+(to[k]-v)*j/segments)),b.speedMmS,b.flowMultiplier);
      // Distinct commanded interpolation intervals are intentional. Preserve
      // them through the shared planner's semantic-metadata merge boundary.
      if(b.maxSegmentMm)strokes.at(-1).segmentMetadata=Array.from({length:segments},(_,j)=>({bridgeSpan:i,bridgeSegment:j}));
      add('bridge-attach',[rails[1-side][i],z],end.speedMmS,end.flowMultiplier);
      press(z,end.pressMm,end.speedMmS,end.flowMultiplier);
      if(end.jogMm)add('bridge-end-jog',[z,along(1-side,i,-end.jogMm),z],end.speedMmS,end.flowMultiplier);
    }
    const all=strokes.flatMap(s=>s.points),low=Math.min(...all.map(p=>p[2])),high=Math.max(...all.map(p=>p[2]));
    requireThat(high-low<=settings.maxExcursionMm+1e-8,`Bridge ${b.id} exceeds its total Z excursion limit.`);
    requireThat(Math.max(b.pressMm,end.pressMm)<height,`Bridge ${b.id} press must remain within the attachment layer.`);
    if(bounds)requireThat(all.every(p=>p.every((v,i)=>v>=(i===2?bounds.min[i]:bounds.min[i]+width/2)-1e-8&&v<=(i===2?bounds.max[i]:bounds.max[i]-width/2)+1e-8)),`Bridge ${b.id} exceeds selected tool bounds.`);
    for(const s of strokes)if(s.role!=='bridge-span'){
      for(let i=1;i<s.points.length;i++){
        const a=s.points[i-1],z=s.points[i],n=Math.max(1,Math.ceil(distance(a,z)/.1));
        for(let j=0;j<=n;j++){
          const p=a.map((v,k)=>v+(z[k]-v)*j/n),nominalZ=s.role==='bridge-press'?Math.max(...s.points.map(p=>p[2])):p[2];
          requireThat(supported(p,nominalZ,b.supportBridge),`Bridge ${b.id} ${s.role} leaves the emitted supporting wall or named bridge.`);
        }
      }
    }
    if(b.mode==='alternating')for(let i=1;i<strokes.length;i++)requireThat(distance(strokes[i-1].points.at(-1),strokes[i].points[0])<1e-9,`Bridge ${b.id} contains a disconnected continuous path.`);
    const id='bridging:'+b.id;
    operations.push({id,layerId:id,layer:Math.round(high/height),rank:index,phase:'bridging',order:'given',continuous:true,
      after,strokes,travelPolicy:{maxCombMm:0,canTravelDirect:()=>false,clearanceFor:()=>high+plan.process.liftMm}});
    after=[id];
    // Later courses may explicitly attach to this bridge's nominal deposited
    // strands. This does not turn the open gaps into a continuous support sheet.
    for(const s of strokes)if(s.role!=='bridge-press')for(let i=1;i<s.points.length;i++)
      if(Math.hypot(s.points[i][0]-s.points[i-1][0],s.points[i][1]-s.points[i-1][1])>1e-9)
        supportSegments.push({a:s.points[i-1],b:s.points[i],source:b.id,radius:width/2});
    reports.push({id:b.id,mode:b.mode,spans:rails[0].length,minZMm:low,maxZMm:high,excursionMm:high-low});
  }
  return {id:'bridging',operations,report:{bridges:reports,physicalValidation:'not performed'}};
}

function atSupportHeight(p,z,a,b){
  const dx=b[0]-a[0],dy=b[1]-a[1],squared=dx*dx+dy*dy;
  if(squared<1e-16)return false;
  const t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/squared));
  return Math.abs(a[2]+t*(b[2]-a[2])-z)<1e-6;
}
