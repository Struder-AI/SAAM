import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {compileText,textFeature} from '../scripts/text.mjs';
import {textOutlines} from '../../../core/geom/text-outline.mjs';
import {solidKernel,solidFromMesh,meshFromSolid,combineSolids} from '../../../core/geom/solid.mjs';
import {tessellateShell} from '../../../core/geom/tessellate.mjs';
import {referenceSurface} from '../../../core/geom/reference-surface.mjs';
import {regionArea} from '../../../core/region/region2d.mjs';
import {sectionMesh,makeMesh,meshTopAt} from '../../../core/geom/mesh.mjs';
import {rhino} from '../../../core/print/geometry.mjs';
import {buildShell} from '../../../core/print/generate.mjs';
import {defaults,validatePlan} from '../../../core/print/plan.mjs';
import {loadMachine} from '../../../core/machine/profile.mjs';
import {initBundle,loadBundle,generateBundle,approve} from '../../../core/print/bundle.mjs';
import {applyText} from '../../../core/print/text.mjs';
import {importSTLBundle} from '../../../core/print/import-stl.mjs';
import {fullFillResult} from '../../full-fill/scripts/fill.mjs';
import {topAt} from '../../../core/geom/query.mjs';
import {perimeterLoops} from '../../../core/region/perimeters.mjs';

