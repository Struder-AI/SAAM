// Choose the exterior ribbon from actual adjacent material, independent of winding.
import {controlCurve} from './curve-controls.mjs';
import {prepareRibbon} from './curve-ribbon.mjs';
import {evaluateCurve} from './nurbs.mjs';
import {containsPoint} from './query.mjs';
import {resolveMaterialGeometry} from './build.mjs';
import {requireThat} from './tolerance.mjs';
import {PRINT_RESOLUTION_MM} from '../dimensions.mjs';

export async function ribbon({geometry=null,curve,vertical=[0,0,1],depthMm,materialSide=null}){
  requireThat(Number.isFinite(depthMm),'Ribbon depth must be finite.');
  const native=controlCurve(curve);
  const prepared=prepareRibbon({curve:native,closed:curve.closed,vertical});
  const result=(offset,side)=>({curves:offset.pieces.map(p=>({closed:curve.closed&&offset.folds===0,nurbs:{degree:p.order-1,knots:Array.from(p.knots),controlPoints:Array.from({length:p.n},(_,i)=>[0,1,2].map(k=>p.cp[i*4+k]/p.cp[i*4+3])),weights:Array.from({length:p.n},(_,i)=>p.cp[i*4+3])}})),report:{depthMm,side,folds:offset.folds}});
  if(geometry===null)return result(prepared.ribbon(depthMm),null);
  requireThat(depthMm>0&&[-1,1].includes(materialSide),'Material ribbon needs positive depth and an adjacent material side.');
  const [solid]=await resolveMaterialGeometry([geometry]);
  const length=Math.hypot(...vertical),axis=vertical.map(v=>v/length),probe=Math.min(depthMm/16,2*PRINT_RESOLUTION_MM);
  const right=prepared.ribbon(probe),left=prepared.ribbon(-probe);
  const parameters=[...new Set(Array.from({length:native.n},(_,i)=>{
    let t=0;for(let k=1;k<native.order;k++)t+=native.knots[i+k];return Math.max(native.domain[0],Math.min(native.domain[1],t/(native.order-1)));
  }))];
  const on=(pieces,t)=>{const p=pieces.find(p=>t>=p.domain[0]&&t<=p.domain[1]);return p?evaluateCurve(p,t).point:null;};
  const votesAt=side=>{let materialFound=false;const votes=parameters.flatMap(t=>{
    const r=on(right.pieces,t),l=on(left.pieces,t);if(!r||!l)return [];
    const inside=p=>containsPoint(solid,p.map((v,k)=>v+side*probe*axis[k])),a=inside(r),b=inside(l);
    materialFound||=a||b;return a===b?[]:[a?-1:1];
  });return {votes,materialFound};};
  const preferred=votesAt(materialSide),opposite=preferred.votes.length?null:votesAt(-materialSide),votes=preferred.votes.length?preferred.votes:opposite.votes;
  if(!votes.length&&!preferred.materialFound&&!opposite.materialFound)return {curves:[],report:{depthMm,side:null,folds:0,noAdjacentMaterial:true}};
  requireThat(votes.length&&votes.every(v=>v===votes[0]),'Selected edge has no consistent exterior ribbon beside its adjacent material.');
  const offset=prepared.ribbon(votes[0]*depthMm);
  return result(offset,votes[0]);
}
