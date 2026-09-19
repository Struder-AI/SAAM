import {offsetRegion} from '../../../core/region/offset.mjs';
import {difference,union,intersect} from '../../../core/region/boolean.mjs';
import {loopArea,pointInRegion,regionArea,scanlineFill} from '../../../core/region/region2d.mjs';
import {requireThat} from '../../../core/geom/tolerance.mjs';
import {dimensions,SLEEVE_LOOPS} from './feature.mjs';

const circle=(x,y,r)=>[Array.from({length:96},(_,i)=>[x+r*Math.cos(i*2*Math.PI/96),y+r*Math.sin(i*2*Math.PI/96)])];

// Lateral offset t from the rib axis (u, v perpendicular): where the ring crosses
// that line on the outer side of the bore, as a position along the ring.
function crossing(ring,c,u,v,t){
  for(let i=0;i<ring.length;i++){
    const p=ring[i],q=ring[(i+1)%ring.length];
    const bp=(p[0]-c[0])*v[0]+(p[1]-c[1])*v[1]-t,bq=(q[0]-c[0])*v[0]+(q[1]-c[1])*v[1]-t;
    if((bp<0)===(bq<0))continue;
    const f=bp/(bp-bq),point=[p[0]+f*(q[0]-p[0]),p[1]+f*(q[1]-p[1])];
    if((point[0]-c[0])*u[0]+(point[1]-c[1])*u[1]>0)return {s:i+f,point};
  }
  return null;
}
// Rotate the ring to begin midway between two ribs, so no rib straddles its start.
function startAwayFromRibs(ring,c,angleDeg,count){
  const pitch=360/count;let best=0,bestGap=-1;
  ring.forEach((p,i)=>{
    const a=((Math.atan2(p[1]-c[1],p[0]-c[0])*180/Math.PI-angleDeg)%pitch+pitch)%pitch,gap=Math.min(a,pitch-a);
    if(gap>bestGap){bestGap=gap;best=i;}
  });
  return [...ring.slice(best),...ring.slice(0,best)];
}
// The ring with each rib's out-and-back excursion spliced in where it leaves and rejoins.
function withExcursions(ring,excursions){
  const path=[];let cursor=0;
  for(const e of [...excursions].sort((a,b)=>a.enter.s-b.enter.s)){
    for(;cursor<=Math.floor(e.enter.s);cursor++)path.push(ring[cursor]);
    path.push(...e.points);
    cursor=Math.floor(e.exit.s)+1;
  }
  for(;cursor<ring.length;cursor++)path.push(ring[cursor]);
  return path;
}

