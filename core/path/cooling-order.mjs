// A local recency preference, never a temperature or minimum-time constraint.
import {convexBox,convexBounds,convexSpatialIndex} from '../geom/convex-clearance.mjs';
import {ROUNDING_MM} from '../dimensions.mjs';

function combinedBounds(bounds){
  const result={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
  for(const box of bounds)for(let k=0;k<3;k++){
    result.min[k]=Math.min(result.min[k],box.min[k]);result.max[k]=Math.max(result.max[k],box.max[k]);
  }
  return result;
}

export class CoolingOrder {
  constructor(source,scene){
    this.bodies=new Map();this.recent=new Map();this.clock=0;this.groups=new WeakMap();this.records=scene.byId;
    this.summary={sliceChoices:0,courseChoices:0,neighborhoodQueries:0,estimatedDepositionSeconds:0};
    for(const body of scene.byId.values()){
      const unit=body.unit,window=unit.process.minimumLayerSeconds;
      if(!(window>0))continue;
      const bounds=[];
      for(const record of body.records){
        if(!(record.depth[1]>0))continue;
        // Process-scale neighborhood: one bead width or depth around its path,
        // in all three dimensions, independent of build direction.
        const margin=Math.max(record.range.widthMm[1],record.depth[1]);
        bounds.push({min:record.range.bounds.min.map(v=>v-margin),max:record.range.bounds.max.map(v=>v+margin)});
      }
      if(unit.operation.kind==='inject'){
        const {at}=unit.operation.injection,margin=unit.process.lineWidthMm;
        bounds.push({min:at.map(v=>v-margin),max:at.map(v=>v+margin)});
      }
      if(!bounds.length)continue;
      this.bodies.set(unit.id,{bounds,unit,window});
    }
    this.entries=[...this.bodies.values()].flatMap(body=>body.bounds.map(bounds=>{
      const shape=convexBox(bounds);return {shape,bounds:convexBounds(shape),unit:body.unit};
    }));
    this.index=convexSpatialIndex(this.entries.map(body=>body.shape),{groups:this.entries.map(body=>body.unit.id),
      partitions:this.entries.map(body=>body.unit.layerId??body.unit.operation)});
    this.source=source;
  }
  heat(operations){
    if(!this.recent.size)return 0;
    // Reject a whole native slice first; only an overlapping neighborhood
    // opens its course bounds. These are heat proxies, never occupied geometry.
    if(!this.groups.has(operations)){
      const bounds=operations.flatMap(operation=>this.bodies.get(operation.id)?.bounds??[]);
      this.groups.set(operations,{bounds,shape:bounds.length?convexBox(combinedBounds(bounds)):null});
    }
    const group=this.groups.get(operations);if(!group.shape)return 0;
    this.summary.neighborhoodQueries++;
    const hits=this.index.query(group.shape,ROUNDING_MM,{boundsOnly:true,acceptGroup:id=>this.recent.has(id)});
    const hottest={remaining:0};
    for(const i of hits){
      const body=this.entries[i],remaining=this.recent.get(body.unit.id)-this.clock;
      if(remaining<=hottest.remaining)continue;
      if(group.bounds.some(candidate=>candidate.min.every((v,k)=>v<=body.bounds.max[k]+ROUNDING_MM&&
        candidate.max[k]>=body.bounds.min[k]-ROUNDING_MM)))hottest.remaining=remaining;
    }
    return hottest.remaining;
  }
  record(operation){
    const started=this.clock,body=this.bodies.get(operation.id);
    if(operation.operation.kind==='inject'){
      const injection=operation.operation.injection;
      this.clock+=injection.volumeMm3/injection.flowMm3S+injection.holdSeconds;
    }else for(const record of this.records.get(operation.id).records){
      const speed=this.source.curves[record.ref.curveId].profiles.speedMmS;
      const maximum=typeof speed==='number'?speed:speed.knots.reduce((best,[,value])=>Math.max(best,value),0);
      // Reuse the existing length/feed lower estimate. Travel and machine
      // acceleration are deliberately absent from this ordering heuristic.
      this.clock+=record.range.lengthMm[0]/maximum;
    }
    if(body)this.recent.set(operation.id,started+body.window);
    for(const [id,until] of this.recent)if(until<=this.clock)this.recent.delete(id);
    this.summary.estimatedDepositionSeconds=this.clock;
  }
}
