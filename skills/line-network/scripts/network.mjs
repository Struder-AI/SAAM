import {planarPolicy} from '../../../core/path/builder.mjs';
import {requireThat} from '../../../core/geom/tolerance.mjs';

export const LINE_NETWORK_DEFAULTS={enabled:false,layers:2,networks:[]};

// The centerlines are the part, so they are checked against the selected tool's
// bounds here; bounds is null only for machines whose motion checks are deferred.
export function lineNetworkResult({plan,bounds=null}){
  const settings=plan.skills['line-network'],width=plan.process.lineWidthMm,operations=[];
  let lengthMm=0,strokeCount=0;
  for(let layer=0;layer<settings.layers;layer++){
    const z=plan.process.firstLayerMm+layer*plan.process.layerMm;
    const height=layer===0?plan.process.firstLayerMm:plan.process.layerMm;
    const speed=layer===0?plan.process.firstLayerSpeedMmS:plan.process.planarSpeedMmS;
    for(let networkIndex=0;networkIndex<settings.networks.length;networkIndex++){
      const network=settings.networks[networkIndex],strokes=[],active=network.strokes.filter(stroke=>!stroke.layers||stroke.layers.includes(layer));
      if(!active.length)continue;
      const points2=active.flatMap(stroke=>stroke.points);
      const min=[Math.min(...points2.map(p=>p[0]))+plan.placement.xMm-width/2,Math.min(...points2.map(p=>p[1]))+plan.placement.yMm-width/2];
      const max=[Math.max(...points2.map(p=>p[0]))+plan.placement.xMm+width/2,Math.max(...points2.map(p=>p[1]))+plan.placement.yMm+width/2];
      const region=[[[min[0],min[1]],[max[0],min[1]],[max[0],max[1]],[min[0],max[1]]]];
      for(const stroke of active){
        const local=stroke.closed?[...stroke.points,stroke.points[0]]:stroke.points;
        const points=local.map(([x,y])=>[x+plan.placement.xMm,y+plan.placement.yMm,z]);
        if(bounds)requireThat(points.every(p=>p[0]-width/2>=bounds.min[0]-1e-8&&p[0]+width/2<=bounds.max[0]+1e-8&&p[1]-width/2>=bounds.min[1]-1e-8&&p[1]+width/2<=bounds.max[1]+1e-8&&z<=bounds.max[2]+1e-8),
          `Line network ${network.id} exceeds the selected tool bounds on course ${layer}.`);
        lengthMm+=points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p[0]-points[i][0],p[1]-points[i][1]),0);strokeCount++;
        strokes.push({role:'line-network',closed:false,points,speedMmS:speed,beadAreaMm2:width*height});
      }
      operations.push({id:`line-network:${network.id}:${layer}`,layerId:`planar:${z}`,phase:'planar',layer,rank:networkIndex,after:[],order:'given',regionId:network.id,region,strokes,
        travelPolicy:planarPolicy(region,{layerZ:z,liftMm:plan.process.liftMm,maxCombMm:0,lineWidthMm:width}),clearanceZ:z+plan.process.liftMm});
    }
  }
  return {id:'line-network',report:{layers:settings.layers,networks:settings.networks.length,strokes:strokeCount,lengthMm},operations};
}