// Optional local deposition details consumed by the shared planar producer.
// The core owns layers, volumes, travel, dependencies and material publication.
export function heatSetDetails(features){
  return {
    translated:(dx,dy,dz)=>heatSetDetails(features.map(f=>({...f,positionMm:f.positionMm.map((v,i)=>v+[dx,dy,dz][i])}))),
    // Blind holes need solid layers under their closed end at least as wide as
    // the ribs that spread from the bore, so the ribs never end over sparse infill.
    hasSolidRegions:features.some(f=>!f.throughHole),
    solidRegionAt(z,{layerMm,widthMm,topLayers,bottomLayers}){
      let solid=[];
      for(const f of features){
        if(f.throughHole)continue;
        const {diameterMm,depthMm}=dimensions(f),[x,y,mouth]=f.positionMm,sign=f.insertionSide==='bottom'?1:-1,floor=mouth+sign*depthMm;
        // Layers under the closed end of a top-inserted hole, or over a bottom-inserted one.
        const under=sign<0?z<=floor+1e-8&&z>floor-topLayers*layerMm+1e-8:z>=floor-1e-8&&z<floor+bottomLayers*layerMm-1e-8;
        if(under)solid=union(solid,circle(x,y,diameterMm/2+SLEEVE_LOOPS*widthMm+f.finLengthMm));
      }
      return solid;
    },
    at(region,z,{widthMm,perimeters,pitchMm,solid=[]}){
      let reservation=[],fillExclusion=[],wallRegion=[],allFinRegion=[];const walls=[],fins=[],holes=[];
      for(const f of features){
        const {depthMm,minWallThicknessMm,ribCount}=dimensions(f),[x,y,mouth]=f.positionMm;
        // sign matches geometry.mjs: -1 for the default top-Z insertion face,
        // +1 when the insert enters from the host's flat lowest face instead.
        // s is the distance from the mouth (s=0) toward the closed or far end.
        const sign=f.insertionSide==='bottom'?1:-1,s=sign*(z-mouth);
        if(s<-1e-7||s>=depthMm-1e-7)continue;
        const hole=region.find(loop=>loopArea(loop)<0&&pointInRegion([x,y],[loop]));
        requireThat(hole,`Heat-set ${f.id}: the layer no longer contains its complete bore; revise overlapping geometry or material reservations.`);
        holes.push(hole);
        const sleeveWidth=SLEEVE_LOOPS*widthMm,inner=[[...hole].reverse()],outer=offsetRegion(inner,sleeveWidth),sleeve=difference(outer,inner);
        requireThat(regionArea(difference(sleeve,region))<0.001,`Heat-set ${f.id}: insufficient material for ${SLEEVE_LOOPS} complete loops.`);
        requireThat(regionArea(intersect(sleeve,reservation))<0.001,'Heat-set sleeves overlap; separate the holes.');
        if(minWallThicknessMm!=null)requireThat(regionArea(difference(difference(offsetRegion(inner,minWallThicknessMm),inner),region))<0.001,`Heat-set ${f.id}: less than the manufacturer's ${minWallThicknessMm} mm minimum wall surrounds this insert; move the hole, enlarge the host or choose a smaller insert.`);
        const rings=[];
        for(let ring=0;ring<SLEEVE_LOOPS;ring++){
          const loops=offsetRegion(inner,(ring+0.5)*widthMm);
          requireThat(loops.length===1,'Heat-set bore must have one complete loop.');
          rings.push(loops[0]);
        }
        // Ordinary outer walls retain their settings; ribs stop where those
        // walls, other holes or earlier reinforcement begin, so additional
        // global perimeters cannot double-deposit.
        const otherBoundaries=region.filter(loop=>loop!==hole);
        const exteriorInterior=offsetRegion(otherBoundaries,-Math.max(0,widthMm+(perimeters-1)*pitchMm));
        requireThat(perimeters===0||regionArea(difference(sleeve,exteriorInterior))<0.001,`Heat-set ${f.id}: the loops meet ordinary walls; move the hole or reduce exterior loops.`);
        // Ribs run the whole bore depth, out from the sleeve to finLengthMm or
        // the first obstacle, but only where the layer is not already solid:
        // the last solid surface layer is where they begin.
        const room=difference(difference(exteriorInterior,reservation),solid);
        const radial=Math.max(...hole.map(p=>Math.hypot(p[0]-x,p[1]-y)))+sleeveWidth;
        // Two touching beads per rib, printed out and back as part of the last loop.
        const ring=startAwayFromRibs(rings[SLEEVE_LOOPS-1],[x,y],f.finAngleDeg,ribCount),half=widthMm/2,excursions=[];
        let finRegion=[];
        for(let n=0;n<ribCount;n++){
          const angle=(f.finAngleDeg+n*360/ribCount)*Math.PI/180,u=[Math.cos(angle),Math.sin(angle)],v=[-u[1],u[0]];
          const at=(r,t)=>[x+r*u[0]+t*v[0],y+r*u[1]+t*v[1]];
          const footprint=length=>[at(radial-0.01,-widthMm),at(radial+length,-widthMm),at(radial+length,widthMm),at(radial-0.01,widthMm)];
          const fits=length=>regionArea(difference([footprint(length)],room))<0.0001;
          let length=f.finLengthMm;
          if(!fits(length)){
            let lo=0,hi=length;
            for(let i=0;i<10;i++){const mid=(lo+hi)/2;if(fits(mid))lo=mid;else hi=mid;}
            length=lo;
          }
          if(length<3*widthMm)continue;
          const first=crossing(ring,[x,y],u,v,-half),second=crossing(ring,[x,y],u,v,half);
          if(!first||!second)continue;
          requireThat(regionArea(intersect(finRegion,[footprint(length)]))<0.001,'Heat-set ribs overlap; set fewer ribs.');
          finRegion=union(finRegion,[footprint(length)]);
          const [enter,exit]=first.s<=second.s?[[first,-half],[second,half]]:[[second,half],[first,-half]],tip=radial+length-widthMm/2;
          excursions.push({enter:enter[0],exit:exit[0],points:[enter[0].point,at(tip,enter[1]),at(tip,exit[1]),exit[0].point]});
        }
        for(let i=0;i<SLEEVE_LOOPS-1;i++)walls.push({role:'heat-set-loop',closed:true,points:rings[i]});
        walls.push({role:'heat-set-loop',closed:true,points:withExcursions(ring,excursions)});
        // Infill is kept out of the bore and loops only; it runs straight over the
        // ribs so the two lock together.
        reservation=union(reservation,union(sleeve,finRegion));
        fillExclusion=union(fillExclusion,outer);
        wallRegion=union(wallRegion,union(sleeve,finRegion));allFinRegion=union(allFinRegion,finRegion);
      }
      return {walls,fins,reservation,fillExclusion,wallRegion,finRegion:allFinRegion,interiorBoundary:region.filter(loop=>!holes.includes(loop)),ownsWall:loop=>loopArea(loop)<0&&holes.some(h=>pointInRegion(h[0],[loop]))};
    }
  };
}
