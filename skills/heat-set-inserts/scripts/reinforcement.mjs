import {offsetRegion} from '../../../core/region/offset.mjs';
import {difference,union,intersect} from '../../../core/region/boolean.mjs';
import {loopArea,pointInRegion,regionArea,scanlineFill} from '../../../core/region/region2d.mjs';
import {requireThat} from '../../../core/geom/tolerance.mjs';
import {dimensions} from './feature.mjs';

// Optional local deposition details consumed by the shared planar producer.
// The core owns layers, volumes, travel, dependencies and material publication.
export function heatSetDetails(features){
  return {
    translated:(dx,dy,dz)=>heatSetDetails(features.map(f=>({...f,positionMm:f.positionMm.map((v,i)=>v+[dx,dy,dz][i])}))),
    at(region,z,{widthMm,perimeters,pitchMm}){
      let reservation=[],fillExclusion=[],wallRegion=[],allFinRegion=[];const walls=[],fins=[],holes=[];
      for(const f of features){
        const {depthMm}=dimensions(f),[x,y,mouth]=f.positionMm;
        if(z<=mouth-depthMm+1e-7||z>mouth+1e-7)continue;
        const hole=region.find(loop=>loopArea(loop)<0&&pointInRegion([x,y],[loop]));
        requireThat(hole,`Heat-set ${f.id}: the layer no longer contains its complete bore; revise overlapping geometry or material reservations.`);
        holes.push(hole);
        const inner=[[...hole].reverse()],outer=offsetRegion(inner,6*widthMm),sleeve=difference(outer,inner);
        requireThat(regionArea(difference(sleeve,region))<0.001,`Heat-set ${f.id}: insufficient material for six complete loops.`);
        requireThat(regionArea(intersect(sleeve,reservation))<0.001,'Heat-set sleeves overlap; separate the holes.');
        for(let ring=0;ring<6;ring++){
          const loops=offsetRegion(inner,(ring+0.5)*widthMm);
          requireThat(loops.length===1,'Heat-set bore must have one complete loop.');
          walls.push({role:'heat-set-loop',closed:true,points:loops[0]});
        }
        // A gusset joins the full sleeve depth to the insertion face. Its
        // radial reach grows linearly from zero at the floor to full length
        // at the face: a right triangle in the radial/Z plane. Width tapers
        // from twice the nominal fin width at the sleeve to nominal at the tip.
        const finWidth=Math.max(widthMm,Math.round(f.finWidthMm/widthMm)*widthMm);
        const progress=(z-(mouth-depthMm))/depthMm,length=f.finLengthMm*Math.min(1,progress);
        const rootWidth=2*finWidth,tipWidth=finWidth*(2-length/f.finLengthMm);
        const radial=Math.max(...hole.map(p=>Math.hypot(p[0]-x,p[1]-y)))+6*widthMm;
        let finRegion=[];
        // Features below one bead of radial reach cannot form a separate fin.
        // The six sleeve loops still support the first printable gusset layer.
        for(let n=0;length>=widthMm&&n<f.finCount;n++){
          const angle=(f.finAngleDeg+n*360/f.finCount)*Math.PI/180,u=[Math.cos(angle),Math.sin(angle)],v=[-u[1],u[0]];
          const at=(r,t)=>[x+r*u[0]+t*v[0],y+r*u[1]+t*v[1]];
          const start=Math.sqrt(Math.max(0,radial*radial-(rootWidth/2)**2))-widthMm*0.1,end=radial+length;
          const strip=[at(start,-rootWidth/2),at(end,-tipWidth/2),at(end,tipWidth/2),at(start,rootWidth/2)];
          // Cross-fin rows follow the taper continuously in width instead of
          // quantizing a 2x root into a few longitudinal tracks.
          const rows=scanlineFill(offsetRegion([strip],-widthMm/2),widthMm,angle*180/Math.PI+90,{originMm:at(start+widthMm/2+0.001,0)});
          if(!rows.length)continue;
          requireThat(regionArea(intersect(finRegion,[strip]))<0.001,'Heat-set fins overlap; reduce fin count or width.');
          finRegion=union(finRegion,[strip]);
          for(const row of rows){
            fins.push({role:'heat-set-fin',localDetail:'fin',closed:false,points:[row.from,row.to]});
          }
        }
        requireThat(regionArea(difference(finRegion,region))<0.001,`Heat-set ${f.id}: fins extend outside host material; shorten or reposition them.`);
        requireThat(regionArea(intersect(finRegion,reservation))<0.001,'Heat-set reinforcement regions overlap; separate the holes or shorten fins.');
        // Ordinary outer walls retain their settings; ensure local details fit
        // inside them so additional global perimeters cannot double-deposit.
        const otherBoundaries=region.filter(loop=>loop!==hole);
        const exteriorInterior=offsetRegion(otherBoundaries,-Math.max(0,widthMm+(perimeters-1)*pitchMm));
        const owned=union(sleeve,finRegion);
        requireThat(perimeters===0||regionArea(difference(owned,exteriorInterior))<0.001,`Heat-set ${f.id}: reinforcement meets ordinary walls; shorten fins, move the hole, or reduce exterior loops.`);
        reservation=union(reservation,owned);
        fillExclusion=union(fillExclusion,union(outer,finRegion));
        wallRegion=union(wallRegion,sleeve);allFinRegion=union(allFinRegion,finRegion);
      }
      return {walls,fins,reservation,fillExclusion,wallRegion,finRegion:allFinRegion,interiorBoundary:region.filter(loop=>!holes.includes(loop)),ownsWall:loop=>loopArea(loop)<0&&holes.some(h=>pointInRegion(h[0],[loop]))};
    }
  };
}
