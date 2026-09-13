// Closed reference mesh; vase mode deposits only its outer wall. The mapped
// surface reuses the very same native side triangles for subsequent cladding.
import {developmentPipePlan} from '../../../skills/pipe-cladding/scripts/demo.mjs';

export function wavyCladdingPlan({heightMm=30,columns=64,rows=41}={}){
  const vertices=[],triangles=[];
  for(let j=0;j<rows;j++){
    // Short straight end collars bound the waves and provide level end rings.
    const z=heightMm*j/(rows-1),v=Math.max(0,Math.min(1,(j-1)/(rows-3))),radius=10+.75*(1+Math.cos(4*Math.PI*v));
    for(let i=0;i<columns;i++){const a=2*Math.PI*i/columns;vertices.push([radius*Math.cos(a),radius*Math.sin(a),z]);}
  }
  for(let j=0;j<rows-1;j++)for(let i=0;i<columns;i++){
    const a=j*columns+i,b=j*columns+(i+1)%columns,c=b+columns,d=a+columns;
    triangles.push([a,b,c],[a,c,d]);
  }
  const bottom=vertices.length,top=bottom+1;vertices.push([0,0,0],[0,0,heightMm]);
  for(let i=0;i<columns;i++){
    const next=(i+1)%columns,last=(rows-1)*columns;
    triangles.push([bottom,next,i],[top,last+i,last+next]);
  }
  const plan=developmentPipePlan();plan.geometry={shape:'mesh',vertices,triangles,source:null};
  plan.skills['full-fill'].enabled=false;plan.skills['vase-wall'].enabled=true;plan.skills['vase-wall'].endTransition='level';
  Object.assign(plan.skills['pipe-cladding'],{pattern:'crossed-helices',spacingFactor:3,shells:4,
    surface:{kind:'mesh-strip',periodicU:true,normalSide:1,rows:Array.from({length:columns+1},(_,i)=>Array.from({length:rows},(_,j)=>j*columns+i%columns))}});
  return plan;
}
