// Declared layer-lattice contact for unmodulated surface courses. Changed
// producers instead use actual finalized bead coverage in generation.
import {requireThat} from '../geom/tolerance.mjs';
import {topAt} from '../geom/query.mjs';
import {pointInRegion,pointSegmentDistance} from './region2d.mjs';
import {stackTopAt} from '../print/surface-constructions.mjs';

const inBounds=(x,y,b)=>x>=b.min[0]-1e-8&&x<=b.max[0]+1e-8&&y>=b.min[1]-1e-8&&y<=b.max[1]+1e-8;
const covered=(x,y,region)=>pointInRegion([x,y],region)||region.some(loop=>loop.some((p,i)=>pointSegmentDistance([x,y],p,loop[(i+1)%loop.length])<=1e-7));
const planarLayers=results=>results.flatMap(r=>r.operations).filter(op=>op.region&&op.strokes.length).map(op=>({region:op.region,materialRegion:op.materialRegion??op.region,coverage:op.materialCoverage??'area',z:op.strokes[0].points[0][2]}));

// Shared lattice support query, including translated components and deliberately
// separate supporting columns. A bridge uses the declared underlying lattice;
// it does not invent a deposited material surface in the intervening void.
export function planarSupportTopAt(supports,process) {
  const sampledSupports=supports.map(support=>({...support,
    layers:support.results?planarLayers(support.results).sort((a,b)=>b.z-a.z):null}));
  return (x,y,ceiling)=>{
    const candidates=[];
    for(const support of sampledSupports) {
      if(support.layers){
        for(const layer of support.layers)if(layer.z<=ceiling+1e-8&&covered(x,y,layer.region)){candidates.push(layer.z);break;}
        continue;
      }
      if(!inBounds(x,y,support.shell.bounds))continue;
      const top=topAt(support.shell,x,y);if(!top)continue;
      const z=stackTopAt(Math.min(ceiling,top.zMm,support.end??Infinity),process,support.shell.bounds.min[2]);
      if(z<=ceiling+1e-8&&z>(support.start??support.shell.bounds.min[2])+1e-8)candidates.push(z);
    }
    if(candidates.length)return Math.max(...candidates);
    requireThat(supports.length,'No supporting region supplies a layer grid for this surface.');
    const origin=Math.min(...supports.map(s=>s.shell.bounds.min[2]));
    return stackTopAt(ceiling,process,origin);
  };
}

