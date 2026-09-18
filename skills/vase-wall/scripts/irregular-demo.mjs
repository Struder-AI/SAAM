// Reproduce the broad-loop, waisted sleeve without an originating private print.
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {defaults} from '../../../core/print/plan.mjs';
import {initBundle,generateBundle} from '../../../core/print/bundle.mjs';
import {loopMotif} from './motif.mjs';

export function irregularLoopHost(){
  const rows=9,columns=48,height=30,vertices=[],triangles=[];
  for(let j=0;j<rows;j++){
    const t=j/(rows-1),z=height*t,radius=20-5*Math.sin(Math.PI*t)**2;
    const cx=4*Math.sin(Math.PI*t/2),cy=2*Math.sin(Math.PI*t);
    for(let i=0;i<columns;i++){
      const a=2*Math.PI*i/columns;
      vertices.push([cx+radius*1.1*Math.cos(a),cy+radius/1.1*Math.sin(a),z]);
    }
  }
  for(let j=0;j<rows-1;j++)for(let i=0;i<columns;i++){
    const a=j*columns+i,b=j*columns+(i+1)%columns;
    triangles.push([a,b,b+columns],[a,b+columns,a+columns]);
  }
  const bottom=vertices.length,top=bottom+1;vertices.push([0,0,0],[4,0,height]);
  for(let i=0;i<columns;i++){
    const next=(i+1)%columns,last=(rows-1)*columns;
    triangles.push([bottom,next,i],[top,last+i,last+next]);
  }
  return {shape:'mesh',vertices,triangles,source:null};
}

export function irregularLoopDemoPlan(){
  const plan=defaults();
  plan.geometry=irregularLoopHost();plan.placement={xMm:140,yMm:100};
  for(const settings of Object.values(plan.skills))settings.enabled=false;
  plan.skills['full-fill'].enabled=true;
  Object.assign(plan.skills['vase-wall'],{enabled:true,endTransition:'spiral',zStartMm:.6,
    pattern:{motif:loopMotif({widthCells:2.8,depthMm:4.8,samples:64,beadHeightMm:.2,exterior:'smooth'}),
      cellsPerTurn:20,courseRiseMm:.2,repeats:145,tiltDeg:0}});
  return plan;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const directory=resolve(process.argv[2]??'Prints/development/irregular-loop-vase');
  await initBundle(directory,irregularLoopDemoPlan());
  const checked=await generateBundle(directory,{development:true,onProgress:p=>console.log(JSON.stringify(p))});
  console.log(JSON.stringify({directory,result:checked.result,moves:checked.moves,
    scope:'Complete mapped-loop development preview; no human manufacturing approval or physical validation.'}));
}