const fontPath=new URL('./fixtures/Abel-Regular.ttf',import.meta.url);
const bytes=await readFile(fontPath),font={data:bytes.toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex')};
const r=await rhino(),buildGeometry=g=>buildShell(r,g),base={shape:'box',runMm:20,widthMm:12,heightMm:3};
const plane={kind:'plane',origin:[0,0,3],xAxis:[1,0,0],yAxis:[0,1,0]};
const feature=(patch={})=>textFeature({text:'BO',font,reference:plane,positionMm:[2,2],sizeMm:7,...patch});
const compile=(target,features,options={})=>compileText(target,features,{buildGeometry,...options});
const volume=async mesh=>{const k=await solidKernel(),s=solidFromMesh(k,mesh);try{return s.volume();}finally{s.delete();}};

test('solid union and subtraction have independent analytical volumes',async()=>{
  const k=await solidKernel(),a=k.Manifold.cube([2,3,4]),b=k.Manifold.cube([2,3,4]).translate([1,0,0]);
  try{for(const [op,expected] of [['add',36],['subtract',12]]){const result=combineSolids(a,b,op);try{assert.equal(result.volume(),expected);makeMesh(...[meshFromSolid(result)].flatMap(m=>[m.vertices,m.triangles]));}finally{result.delete();}}}finally{a.delete();b.delete();}
});
test('font outlines retain B/O counters and kerning; missing characters fail',()=>{
  const outline=textOutlines(feature(),0.01);assert.equal(outline.loops.length,5);
  assert.ok(regionArea(outline.loops)>0);
  const kerned=textOutlines(feature({text:'AV'}),0.01),spaced=textOutlines(feature({text:'AV',letterSpacingMm:2}),0.01);
  assert.ok(spaced.glyphs[1].anchor[0]>kerned.glyphs[1].anchor[0]+1.9);
  assert.throws(()=>textOutlines(feature({text:'\u{10ffff}'}),0.02),/missing.*glyph/);
});
test('flat raised and recessed letters change material sections and preserve counters',async()=>{
  const outlines=textOutlines(feature(),0.02),area=regionArea(outlines.loops);
  const raised=await compile(base,[feature()]),recessed=await compile(base,[feature({mode:'recessed'})]);
  const a=makeMesh(raised.vertices,raised.triangles),b=makeMesh(recessed.vertices,recessed.triangles);
  assert.ok(Math.abs(regionArea(sectionMesh(a,3.3).loops)-area)<1e-4);
  assert.ok(Math.abs(regionArea(sectionMesh(b,2.7).loops)-(240-area))<1e-4);
  assert.ok(Math.abs(await volume(a)-(720+area*0.6))<1e-3);
  assert.ok(Math.abs(await volume(b)-(720-area*0.6))<1e-3);
  assert.equal(regionArea(sectionMesh(b,1).loops),240);
});
test('spline target conversion retains analytical box volume and curved roof convergence',async()=>{
  const box=tessellateShell(buildGeometry(base));assert.ok(Math.abs(await volume(box)-720)<1e-6);
  const geometry={shape:'spline-top',runMm:20,widthMm:12,cpU:4,cpV:4,heightsMm:[[3,3,3,3],[3,5,5,3],[3,5,5,3],[3,3,3,3]]};
  const coarse=tessellateShell(buildGeometry(geometry),{toleranceMm:0.08}),fine=tessellateShell(buildGeometry(geometry),{toleranceMm:0.02});
  assert.ok(fine.triangles.length>=coarse.triangles.length);
  // Integral of the tensor-product cubic bump: 2*(2/4)*(2/4)*area.
  const expected=840;
  assert.ok(Math.abs(await volume(fine)-expected)<Math.abs(await volume(coarse)-expected));
  const embossed=await compile(geometry,[feature({reference:{kind:'part',patch:'top',sizeMm:[20,12]}})]);
  assert.ok(await volume(makeMesh(embossed.vertices,embossed.triangles))>await volume(fine));
});
const cylinder={kind:'spline',degreeU:2,degreeV:1,sizeMm:[Math.PI*5,12],controlPoints:[[[10,0,0],[10,0,12]],[[10,10,0,Math.SQRT1_2],[10,10,12,Math.SQRT1_2]],[[0,10,0],[0,10,12]]]};
test('independent rational cylindrical reference bends the full solid at normal depth',async()=>{
  const record=await compile(null,[feature({text:'O',reference:cylinder,positionMm:[3,2],overlapMm:0})],{maxEdgeMm:1});
  for(const p of record.vertices){const radius=Math.hypot(p[0],p[1]);assert.ok(radius>=9.99&&radius<=10.61);}
  assert.ok(record.vertices.some(p=>Math.abs(Math.hypot(p[0],p[1])-10.6)<1e-4));
  assert.ok(record.vertices.some(p=>Math.abs(Math.hypot(p[0],p[1])-10)<1e-4));
});
test('doubly curved standalone reference, spline baseline, mirroring and rigid glyphs',async()=>{
  const reference={kind:'spline',degreeU:2,degreeV:2,sizeMm:[20,12],controlPoints:[[[0,0,4],[0,6,5],[0,12,4]],[[10,0,5],[10,6,7],[10,12,5]],[[20,0,4],[20,6,5],[20,12,4]]]};
  const warped=await compile(null,[feature({reference,overlapMm:0})]);
  assert.ok(Math.max(...warped.vertices.map(p=>p[2]))>5);
  const curved=await compile(null,[feature({text:'ABC',sizeMm:5,positionMm:[0,0],baseline:{controlPoints:[[1,2],[8,6],[17,2]]},overlapMm:0})]);
  assert.ok(curved.triangles.length>0);
  const rigid=await compile(null,[feature({text:'O',reference:cylinder,bendGlyphs:false,overlapMm:0})]);assert.ok(rigid.triangles.length>0);
  const mirrored=await compile(null,[feature({mirror:true,positionMm:[15,2],overlapMm:0})]);assert.ok(mirrored.triangles.length>0);
  assert.ok(await volume(makeMesh(mirrored.vertices,mirrored.triangles))>0);
});
test('inward reference normals preserve positive volume and reverse physical relief direction',async()=>{
  const result=await compile(null,[feature({reference:{...plane,normalSide:-1},overlapMm:0})]);
  const mesh=makeMesh(result.vertices,result.triangles);
  assert.ok(await volume(mesh)>0);assert.ok(Math.abs(mesh.bounds.min[2]-2.4)<1e-5);assert.equal(mesh.bounds.max[2],3);
  const recessed=await compile(base,[feature({mode:'recessed',reference:{...plane,origin:[0,0,0],normalSide:-1}})]);
  assert.ok(regionArea(sectionMesh(makeMesh(recessed.vertices,recessed.triangles),0.3).loops)<240);
});
test('lettering finer than the retired triangle ceiling compiles and stays valid',async()=>{
  // Over 100,000 triangles: the former fixed ceiling refused this before any
  // refinement ran. Only a request the 32-bit kernel cannot address is refused.
  const record=await compile(null,[feature({overlapMm:0})],{maxEdgeMm:0.035});
  assert.ok(record.triangles.length>100000,`triangles: ${record.triangles.length}`);
  assert.ok(await volume(makeMesh(record.vertices,record.triangles))>0);
});
test('bad reference and stale editable recipe fail with actionable errors',async()=>{
  assert.throws(()=>referenceSurface({...cylinder,sizeMm:[0,1]}),/sizeMm/);
  await assert.rejects(compile(null,[feature({reference:cylinder,positionMm:[100,2]})]),/outside.*reference/);
  await assert.rejects(compile(null,[feature()],{maxEdgeMm:1e-30}),/increase maxEdgeMm/);
  const geometry=await compile(base,[feature()]),machine=loadMachine(),plan=defaults(machine);plan.geometry=geometry;plan.skills['draped-skin'].enabled=false;
  validatePlan(plan,machine);plan.geometry.features[0].text='changed';assert.throws(()=>validatePlan(plan,machine),/Rebuild.*text skill/);
});
test('public text editing survives reopening, invalidates reviews and generates real recessed toolpaths',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'saam-text-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const plan=defaults();plan.geometry=base;plan.skills['draped-skin'].enabled=false;plan.process.minimumLayerSeconds=0;
  await initBundle(dir,plan,{setupFile:join(dir,'absent-setup.json')});
  let state=await loadBundle(dir,{program:false});
  state=await loadBundle(dir,{program:false});
  state=await applyText(dir,{feature:{...feature(),mode:'recessed'}},{expectedRevision:state.revision});
  assert.equal(state.toolpathApproved,false);assert.equal(state.geometry.nativeFile,'model.mesh.json');
  const originalHash=state.geometryHash;
  await assert.rejects(applyText(dir,{feature:{id:'text',text:'\u{10ffff}'}}),/missing.*glyph/);
  assert.equal((await loadBundle(dir,{program:false})).geometryHash,originalHash);
  await assert.rejects(applyText(dir,{feature:{id:'text',text:'A'}},{expectedRevision:'stale'}),/stale/);
  state=await applyText(dir,{feature:{id:'text',text:'O'}});assert.notEqual(state.geometryHash,originalHash);
  const generated=await generateBundle(dir,{development:true});assert.equal(generated.result,'pass');
  const reopened=await loadBundle(dir);assert.ok(reopened.program.moves.length>0);assert.equal(reopened.toolpathApproved,false);
  state=await applyText(dir,{remove:'text'});assert.deepEqual(state.plan.geometry,base);
  const requestFile=join(dir,'text-request.json');
  await writeFile(requestFile,JSON.stringify({feature:{text:'CLI',fontPath:fileURLToPath(fontPath),sizeMm:4,reference:plane,positionMm:[2,2]}}));
  execFileSync(process.execPath,[fileURLToPath(new URL('../../../core/print/cli.mjs',import.meta.url)),'text',dir,requestFile,'--revision',state.revision],{encoding:'utf8'});
  assert.equal((await loadBundle(dir,{program:false})).plan.geometry.features[0].text,'CLI');
});
test('assembly editing preserves untouched native components and part identity',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'saam-text-assembly-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const plan=defaults();plan.skills['draped-skin'].enabled=false;
  plan.geometry={shape:'assembly',parts:[{id:'labelled',xMm:0,yMm:0,zMm:0,geometry:base},{id:'original',xMm:25,yMm:0,zMm:0,geometry:base}]};
  await initBundle(dir,plan,{setupFile:join(dir,'absent.json')});
  const state=await applyText(dir,{part:'labelled',feature:feature()});
  assert.equal(state.plan.geometry.parts[0].geometry.shape,'text');assert.deepEqual(state.plan.geometry.parts[1],plan.geometry.parts[1]);
  assert.deepEqual(state.geometry.features.map(f=>f.id),['labelled','original']);
});

