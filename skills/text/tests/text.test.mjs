import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {compileText,textFeature} from '../scripts/text.mjs';
import {solidKernel,solidFromMesh} from '../../../core/geom/solid.mjs';
import {makeMesh} from '../../../core/geom/mesh.mjs';
import {rhino} from '../../../core/print/geometry.mjs';
import {buildShell} from '../../../core/print/generate.mjs';

const fontPath=new URL('./fixtures/Abel-Regular.ttf',import.meta.url);
const bytes=await readFile(fontPath),font={data:bytes.toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex')};
const r=await rhino(),buildGeometry=g=>buildShell(r,g);
const plane={kind:'plane',origin:[0,0,3],xAxis:[1,0,0],yAxis:[0,1,0]};
const feature=(patch={})=>textFeature({text:'BO',font,reference:plane,positionMm:[2,2],sizeMm:7,...patch});
const compile=(target,features,options={})=>compileText(target,features,{buildGeometry,...options});
const volume=async mesh=>{const k=await solidKernel(),s=solidFromMesh(k,mesh);try{return s.volume();}finally{s.delete();}};

test('lettering finer than the retired triangle ceiling compiles and stays valid',async()=>{
  // Over 100,000 triangles: the former fixed ceiling refused this before any
  // refinement ran. Only a request the 32-bit kernel cannot address is refused.
  const record=await compile(null,[feature({overlapMm:0})],{maxEdgeMm:0.035});
  assert.ok(record.triangles.length>100000,`triangles: ${record.triangles.length}`);
  assert.ok(await volume(makeMesh(record.vertices,record.triangles))>0);
});
