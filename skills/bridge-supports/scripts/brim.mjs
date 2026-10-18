// Ordinary first-layer Trace contours around the support footprint. Geometry owns
// offsets and clipping; the extension chooses three adhesion passes and clearance.
export async function addSupportBrim(assignment,source,Geometry,{baseOnBed,component,otherAssignments}){
  if(!baseOnBed)return {requestedPasses:3,curves:0,notes:['Bed brim omitted on a printed base; author adhesion contours supported by that base.']};
  const width=assignment.curves[0].beadWidthMm,height=source.process.firstLayerMm??source.process.layerMm;
  const tolerance=width/400,origin=[component?.xMm??0,component?.yMm??0,component?.zMm??0],z=height-origin[2];
  const sample=curve=>{const input=curve.geometry?source.geometry.curves.find(c=>c.id===curve.geometry):curve;return Geometry.sampleSpatialCurve(input.uv?{...input.uv,closed:input.closed,surface:Geometry.referenceSurface(input.uv.reference.surface)}:input,{toleranceMm:tolerance,sampleStepMm:width/2}).samples.map(s=>s.point);};
  const first=assignment.curves.filter(c=>c.repetitions.includes(0)).map(c=>({closed:c.closed,points:sample(c).map(([x,y])=>[x,y,z])}));
  const blocked=[];
  if(source.geometry){
    const solid=source.geometry.shape==='spatial'?source.geometry.solid:source.geometry;
    const [material]=solid?await Geometry.resolveGeometrySelections(solid,[{}]):[];
    if(material)for(const level of [height/2,height])blocked.push(...Geometry.section(material,Geometry.horizontalSlice(level)).loops.map(loop=>loop.map(([x,y])=>[x-origin[0],y-origin[1]])));
  }
  for(const other of otherAssignments){
    if(other.construction!=='curves'||other.id===assignment.id)continue;
    const part=source.geometry?.solid?.parts?.find(p=>p.id===other.part),translation=[part?.xMm??0,part?.yMm??0,part?.zMm??0];
    for(const record of other.curves??[]){
      const native=record.geometry?source.geometry?.curves?.find(c=>c.id===record.geometry):record;
      if(!native)continue;
      const points=sample(native).map(p=>p.map((v,k)=>v+translation[k]-origin[k]));
      if(points.every(p=>p[2]>z+height||p[2]<z-height))continue;
      blocked.push(...Geometry.widenPlanarStrokes([{closed:native.closed,points:points.map(([x,y])=>[x,y,z])}],(record.beadWidthMm??width)/2,{origin:[0,0,z],xAxis:[1,0,0],normal:[0,0,1],arcToleranceMm:tolerance}).map(loop=>loop.map(p=>p.slice(0,2))));
    }
  }
  const obstacles=Geometry.offsetRegion(Geometry.union(blocked,[]),width/2+tolerance,{arcToleranceMm:tolerance});
  const brim=[],report={requestedPasses:3,curves:0,clippedPasses:0};
  for(let pass=1;pass<=3;pass++){
    const contours=Geometry.widenPlanarStrokes(first,pass*width,{origin:[0,0,z],xAxis:[1,0,0],normal:[0,0,1],arcToleranceMm:tolerance});
    for(const contour of contours){
      const points=contour.map(p=>p.slice(0,2)),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
      const x0=Math.min(...xs)-width,x1=Math.max(...xs)+width,y0=Math.min(...ys)-width,y1=Math.max(...ys)+width;
      const free=Geometry.difference([[[x0,y0],[x1,y0],[x1,y1],[x0,y1]]],obstacles);
      const pieces=Geometry.clipPlanarCurveToRegion({closed:true,points},free,{toleranceMm:tolerance});
      if(pieces.length!==1||!pieces[0].closed)report.clippedPasses++;
      for(const {points,...piece} of pieces)brim.push({...piece,uv:{reference:{kind:'surface',surface:{kind:'plane',origin:[0,0,z],xAxis:[1,0,0],yAxis:[0,1,0]}},points},role:'breakaway-brim',directionRequired:false,seamRequired:false,beadWidthMm:width,heightMm:height,speedMmS:source.process.firstLayerSpeedMmS??assignment.curves[0].speedMmS,repetitions:[0]});
    }
  }
  report.curves=brim.length;
  if(!brim.length){report.notes=['No brim fits outside occupied first-layer material.'];return report;}
  for(const curve of assignment.curves)curve.repetitions=curve.repetitions.map(i=>i+1);
  assignment.curves.unshift(...brim);
  assignment.repeat.count++;
  assignment.repetitionIds.unshift('brim');
  assignment.repetitionAfter['course-0']=['brim'];
  return report;
}