test('text on an imported mesh retains and checks the original STL source',async t=>{
  const parent=await mkdtemp(join(tmpdir(),'saam-text-stl-'));t.after(()=>rm(parent,{recursive:true,force:true}));
  const dir=join(parent,'print'),mesh=tessellateShell(buildGeometry(base));
  const bytes=Buffer.from('solid box\n'+mesh.triangles.map(tri=>'facet normal 0 0 0\nouter loop\n'+tri.map(i=>'vertex '+mesh.vertices[i].join(' ')).join('\n')+'\nendloop\nendfacet').join('\n')+'\nendsolid box');
  await importSTLBundle(dir,bytes,{units:'mm',setupFile:join(parent,'absent.json')});
  const state=await applyText(dir,{feature:feature({mode:'recessed'})});
  assert.equal(state.plan.geometry.base.shape,'mesh');assert.deepEqual(await readFile(join(dir,'geometry/source.stl')),bytes);
  assert.ok(regionArea(sectionMesh(makeMesh(state.plan.geometry.vertices,state.plan.geometry.triangles),2.7).loops)<240);
  const standalone=await applyText(dir,{standalone:true,feature:feature({text:'O',reference:{kind:'top'},overlapMm:0})});
  assert.equal(standalone.plan.geometry.standalone,true);
  assert.equal(standalone.plan.geometry.base.shape,'mesh');
  assert.ok(standalone.geometry.boundsMm.min[2]>=3,'standalone text consumes the retained imported top without its substrate');
  await writeFile(join(dir,'geometry/source.stl'),Buffer.concat([bytes,Buffer.from('\n')]));
  await assert.rejects(loadBundle(dir,{program:false}),/source changed/);
});

