import {offsetRegion} from '../../../core/region/offset.mjs';
import {difference,union} from '../../../core/region/boolean.mjs';
import {loopArea,pointInRegion} from '../../../core/region/region2d.mjs';
import {dimensions} from './feature.mjs';

// Insert each radial excursion into the actual fourth offset contour. Returning
// to its departure point keeps the entire star one continuous closed stroke.
function rayLength(root,direction,length,material){
  if(!pointInRegion(root,material))return 0;
  let reach=length;
  for(const boundary of material)for(let i=0;i<boundary.length;i++){
    const a=boundary[i],b=boundary[(i+1)%boundary.length];
    const v=[b[0]-a[0],b[1]-a[1]],w=[a[0]-root[0],a[1]-root[1]];
    const cross=direction[0]*v[1]-direction[1]*v[0];
    if(Math.abs(cross)<1e-12)continue;
    const distance=(w[0]*v[1]-w[1]*v[0])/cross;
    const t=(w[0]*direction[1]-w[1]*direction[0])/cross;
    if(distance>=-1e-9&&t>=-1e-9&&t<=1+1e-9)reach=Math.min(reach,Math.max(0,distance));
  }
  return reach;
}

export function starPerimeter(loop,center,{count,length,angleDeg,material}){
  const hits=[];
  for(let ray=0;ray<count;ray++){
    const angle=(angleDeg+ray*360/count)*Math.PI/180,u=[Math.cos(angle),Math.sin(angle)];
    for(let edge=0;edge<loop.length;edge++){
      const a=loop[edge],b=loop[(edge+1)%loop.length],v=[b[0]-a[0],b[1]-a[1]],w=[a[0]-center[0],a[1]-center[1]];
      const cross=u[0]*v[1]-u[1]*v[0];
      if(Math.abs(cross)<1e-12)continue;
      const radius=(w[0]*v[1]-w[1]*v[0])/cross,t=(w[0]*u[1]-w[1]*u[0])/cross;
      if(radius>0&&t>=-1e-9&&t<1-1e-9){
        const root=[center[0]+radius*u[0],center[1]+radius*u[1]];
        const reach=rayLength(root,u,length,material);
        if(reach>1e-7)hits.push({edge,t,root,tip:[root[0]+reach*u[0],root[1]+reach*u[1]]});break;
      }
    }
  }
  const points=[];
  for(let edge=0;edge<loop.length;edge++){
    points.push(loop[edge]);
    for(const hit of hits.filter(h=>h.edge===edge).sort((a,b)=>a.t-b.t))points.push(hit.root,hit.tip,hit.root);
  }
  return points;
}

export function heatSetDetails(features){
  return {
    translated:(dx,dy,dz)=>heatSetDetails(features.map(f=>({...f,positionMm:f.positionMm.map((v,i)=>v+[dx,dy,dz][i])}))),
    at(region,z,{widthMm,stars=false,solidRegion=[]}){
      const walls=[],holes=[],material=offsetRegion(difference(region,solidRegion),-widthMm/2);let wallRegion=[],fillExclusion=[];
      for(const f of features){
        const {diameterMm,depthMm,insertLengthMm}=dimensions(f),[x,y,mouth]=f.positionMm;
        const distance=f.entry==='bottom'?z-mouth:mouth-z;
        if(distance< -1e-7||distance>=Math.min(depthMm,insertLengthMm)-1e-7)continue;
        const hole=region.find(loop=>loopArea(loop)<0&&pointInRegion([x,y],[loop]));
        if(!hole)continue;
        const inner=[[...hole].reverse()];
        for(let ring=0;ring<4;ring++){
          const loops=offsetRegion(inner,(ring+0.5)*widthMm);
          for(const loop of loops){
            const points=ring===3&&stars?starPerimeter(loop,[x,y],{count:f.finCount,length:f.finLengthMm??diameterMm*(f.finLengthFactor??2),angleDeg:f.finAngleDeg,material}):loop;
            walls.push({role:points.length>loop.length?'heat-set-star':'heat-set-loop',closed:true,points});
          }
        }
        holes.push(hole);
        const outer=offsetRegion(inner,4*widthMm);
        wallRegion=union(wallRegion,difference(outer,inner));fillExclusion=union(fillExclusion,outer);
      }
      // Rays deliberately cross infill and other rays. They create no fill
      // reservation: reserving them would cut away the intended interlocking.
      return {walls,fins:[],reservation:wallRegion,fillExclusion,wallRegion,finRegion:[],
        interiorBoundary:region.filter(loop=>!holes.includes(loop)),
        ownsWall:loop=>loopArea(loop)<0&&holes.some(h=>pointInRegion(h[0],[loop]))};
    }
  };
}
