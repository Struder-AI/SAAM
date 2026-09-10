import test from 'node:test';
import assert from 'node:assert/strict';
import {buildGeometryView,pickGeometry} from '../../studio/mesh-view.mjs';
import {pipeMesh} from '../geom/cylinder.mjs';

function pipe(){
  const mesh=pipeMesh({innerRadiusMm:7,outerRadiusMm:10,heightMm:12,toleranceMm:.1});
  return {vertices:mesh.vertices,faces:mesh.triangles,labels:mesh.triangles.map(()=>'pipe')};
}

test('geometry normals smooth a triangulated cylinder while retaining its flat rim and bore',()=>{
  const geometry=pipe(),before=structuredClone(geometry),view=buildGeometryView(geometry);
  for(let f=0;f<geometry.faces.length;f++){
    const flat=view.topology.normals[f];
    for(let k=0;k<3;k++){
      const p=geometry.vertices[geometry.faces[f][k]],n=view.cornerNormals[f][k];
      assert.ok(Math.abs(Math.hypot(...n)-1)<1e-10);
      if(Math.abs(flat[2])>.9)assert.ok(Math.abs(n[2])>.99999,'rim remains flat');
      else{
        assert.ok(Math.abs(n[2])<1e-10,'wall is not rounded into the rim');
        const radial=(n[0]*p[0]+n[1]*p[1])/Math.hypot(p[0],p[1]);
        assert.ok(Math.hypot(p[0],p[1])>9?radial>.9999:radial<-.9999,'radial lighting is independent of triangle seams');
      }
    }
  }
  assert.deepEqual(geometry,before,'display smoothing never edits reviewed geometry');
  assert.equal(view.surface.length,geometry.faces.length*3*7);
  assert.ok(view.outlines.length<view.surface.length/2,'quiet rims replace triangle and vertical facet outlines');
});

test('named feature boundaries remain crisp even at shallow angles and coincident patch vertices',()=>{
  const geometry={vertices:[[0,0,0],[1,0,0],[0,1,0],[0,0,0],[1,0,0],[0,-1,.1]],faces:[[0,1,2],[4,3,5]],labels:['roof','side']};
  const view=buildGeometryView(geometry);
  assert.deepEqual(view.cornerNormals[0][0],[0,0,1]);
  assert.ok(view.cornerNormals[1][1][1]>.09);
  assert.equal(view.triangles[0].id,'roof');assert.equal(view.triangles[1].id,'side');
});

test('geometry picking compares depth at the pointer instead of average face depth',()=>{
  const view=buildGeometryView({vertices:[[0,0,10],[10,0,-10],[0,10,-10],[0,0,0],[10,0,0],[0,10,0]],faces:[[0,1,2],[3,4,5]],labels:['sloped','flat']});
  assert.equal(pickGeometry(view,p=>p,1,1),'sloped');
  assert.equal(pickGeometry(view,p=>p,8,1),'flat');
  assert.equal(pickGeometry(view,p=>p,11,11),null);
});

test('top-view picking leaves an actual pipe bore and exterior empty',()=>{
  const view=buildGeometryView(pipe());
  assert.equal(pickGeometry(view,p=>p,0,0),null);
  assert.equal(pickGeometry(view,p=>p,8.5,0),'pipe');
  assert.equal(pickGeometry(view,p=>p,11,0),null);
});
