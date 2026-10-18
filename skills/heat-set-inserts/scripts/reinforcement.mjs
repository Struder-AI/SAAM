// Heat-set policy uses the source Slice's actual layer chart and resolved
// dimensions. Geometry owns sectioning, physical offsets and clipping.
import {heatSetFeature,dimensions,borePoint} from './feature.mjs';

const requireThat=(condition,message)=>{if(!condition)throw Error(message);};
const bounds=loops=>[0,1].map(k=>[Math.min(...loops.flat().map(p=>p[k])),Math.max(...loops.flat().map(p=>p[k]))]);

// The finite seat and blind pad use the same radial Geometry construction as
// the bore. Their depth remains independent of its through/outward clearance.
function seatGeometry(feature,shift,Geometry){
  const {diameterMm,depthMm}=dimensions(feature),radius=diameterMm/2;
  const profile=[[0,radius+feature.chamferDepthMm*Math.tan(feature.chamferAngleDeg*Math.PI/180)]];
  if(feature.chamferDepthMm>0)profile.push([feature.chamferDepthMm,radius]);
  profile.push([depthMm,radius]);
  return Geometry.buildGeometry(Geometry.revolvedProfile({positionMm:feature.positionMm.map((value,k)=>value+shift[k]),axis:feature.axis,profile}));
}

// These are zero-thickness construction sheets fixed in the bore frame.
// Their tips do not move as the source loop count or layer orientation changes.
export function heatSetFinSheets(feature,shift=[0,0,0]){
  const {diameterMm,depthMm}=dimensions(feature),radius=diameterMm/2;
  const count=feature.finCount??Math.ceil(Math.PI*diameterMm/2);
  return Array.from({length:count},(_,i)=>{
    const angle=(feature.finAngleDeg+i*360/count)*Math.PI/180;
    const at=(r,s)=>borePoint(feature,r,angle,s).map((value,k)=>value+shift[k]);
    return {degreeU:1,degreeV:1,controlPoints:[
      [at(radius,0),at(radius,-depthMm)],
      [at(radius+feature.finLengthMm,0),at(radius+feature.finLengthMm,-depthMm)]]};
  });
}

// A two-bead fin must retain at least half a bead of overlap between layers.
// The local across-fin drift is normal layer gap * cot(sheet/slice angle).
function finRetainsOverlap(sheet,cut,source,width,Geometry){
  const [a,b]=sheet.controlPoints[0],c=sheet.controlPoints[1][0];
  const u=b.map((v,k)=>v-a[k]),v=c.map((x,k)=>x-a[k]);
  const cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
  const length=Math.hypot(...cross),normal=cross.map(x=>x/length);
  const direction=source.direction,step=source.translationMm;
  const dot=(a,b)=>a.reduce((sum,x,k)=>sum+x*b[k],0);
  return cut.curves.every(curve=>curve.points.every((point,i)=>{
    const samples=i?[point,point.map((x,k)=>(x+curve.points[i-1][k])/2)]:[point];
    return samples.every(uv=>{
      const n=Geometry.evaluateSurface(source.slice,uv).normal;
      if(!n)return false;
      const cosine=Math.min(1,Math.abs(dot(normal,n))),sine=Math.sqrt(Math.max(0,1-cosine*cosine));
      const gap=direction&&Number.isFinite(step)?step*Math.abs(dot(n,direction))/Math.hypot(...direction):source.heightMm??source.process.layerMm;
      return sine>0&&1.5*width*sine>=gap*cosine;
    });
  }));
}

