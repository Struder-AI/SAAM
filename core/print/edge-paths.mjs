// One manufacturing boundary for membrane/bridge spans and advancing fronts.
// Geometry builds the same edge surface; wrappers choose process and terminology.
import {selectManufacturedEdge,selectEdge} from './manufactured-edges.mjs';
import {curveAssignment} from './curves.mjs';
import {geometryOperations} from '../geom/operations.mjs';
import {PRINT_RESOLUTION_MM} from '../dimensions.mjs';
import {requireThat,dot,cross,normalize,subtract} from '../geom/tolerance.mjs';

const positive=(value,name)=>{requireThat(Number.isFinite(value)&&value>0,name+' must be positive.');return value;};

export async function constructEdgePaths(plan,request){
  requireThat(request&&Object.keys(request).every(key=>['id','mode','base','target','correspondence','spacingMm','layerHeightMm','beadWidthMm','speedMmS','sampleStepMm','angleDeg','normalSide'].includes(key)),
    'Edge construction selects base and optional target edges with process and spacing.');
  requireThat(typeof request.id==='string'&&/^[a-z][a-z0-9-]*$/.test(request.id),'Choose a lowercase edge-construction id.');
  requireThat(['span','wave'].includes(request.mode),'Choose span or wave edge construction.');
  requireThat(request.normalSide===undefined||[1,-1].includes(request.normalSide),'normalSide must be 1 or -1.');
  requireThat(request.correspondence===undefined||Object.keys(request.correspondence).every(key=>['baseDirection','landingDirection','baseSeam','landingSeam'].includes(key)),'Correspondence selects edge directions and seams.');
  const Geometry=geometryOperations(),base=await selectManufacturedEdge(plan,request.base),target=request.target?await selectEdge(plan,request.target):null;
  const part=base.reference.part??null;
  requireThat(!target||(target.reference?.part??target.part??null)===part,'Bounding edges must use the same part frame.');
  const process={...plan.process,...base.process},height=positive(request.layerHeightMm??process.layerMm,'layerHeightMm');
  const width=positive(request.beadWidthMm??process.lineWidthMm,'beadWidthMm'),speed=positive(request.speedMmS??process.planarSpeedMmS,'speedMmS');
  const spacing=positive(request.spacingMm??width,'spacingMm'),sampleStepMm=positive(request.sampleStepMm??width/2,'sampleStepMm');
  const normal=base.materialNormal?.map(v=>v*(request.normalSide??1));
  const curves=[],after=[base.reference],repetitionIds=[],repetitionAfter={};
  if(request.mode==='wave'){
    requireThat(target,'An advancing front needs its base edge and final geometric edge.');
    const pair=Geometry.curvePairSurface(base.curve,target.curve,{correspondence:request.correspondence,normal});
    const count=Math.max(1,Math.ceil(pair.averageAdvanceMm/spacing));
    requireThat(pair.averageAdvanceMm>PRINT_RESOLUTION_MM&&Number.isSafeInteger(count),'Base and target edges must have a representable nonzero separation.');
    for(let i=0;i<count;i++){
      const name='front-'+i;repetitionIds.push(name);if(i)repetitionAfter[name]=['front-'+(i-1)];
      curves.push({id:name,closed:false,uv:{reference:{kind:'surface',surface:pair.surface},points:[[0,(i+1)/count],[1,(i+1)/count]]},
        repetitions:[i],role:'edge-front',directionRequired:false,seamRequired:false,beadWidthMm:width,heightMm:height,speedMmS:speed,sampleStepMm});
    }
  }else{
    let rows,referenceNormal=normal;
    if(target){
      requireThat(target.reference,'Both bridge bounds must name printed edges; a geometric target is sufficient only for a wave.');
      const pair=Geometry.curvePairSurface(base.curve,target.curve,{correspondence:request.correspondence,normal}),at=Geometry.referenceSurface(pair.surface);
      const first=Geometry.sampleSpatialCurve(base.curve,{toleranceMm:PRINT_RESOLUTION_MM/2,sampleStepMm}),second=Geometry.sampleSpatialCurve(target.curve,{toleranceMm:PRINT_RESOLUTION_MM/2,sampleStepMm});
      const count=Math.max(1,Math.ceil(Math.max(Geometry.curveLength(first.samples.map(s=>s.point)),Geometry.curveLength(second.samples.map(s=>s.point)))/spacing));
      rows=Array.from({length:count+(base.closed?0:1)},(_,i)=>[at(i/count,0).point,at(i/count,1).point]);
      referenceNormal??=at(.37,.5).normal;after.push(target.reference);
    }else ({rows,normal:referenceNormal}=Geometry.closedEdgeSpans(base.curve,{spacingMm:spacing,normal,angleDeg:request.angleDeg,sampleStepMm}));
    requireThat(rows.length,'The selected boundary produces no bridge spans.');
    const shifted=rows.map((row,i)=>{
      const neighbor=rows[i+1]??rows[i-1],sense=i===rows.length-1?-1:1,span=subtract(row[1],row[0]);
      return row.map((point,end)=>{
        const tangent=neighbor?subtract(neighbor[end],point).map(v=>v*sense):cross(span,referenceNormal);
        const raw=cross(tangent,span),n=Math.hypot(...raw)>PRINT_RESOLUTION_MM**2?normalize(raw):referenceNormal;
        const sign=dot(n,referenceNormal)<0?-1:1;
        return point.map((v,k)=>v+height*sign*n[k]);
      });
    });
    for(const [i,row] of shifted.entries()){
      const span=subtract(row[1],row[0]),side=normalize(cross(span,referenceNormal));
      const neighbor=shifted[i+1]??shifted[i-1]??row.map(point=>point.map((v,k)=>v+spacing*side[k])),before=shifted.length>1&&i===shifted.length-1;
      const controls=before?[neighbor,row]:[row,neighbor],u=before?1:0;
      const a=subtract(controls[1][0],controls[0][0]),b=subtract(row[1],row[0]),orientation=dot(cross(a,b),referenceNormal)>=0?1:-1;
      curves.push({id:'span-'+i,closed:false,interruptible:false,directionRequired:false,
        uv:{reference:{kind:'surface',surface:{kind:'spline',degreeU:1,degreeV:1,controlPoints:controls,sizeMm:[1,1],normalSide:orientation}},points:[[u,0],[u,1]]},
        role:'bridge-span',beadWidthMm:width,heightMm:height,speedMmS:speed,sampleStepMm});
    }
  }
  return {assignment:curveAssignment({id:request.id,part,filament:null,after,curves,toolPose:{alignToSliceNormal:true},
    ...(repetitionIds.length?{repeat:{count:repetitionIds.length,translation:[0,0,0]},repetitionIds,repetitionAfter}:{})}),
    report:{mode:request.mode,base:base.reference,...(target?{target:target.reference??target.selection}:{}),curves:curves.length,
      prerequisites:after,scope:request.mode==='wave'?'Only the base edge is a printed prerequisite; the target defines geometry.':'Straight spans require their supporting boundary edges.'}};
}
