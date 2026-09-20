import {planarPolicy} from '../../../core/path/builder.mjs';
import {requireThat} from '../../../core/geom/tolerance.mjs';

export const LINE_NETWORK_DEFAULTS={enabled:false,layers:2,networks:[]};

// Course heights from different layer grids must be exactly equal where they coincide,
// or the composer would treat them as separate heights and lose the tie-break below.
const height=z=>Math.round(z*1e6)/1e6;

// The centerlines are the part, so they are checked against the selected tool's
// bounds here; bounds is null only for machines whose motion checks are deferred.
//
// A network may carry its own `layers` and `process` (layer heights, bead width, speeds),
// so one print can hold fine and thick lines. The composer prints by ascending deposition
// height; at one height each course's `rank` is its layer height, so the finer line goes
// first, and a thick line's single course follows the several fine courses beneath it.
export function lineNetworkResult({plan,bounds=null}){
  const settings=plan.skills['line-network'],operations=[];
  let lengthMm=0,strokeCount=0,courseCount=0,maxCourses=0;
  const heights=new Set(),placed=[];
  settings.networks.forEach(network=>{
    const process={...plan.process,...network.process},width=process.lineWidthMm,courses=network.layers??settings.layers;
    maxCourses=Math.max(maxCourses,courses);
    for(let layer=0;layer<courses;layer++){
      const z=height(process.firstLayerMm+layer*process.layerMm);
      heights.add(z);
      const beadHeight=layer===0?process.firstLayerMm:process.layerMm;
      const speed=layer===0?process.firstLayerSpeedMmS:process.planarSpeedMmS;
      const strokes=[],active=network.strokes.filter(stroke=>!stroke.layers||stroke.layers.includes(layer));
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
        strokes.push({role:'line-network',closed:false,points,speedMmS:speed,beadAreaMm2:width*beadHeight});
      }
      courseCount++;
      const operation={id:`line-network:${network.id}:${layer}`,layerId:`planar:${z}`,phase:'planar',layer,rank:process.layerMm,after:[],order:'given',regionId:network.id,region,strokes,
        travelPolicy:planarPolicy(region,{layerZ:z,liftMm:process.liftMm,maxCombMm:0,lineWidthMm:width}),clearanceZ:z+process.liftMm};
      operations.push(operation);placed.push([operation,z]);
    }
  });
  // `layer` is the height's place among every course height in the print, so it means the
  // same to every network; with one shared grid it is the course number, as before.
  const levels=new Map([...heights].sort((a,b)=>a-b).map((z,i)=>[z,i]));
  for(const [operation,z] of placed)operation.layer=levels.get(z);
  return {id:'line-network',report:{layers:maxCourses,networks:settings.networks.length,strokes:strokeCount,courses:courseCount,lengthMm},operations};
}
