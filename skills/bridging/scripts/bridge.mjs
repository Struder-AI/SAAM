import {requireThat,distance} from '../../../core/geom/tolerance.mjs';
import {pointSegmentDistance} from '../../../core/region/region2d.mjs';

export const BRIDGING_DEFAULTS={enabled:false,maxExcursionMm:10,bridges:[]};
const fields='attachmentSpeedMmS,flowMultiplier,id,jogMm,leadInMm,mode,overlapMm,pressMm,rails,speedMmS';
const point=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);

export function validateBridging(settings){
  requireThat(typeof settings.enabled==='boolean'&&Number.isFinite(settings.maxExcursionMm)&&settings.maxExcursionMm>0&&Array.isArray(settings.bridges),'Invalid bridging settings.');
  const ids=new Set();
  for(const b of settings.bridges){
    requireThat(b&&Object.keys(b).sort().join()===fields&&/^[a-z][a-z0-9-]*$/.test(b.id)&&!ids.has(b.id),'Invalid or duplicate bridge record.');ids.add(b.id);
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
      supportSegments.push({a:ps[i-1],b:ps[i],z:ps[i][2],radius:(s.beadWidthMm??width)/2});
  }
  const supported=(p,z)=>supportSegments.some(s=>Math.abs(s.z-(z-height))<1e-6&&
    p[0]>=Math.min(s.a[0],s.b[0])-s.radius-.015&&p[0]<=Math.max(s.a[0],s.b[0])+s.radius+.015&&
    p[1]>=Math.min(s.a[1],s.b[1])-s.radius-.015&&p[1]<=Math.max(s.a[1],s.b[1])+s.radius+.015&&
    pointSegmentDistance(p,s.a,s.b)<=s.radius+.015);
  const operations=[],reports=[];
  let after=modelResults.flatMap(r=>r.operations.map(op=>op.id));
  for(const [index,b] of settings.bridges.entries()){
    const rails=b.rails.map(r=>r.map(([x,y,z])=>[x+plan.placement.xMm,y+plan.placement.yMm,z]));
    const anchors=rails.map((rail,side)=>rail.map((p,i)=>{
      const q=rails[1-side][i],d=Math.hypot(p[0]-q[0],p[1]-q[1]);
      return [p[0]+(p[0]-q[0])*b.overlapMm/d,p[1]+(p[1]-q[1])*b.overlapMm/d,p[2]];
    }));
    const strokes=[];
    const add=(role,points,speed=b.attachmentSpeedMmS,flow=1)=>{
      if(points.every(p=>distance(p,points[0])<1e-9))return;
      strokes.push({role,closed:false,points,speedMmS:speed,beadAreaMm2:width*height*flow});
    };
    const press=a=>{if(b.pressMm)add('bridge-press',[a,[a[0],a[1],a[2]-b.pressMm],a]);};
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
      add('bridge-span',[rails[side][i],rails[1-side][i]],b.speedMmS,b.flowMultiplier);
      add('bridge-attach',[rails[1-side][i],z]);
      press(z);
    }
    const all=strokes.flatMap(s=>s.points),low=Math.min(...all.map(p=>p[2])),high=Math.max(...all.map(p=>p[2]));
    requireThat(high-low<=settings.maxExcursionMm+1e-8,`Bridge ${b.id} exceeds its total Z excursion limit.`);
    requireThat(b.pressMm<height,`Bridge ${b.id} press must remain within the attachment layer.`);
    if(bounds)requireThat(all.every(p=>p.every((v,i)=>v>=(i===2?bounds.min[i]:bounds.min[i]+width/2)-1e-8&&v<=(i===2?bounds.max[i]:bounds.max[i]-width/2)+1e-8)),`Bridge ${b.id} exceeds selected tool bounds.`);
    for(const s of strokes)if(s.role!=='bridge-span'){
      const nominalZ=Math.max(...s.points.map(p=>p[2]));
      for(let i=1;i<s.points.length;i++){
        const a=s.points[i-1],z=s.points[i],n=Math.max(1,Math.ceil(distance(a,z)/.1));
        for(let j=0;j<=n;j++)requireThat(supported(a.map((v,k)=>v+(z[k]-v)*j/n),nominalZ),`Bridge ${b.id} ${s.role} leaves the emitted supporting wall.`);
      }
    }
    if(b.mode==='alternating')for(let i=1;i<strokes.length;i++)requireThat(distance(strokes[i-1].points.at(-1),strokes[i].points[0])<1e-9,`Bridge ${b.id} contains a disconnected continuous path.`);
    const id='bridging:'+b.id;
    operations.push({id,layerId:id,layer:Math.round(high/height),rank:index,phase:'bridging',order:'given',continuous:true,
      after,strokes,travelPolicy:{maxCombMm:0,canTravelDirect:()=>false,clearanceFor:()=>high+plan.process.liftMm}});
    after=[id];
    reports.push({id:b.id,mode:b.mode,spans:rails[0].length,minZMm:low,maxZMm:high,excursionMm:high-low});
  }
  return {id:'bridging',operations,report:{bridges:reports,physicalValidation:'not performed'}};
}
