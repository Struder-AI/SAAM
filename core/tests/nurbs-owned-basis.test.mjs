import test from 'node:test';
import assert from 'node:assert/strict';
import {basisFunctions,basisDerivatives,findSpan,evaluate,evaluateScalar} from '../geom/nurbs.mjs';

test('owned basis equals the independent derivative table exactly at nonuniform knots and endpoints',()=>{
  for(const order of [2,3,4,6,12,16,20]){
    const knots=Float64Array.from([...Array(order).fill(-.7),.03,.031,.031,.77,...Array(order).fill(1.9)]),count=knots.length-order;
    for(const t of [-.7,-.11,.03,.0307,.031,.031000000000000007,.12,.77,1.13,1.9]){
      const span=findSpan(knots,count,order,t),basis=basisFunctions(knots,span,t,order);
      assert.deepEqual([...basis],[...basisDerivatives(knots,span,t,order,0)[0]],`order ${order}, t ${t}`);
    }
  }
});

test('later basis/evaluator calls do not overwrite an earlier returned basis',()=>{
  const knots=Float64Array.from([0,0,0,0,1,1,1,1]);
  const first=basisFunctions(knots,3,.25,4),saved=first.slice();
  for(const t of [0,.5,.9,1]){
    const later=basisFunctions(knots,3,t,4);
    assert.notEqual(later.buffer,first.buffer);
    later.fill(999);
  }
  assert.deepEqual(first,saved);
  assert.deepEqual([...knots],[0,0,0,0,1,1,1,1]);
});

test('value-only evaluation owns enough basis storage for orders above sixteen',()=>{
  const order=20,knots=Float64Array.from([...Array(order).fill(0),...Array(order).fill(1)]);
  const patch={nu:order,nv:2,orderU:order,orderV:2,knotsU:knots,knotsV:Float64Array.from([0,0,1,1]),domainU:[0,1],domainV:[0,1],
    cp:Float64Array.from(Array.from({length:order},(_,i)=>[0,1].flatMap(j=>[i/(order-1),j,3,1])).flat())};
  const coefficients=Float64Array.from({length:order*2},()=>3);
  for(const u of [0,.11,.7,1]){
    assert.deepEqual(evaluate(patch,u,.3,false).point,evaluate(patch,u,.3).point);
    assert.ok(Math.abs(evaluateScalar(patch,coefficients,u,.3)-3)<1e-14);
  }
});
