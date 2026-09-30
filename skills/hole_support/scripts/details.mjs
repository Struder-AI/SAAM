import {intersect,union} from '../../../core/region/boolean.mjs';
import {offsetRegion} from '../../../core/region/offset.mjs';
import {scanlineFill,loopArea,pointInRegion} from '../../../core/region/region2d.mjs';

const circle=(x,y,r)=>[Array.from({length:96},(_,i)=>[x+r*Math.cos(i*2*Math.PI/96),y+r*Math.sin(i*2*Math.PI/96)])];
export function holeSupportDetails(records){
  return {
    translated:(dx,dy,dz)=>holeSupportDetails(records.map(record=>({...record,features:record.features.map(f=>({...f,centerMm:f.centerMm.map((v,i)=>v+[dx,dy,dz][i])}))}))),
    at(region,z,{widthMm}){
      let reservation=[];const bridges=[],active=[];
      for(const record of records)for(const f of record.features){
        if(f.strategy==='bore-support')continue;
        const [x,y,shoulder]=f.centerMm,h=record.process.layerMm,stage=Math.round((z-shoulder)/h)-1,count=f.strategy==='membrane'?1:3;
        if(stage<0||stage>=count||Math.abs(z-shoulder-(stage+1)*h)>1e-5)continue;
        const mask=circle(x,y,f.counterboreRadiusMm+2*widthMm),local=intersect(region,mask),angle=f.angleDeg+(stage===1?90:stage===2?45:0);
        reservation=union(reservation,mask);active.push(f);
        // Print anchored straight spans before any bore contour. The local
        // footprint is reserved from both solid and sparse producers.
        const rows=scanlineFill(offsetRegion(local,-widthMm/2),widthMm,angle);
        rows.forEach((row,i)=>bridges.push({role:'hole-support-bridge',localDetail:'bridge',closed:false,points:i%2?[row.to,row.from]:[row.from,row.to],speedMmS:f.bridgeSpeedMmS}));
      }
      return {walls:[],fins:[],bridges,reservation,fillExclusion:reservation,wallRegion:[],finRegion:[],
        ownsWall:loop=>loopArea(loop)<0&&active.some(f=>pointInRegion(f.centerMm.slice(0,2),[loop]))};
    }
  };
}
