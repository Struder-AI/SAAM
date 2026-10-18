// A finite normal band as a closed, sectionable solid. Native chart evaluation
// defines its boundary; an explicitly measured mesh supplies existing solid
// membership and reverse sections. It is not a bounding-box ownership proxy.
import {surfaceRegion} from './surface-region.mjs';
import {offsetSurfaceChart} from './offset-chart.mjs';
import {evaluateSurface} from './surface-evaluation.mjs';
import {makeMesh} from './mesh.mjs';
import {requireThat,distance,cross,dot} from './tolerance.mjs';

export function normalBandVolume({shell,selection,fromMm=0,toMm,offsetTightness=1,toleranceMm=.01,sampleStepMm=.5}){
  requireThat(Number.isFinite(fromMm)&&Number.isFinite(toMm)&&toMm>fromMm,'A normal band needs increasing finite depth bounds.');
  requireThat(toleranceMm>0&&sampleStepMm>0&&Number.isFinite(toleranceMm)&&Number.isFinite(sampleStepMm),'Normal-band sampling needs positive physical tolerances.');
  requireThat(offsetTightness>=0&&offsetTightness<=1,'Normal-band offset tightness must be 0–1.');
  const chart=surfaceRegion(shell,selection);
  const lower=offsetSurfaceChart(chart,fromMm,{shell,selection,tightness:offsetTightness}),upper=offsetSurfaceChart(chart,toMm,{shell,selection,tightness:offsetTightness});
  const at=(u,v,depth)=>{
    const a=evaluateSurface(lower,[u,v]).point,b=evaluateSurface(upper,[u,v]).point,t=(depth-fromMm)/(toMm-fromMm);
    return a.map((x,k)=>x+t*(b[k]-x));
  };
  const divide=(breaks,count)=>breaks.slice(1).flatMap((b,i)=>Array.from({length:count},(_,j)=>breaks[i]+(b-breaks[i])*j/count)).concat(1);
  let previousError=Infinity;
  for(let count=1;;count*=2){
    const axes=[divide(chart.breaksU,count),divide(chart.breaksV,count),Array.from({length:count+1},(_,i)=>fromMm+(toMm-fromMm)*i/count)];
    const vertices=[],triangles=[],indicesByParameter=new Map();
    const vertex=indices=>{
      const canonical=[...indices];if(chart.periodicU&&canonical[0]===axes[0].length-1)canonical[0]=0;
      const key=canonical.join(':');if(!indicesByParameter.has(key)){indicesByParameter.set(key,vertices.length);vertices.push(at(...canonical.map((index,k)=>axes[k][index])));}
      return indicesByParameter.get(key);
    };
    const sample=chart.at(.5,.5),orientation=dot(cross(sample.du,sample.dv),sample.normal)>=0?1:-1;
    let error=0,maxEdge=0;
    for(let axis=0;axis<3;axis++){
      if(axis===0&&chart.periodicU)continue;
      const [aAxis,bAxis]=[0,1,2].filter(k=>k!==axis);
      for(const end of [0,1])for(let i=0;i<axes[aAxis].length-1;i++)for(let j=0;j<axes[bAxis].length-1;j++){
        const parameters=[[i,j],[i+1,j],[i+1,j+1],[i,j+1]].map(([a,b])=>{
          const indices=[];indices[axis]=end*(axes[axis].length-1);indices[aAxis]=a;indices[bAxis]=b;return indices;
        });
        const ids=parameters.map(vertex),[a,b,c,d]=ids.map(index=>vertices[index]);
        const direction=orientation*(end?1:-1)*(axis===1?-1:1);
        for(const triangle of [[ids[0],ids[1],ids[2]],[ids[0],ids[2],ids[3]]])triangles.push(direction>0?triangle:triangle.toReversed());
        maxEdge=Math.max(maxEdge,distance(a,b),distance(b,c),distance(c,d),distance(d,a));
        for(const x of [.25,.5,.75])for(const y of [.25,.5,.75]){
          const interpolated=x>=y?a.map((v,k)=>v*(1-x)+b[k]*(x-y)+c[k]*y):a.map((v,k)=>v*(1-y)+c[k]*x+d[k]*(y-x));
          const q=parameters[0].map((index,k)=>axes[k][index]);
          q[aAxis]=axes[aAxis][i]+x*(axes[aAxis][i+1]-axes[aAxis][i]);q[bAxis]=axes[bAxis][j]+y*(axes[bAxis][j+1]-axes[bAxis][j]);
          error=Math.max(error,distance(at(...q),interpolated));
        }
      }
    }
    if(error>toleranceMm||maxEdge>sampleStepMm){
      requireThat(error<previousError||maxEdge>sampleStepMm,'Normal-band boundary sampling cannot improve at the requested tolerance.');
      previousError=error;continue;
    }
    // Discard unused seam vertices before the common mesh validity checks.
    const used=[...new Set(triangles.flat())],indices=new Map(used.map((index,i)=>[index,i]));
    const volume=makeMesh(used.map(index=>vertices[index]),triangles.map(t=>t.map(index=>indices.get(index))),{name:'normal-band'});
    return {volume,chart,fromMm,toMm,sampling:{toleranceMm,sampleStepMm,sampledErrorMm:error,maxEdgeMm:maxEdge,uIntervals:axes[0].length-1,vIntervals:axes[1].length-1,depthIntervals:count}};
  }
}