test('explicit stroke thickening preserves every curved-roof letter in actual deposition paths',async()=>{
  const roof={shape:'spline-top',runMm:24,widthMm:14,cpU:4,cpV:4,heightsMm:[[3,3,3,3],[3,7,7,3],[3,7,7,3],[3,3,3,3]]};
  const thin=feature({text:'CURVE',sizeMm:6,positionMm:[4,4],depthMm:0.8,reference:{kind:'part',patch:'top',sizeMm:[24,14]}});
  const before=textOutlines(thin,0.02);
  assert.equal(perimeterLoops(before.glyphs[0].loops,0.2).length,0,'Original C disappears at 0.4 mm bead width');
  assert.equal(perimeterLoops(before.glyphs[1].loops,0.2).length,0,'Original U disappears at 0.4 mm bead width');
  const thick={...thin,outlineOffsetMm:0.15},geometry=await compile(roof,[thick]);
  const plan=defaults(),machine=loadMachine(),shell=buildGeometry(geometry),original=buildGeometry(roof);
  plan.geometry=geometry;plan.skills['draped-skin'].enabled=false;
  const result=fullFillResult({shell,plan,machine});
  const glyphs=textOutlines(thick,0.02).glyphs.map(g=>({min:Math.min(...g.loops.flat().map(p=>p[0]))+4,max:Math.max(...g.loops.flat().map(p=>p[0]))+4,length:0,maxRelief:0}));
  for(const operation of result.operations)for(const stroke of operation.strokes)for(let i=1;i<stroke.points.length;i++){
    const a=stroke.points[i-1],b=stroke.points[i],p=a.map((v,k)=>(v+b[k])/2),roofZ=topAt(original,p[0],p[1])?.zMm;
    if(roofZ===undefined||p[2]-roofZ<0.2)continue;
    const glyph=glyphs.find(g=>p[0]>=g.min&&p[0]<=g.max);
    if(glyph){glyph.length+=Math.hypot(...a.map((v,k)=>v-b[k]));glyph.maxRelief=Math.max(glyph.maxRelief,p[2]-roofZ);}
  }
  for(const [i,glyph] of glyphs.entries()){
    assert.ok(glyph.length>20,'Letter '+thin.text[i]+' needs substantive deposition above the roof');
    assert.ok(glyph.maxRelief>0.6,'Letter '+thin.text[i]+' must reach its upper relief layers');
  }
});

test('public circular text follows the original wavy top and deposits every letter',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'saam-circular-text-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const roof={shape:'spline-top',runMm:40,widthMm:40,cpU:4,cpV:4,
    heightsMm:[3,4,4,3].map(z=>[z,z+0.2,z+0.4,z+0.6])};
  const plan=defaults();plan.geometry=roof;plan.skills['draped-skin'].enabled=false;
  await initBundle(dir,plan,{setupFile:join(dir,'absent.json')});
  const initial=await loadBundle(dir,{program:false});
  const spec=feature({text:'groucho',sizeMm:7,align:'center',positionMm:[20,20],letterSpacingMm:0.4,
    outlineOffsetMm:0.18,depthMm:0.8,reference:{kind:'top'},baseline:{kind:'circle',radiusMm:10}});
  await applyText(dir,{feature:spec},{expectedRevision:(await loadBundle(dir,{program:false})).revision});
  const state=await loadBundle(dir,{program:false});
  assert.equal(state.toolpathApproved,false);
  assert.deepEqual(state.plan.geometry.base,roof);
  assert.deepEqual(state.plan.geometry.features[0].reference,{kind:'top'});
  assert.deepEqual(state.plan.geometry.features[0].baseline,{kind:'circle',radiusMm:10});
  const result=fullFillResult({shell:buildGeometry(state.plan.geometry),plan:state.plan,machine:loadMachine()});
  const glyphs=textOutlines(spec,0.02).glyphs.map(g=>({
    min:Math.min(...g.loops.flat().map(p=>p[0]))/10-0.02,
    max:Math.max(...g.loops.flat().map(p=>p[0]))/10+0.02,length:0,maxRelief:0
  }));
  for(const operation of result.operations)for(const stroke of operation.strokes)for(let i=1;i<stroke.points.length;i++){
    const a=stroke.points[i-1],b=stroke.points[i],p=a.map((v,k)=>(v+b[k])/2),u=p[0]/40;
    const relief=p[2]-(3+3*u*(1-u)+0.015*p[1]);
    if(relief<0.3)continue;
    const angle=Math.atan2(p[0]-20,p[1]-20),glyph=glyphs.find(g=>angle>=g.min&&angle<=g.max);
    if(glyph){glyph.length+=Math.hypot(...a.map((v,k)=>v-b[k]));glyph.maxRelief=Math.max(glyph.maxRelief,relief);}
  }
  for(const [i,glyph] of glyphs.entries()){
    assert.ok(glyph.length>1,'Circular letter '+spec.text[i]+' needs deposition above the roof');
    assert.ok(glyph.maxRelief>0.6,'Circular letter '+spec.text[i]+' must reach the relief layers');
  }
});
