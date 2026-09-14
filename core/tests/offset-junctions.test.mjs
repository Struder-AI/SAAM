import test from 'node:test';
import assert from 'node:assert/strict';
import {offsetRegion,loopArea,pointSegmentDistance} from '../region/region2d.mjs';

test('Clipper normalization retains a crossing junction in both closed material lobes',()=>{
  const corners=[[0,0],[4,4],[0,4],[4,0]];
  // Subdivision must not change either component of the filled region.
  for(const subdivisions of [1,23]) {
    const points=corners.flatMap((a,i)=>Array.from({length:subdivisions},(_,j)=>a.map((v,k)=>v+(corners[(i+1)%4][k]-v)*j/subdivisions)));
    const lobes=offsetRegion([points],0);
    assert.equal(lobes.length,2);
    const areas=lobes.map(loopArea).sort((a,b)=>a-b);
    assert.ok(Math.abs(areas[0]-4)<1e-8&&Math.abs(areas[1]-4)<1e-8);
    assert.ok(lobes.every(loop=>loop.some(p=>Math.hypot(p[0]-2,p[1]-2)<1e-10)));
  }
});

test('inward offsets retain the main outline when short convex corners disappear',()=>{
  for(const e of [0.0001,0.001,0.01,0.05])for(const angle of [0,0.017,0.8]) {
    const source=[[e,0],[10-e,0],[10,e],[10,10-e],[10-e,10],[e,10],[0,10-e],[0,e]]
      .map(([x,y])=>[120+x*Math.cos(angle)-y*Math.sin(angle),90+x*Math.sin(angle)+y*Math.cos(angle)]);
    // Vary the starting vertex as well: no corner may own the retained outline.
    for(let start=0;start<source.length;start++) {
      const loop=[...source.slice(start),...source.slice(0,start)],inset=offsetRegion([loop],-0.2,{precisionMm:1e-9});
      assert.equal(inset.length,1,`corner ${e}, angle ${angle}, start ${start}`);
      // Integer offset coordinates have 1e-9 mm quantization; area error scales
      // with perimeter, rather than the old floating construction's exactness.
      assert.ok(Math.abs(loopArea(inset[0])-9.6**2)<2e-7);
      for(const p of inset[0])assert.ok(Math.abs(Math.min(...loop.map((a,i)=>pointSegmentDistance(p,a,loop[(i+1)%loop.length])))-0.2)<1e-8);
    }
  }
});

test('direct and indexed distance checks retain equivalent subdivided outlines',()=>{
  const corners=[[0.001,0],[9.999,0],[10,0.001],[10,9.999],[9.999,10],[0.001,10],[0,9.999],[0,0.001]];
  for(const subdivisions of [1,10]) {
    const loop=corners.flatMap((a,i)=>Array.from({length:subdivisions},(_,j)=>a.map((v,k)=>v+(corners[(i+1)%corners.length][k]-v)*j/subdivisions)));
    const inset=offsetRegion([loop],-0.2);
    assert.equal(inset.length,1);
    assert.ok(Math.abs(loopArea(inset[0])-9.6**2)<1e-8);
  }
});
