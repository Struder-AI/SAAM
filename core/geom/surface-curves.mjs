import {findSpan,basisFunctions,evaluateCurve} from './nurbs.mjs';
import {requireThat} from './tolerance.mjs';

// Hold U or V fixed, retaining the other axis's native knots and domain.
// These are ordinary rational curves, usable by offsets and closure queries.
export function surfaceIsoCurve(patch,axis,value){
  requireThat(axis===0||axis===1,'Isocurve axis is U (0) or V (1).');
  const counts=[patch.nu,patch.nv],orders=[patch.orderU,patch.orderV],knots=[patch.knotsU,patch.knotsV],domains=[patch.domainU,patch.domainV],along=1-axis;
  requireThat(value>=domains[axis][0]&&value<=domains[axis][1],'Isocurve leaves the surface domain.');
  const span=findSpan(knots[axis],counts[axis],orders[axis],value),basis=basisFunctions(knots[axis],span,value,orders[axis]),cp=new Float64Array(counts[along]*4);
  for(let i=0;i<counts[along];i++)for(let j=0;j<orders[axis];j++){
    const fixed=span-orders[axis]+1+j,index=axis===0?fixed*patch.nv+i:i*patch.nv+fixed;
    for(let k=0;k<4;k++)cp[i*4+k]+=basis[j]*patch.cp[index*4+k];
  }
  return {n:counts[along],order:orders[along],knots:knots[along],cp,domain:[...domains[along]],source:{surface:patch,axis,value}};
}

export function curvePoint(curve,fraction){
  return evaluateCurve(curve,curve.domain[0]+fraction*(curve.domain[1]-curve.domain[0])).point;
}