export function heatSetTraceSource({Geometry,Toolpath}){
  const needed=['buildGeometry','revolvedProfile','section','offsetSliceRegion','strokeSliceRegion','intersectSurfaceSheet','clipSliceCurves','evaluateSurface','union','intersect','difference','loopArea','regionArea'];
  requireThat(needed.every(k=>typeof Geometry[k]==='function'),'Heat-set reinforcement needs the general Geometry layer-source connectors.');
  requireThat(typeof Toolpath?.fillSliceRegion==='function','Heat-set blind pads need the general Toolpath region-fill connector.');
  const cache=new Map();
  return {constructLayer({source,parameters}){
    requireThat(parameters&&Object.keys(parameters).every(k=>['feature','toleranceMm'].includes(k)),'Heat-set Trace source needs an editable feature and bore tolerance.');
    const toleranceMm=parameters.toleranceMm??.01;
    requireThat(Number.isFinite(toleranceMm)&&toleranceMm>0,'Heat-set bore tolerance must be positive.');
    const feature=heatSetFeature(parameters.feature),shift=source.placement?.offset??[0,0,0];
    const key=JSON.stringify([feature,shift,toleranceMm]);let construction=cache.get(key);
    if(!construction){
      construction={seat:seatGeometry(feature,shift,Geometry),sheets:heatSetFinSheets(feature,shift)};
      cache.set(key,construction);
    }
    const {slice,settings,process}=source,width=source.widthMm??process.lineWidthMm,pitch=source.pitchMm??width*settings.spacingFactor;
    const loops=settings.loops,inset=source.wallInsetMm??settings.loopInsetMm??width/2;
    requireThat(Number.isInteger(loops)&&loops>=0&&width>0&&pitch>0,'Source layer needs resolved loop count, width and pitch.');
    const total=Math.max(4,loops+1),added=total-loops;
    const material=source.material??source.region;
    if(!material?.length||!source.region?.length)return {curves:[],report:{feature:feature.id,sourceLoops:loops,targetLoops:total,addedLoops:added,emptyMaterial:true}};
    const cutter=Geometry.section(construction.seat,slice).loops;
    const matched=material.filter(loop=>Geometry.loopArea(loop)<0&&Geometry.regionArea(Geometry.intersect([[...loop].reverse()],cutter))>0);
    // A complete source bore supplies its exact contour; open notches retain
    // the finite actual cutter section and are clipped to the real host.
    const seat=matched.length?matched.map(loop=>[...loop].reverse()):cutter;
    
    const options={sampleStepMm:settings.sampleStepMm,maxStepMm:settings.sampleStepMm,boundsUv:bounds(material)};
    // Keep Trace centers outside every actual material boundary's main wall
    // band. The added walls and fins deliberately do not exclude main infill.
    const wallBand=loops?inset+(loops-1)*pitch+width/2:0;
    const lastFront=(source.perimeters??[]).filter(curve=>curve.closed&&curve.ringIndex===loops-1).map(curve=>curve.points);
    const wallRoom=loops&&lastFront.length?Geometry.offsetSliceRegion(slice,lastFront,-width,options):
      Geometry.offsetSliceRegion(slice,material,-(wallBand+width/2),options);
    const room=Geometry.intersect(source.region,Geometry.intersect(wallRoom,Geometry.offsetSliceRegion(slice,material,-width/2,options)));
    const inherited=(source.perimeters??[]).filter(curve=>curve.closed&&Geometry.loopArea(curve.points)<0&&
      Geometry.regionArea(Geometry.intersect([[...curve.points].reverse()],seat))>0).sort((a,b)=>Math.abs(Geometry.loopArea(b.points))-Math.abs(Geometry.loopArea(a.points)))[0];
    const origin=loops&&inherited?[[...inherited.points].reverse()]:seat;
    const first=loops&&inherited?Math.max(pitch,((inherited.beadWidthMm??width)+width)/2):
      loops?Math.max(inset+loops*pitch,wallBand+width/2):width/2;
    const curves=[],clipping=[],notes=[];
    let finCount=0,skippedShallowFins=0;
    // Fin sheets can cross a layer that misses the seat entirely (for example,
    // above or below a sideways bore). They still contribute on that layer.
    for(let i=0;i<added;i++){
      let outline=Geometry.offsetSliceRegion(slice,origin,first+i*pitch,options);
      if(i===added-1&&construction.sheets.length){
        let finRegion=[];
        for(const sheet of construction.sheets){
          const cut=Geometry.intersectSurfaceSheet(slice,sheet,options);
          if(cut.report?.notes?.length)notes.push(...cut.report.notes);
          if(cut.report?.coincident){skippedShallowFins++;continue;}
          if(!cut.curves.length)continue;
          if(!finRetainsOverlap(sheet,cut,source,width,Geometry)){skippedShallowFins++;continue;}
          const footprint=Geometry.strokeSliceRegion(slice,cut.curves,width/2,options).loops;
          // A physical half-width buffer gives the two fin bead centerlines,
          // separated by one bead width. Union joins their return into the wall.
          const outside=Geometry.difference(footprint,outline);
          if(!outside.length)continue;
          finRegion=Geometry.union(finRegion,footprint);finCount++;
        }
        if(finRegion.length)outline=Geometry.union(outline,finRegion);
      }
      if(!outline.length)continue;
      const requested=outline.map(points=>({closed:true,points}));
      const clipped=Geometry.clipSliceCurves(slice,requested,room,options);
      clipping.push(clipped.report);
      let fragments=clipped.curves;

      curves.push(...fragments.map(curve=>({closed:curve.closed,uv:{reference:{kind:'slice',assignment:source.stackId,index:source.index},points:curve.points},
        role:i===added-1?'heat-set-star':'heat-set-loop',beadWidthMm:width,sampleStepMm:settings.sampleStepMm})));
    }
    if(seat.length&&construction.sheets.length&&!finCount)notes.push('The fixed fin sheets do not extend beyond this layer’s added outer wall or do not cross its surface.');
    let pad=null;
    if(!feature.throughHole){
      const count=Math.max(settings.solidTop,settings.solidBottom);
      const gap=source.heightMm??process.layerMm,thickness=count*gap;
      if(thickness>0){
        const {diameterMm,depthMm}=dimensions(feature),floor=borePoint(feature,0,0,-depthMm);
        const padRadius=diameterMm/2+Math.max(feature.finLengthMm+width,total*pitch+width/2);
        const guide={...feature,positionMm:floor,depthMm:thickness,diameterAdjustmentMm:2*padRadius-diameterMm+feature.diameterAdjustmentMm,
          chamferDepthMm:0};
        const key=JSON.stringify(['pad',guide,shift,toleranceMm]);let volume=cache.get(key);
        if(!volume){volume=seatGeometry(guide,shift,Geometry);cache.set(key,volume);}
        let region=Geometry.intersect(Geometry.section(volume,slice).loops,room);
        const dense=source.denseRegion?.length?Geometry.offsetSliceRegion(slice,source.denseRegion,width/2,options):[];
        region=Geometry.difference(region,dense);
        if(region.length){
          const filled=Toolpath.fillSliceRegion(region,{source,role:'heat-set-base-pad'});
          curves.push(...filled.curves);
          pad={radiusMm:padRadius,depthMm:thickness,solidLayers:count,curves:filled.curves.length,
            fill:filled.report,denseCoverageExcluded:true};
        }
      }
    }
    if(feature.finWidthMm!==null)notes.push('Legacy finWidthMm is retained for reading; the star uses two touching beads at the inherited layer width.');
    return {curves,sliceMember:true,report:{feature:feature.id,sourceLoops:loops,targetLoops:total,addedLoops:added,curves:curves.length,openFragments:curves.filter(c=>!c.closed).length,
      pad,outsideSeat:!seat.length,finIntersections:finCount,skippedShallowFins,finSheets:construction.sheets.length,widthMm:width,pitchMm:pitch,clipping,notes,
      boreBoundary:matched.length?'source material hole':'open cutter section',infillOverlap:'added walls and star fins intentionally overlap the unchanged main infill'}};
  }};
}