// Reusable primitives only. Each neighbouring example authors its own model.
export {splineBox,splineBlock} from '../../../core/tests/fixtures/spline-shapes.mjs';
export function cylinder(G,{radius=2,length=5,origin=[0,0,0],axis=[0,0,1]}={}){
 return G.revolvedProfile({positionMm:origin,axis,profile:[[0,radius],[length,radius]]});
}
export function turn(recipe,angle){
 const result=structuredClone(recipe);
 for(const patch of result.patches)for(const row of patch.controlPoints)for(const p of row){const [x,y]=p;p[0]=x*Math.cos(angle)-y*Math.sin(angle);p[1]=x*Math.sin(angle)+y*Math.cos(angle);}
 return result;
}
export function torus({major=3,minor=1,origin=[0,0,2],phase=0}={}){
 const circle=[[1,0,1],[1,1,Math.SQRT1_2],[0,1,1],[-1,1,Math.SQRT1_2],[-1,0,1],[-1,-1,Math.SQRT1_2],[0,-1,1],[1,-1,Math.SQRT1_2],[1,0,1]];
 const knots=[0,0,0,.25,.25,.5,.5,.75,.75,1,1,1];
 const recipe=turn({shape:'spline',patches:[{name:'ring',degreeU:2,degreeV:2,knotsU:knots,knotsV:knots,controlPoints:circle.map(([x,y,w])=>circle.map(([s,t,v])=>[(major+minor*s)*x,(major+minor*s)*y,minor*t,w*v]))}]},phase);
 for(const patch of recipe.patches)for(const row of patch.controlPoints)for(const p of row)for(let k=0;k<3;k++)p[k]+=origin[k];
 return recipe;
}
