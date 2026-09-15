import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {defaults,validatePlan} from '../../../core/print/plan.mjs';
import {rhino} from '../../../core/print/geometry.mjs';
import {buildShell,generatePath} from '../../../core/print/generate.mjs';
import {initBundle,loadBundle,adjustBundle,approve} from '../../../core/print/bundle.mjs';
import {applyText} from '../../../core/print/text.mjs';
import {geometrySelections} from '../../../core/geom/selections.mjs';
import {textDigest} from '../../../core/geom/text-record.mjs';
import {tessellateShell} from '../../../core/geom/tessellate.mjs';
import {solidKernel,solidFromMesh} from '../../../core/geom/solid.mjs';
import {sectionGeometry} from '../../../core/geom/query.mjs';
import {regionArea} from '../../../core/region/region2d.mjs';
import {loadMachine} from '../../../core/machine/profile.mjs';
import {compileText} from '../scripts/text.mjs';
import {compileHeatSet} from '../../heat-set-inserts/scripts/geometry.mjs';
import {heatSetFeature,heatSetFeatures} from '../../heat-set-inserts/scripts/feature.mjs';

const fontPath=fileURLToPath(new URL('fixtures/Abel-Regular.ttf',import.meta.url)),bytes=await readFile(fontPath);
const font={data:bytes.toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex')};
const r=await rhino(),machine=loadMachine(),base={shape:'box',runMm:16,widthMm:10,heightMm:2};
const f=patch=>({id:'label',text:'BO',sizeMm:7,positionMm:[2,2],depthMm:0.8,outlineOffsetMm:0.15,font,reference:{kind:'top'},...patch});
const compile=(base,features,options={})=>compileText(base,features,{buildGeometry:g=>buildShell(r,g),...options});
async function temp(t){const dir=await mkdtemp(join(tmpdir(),'saam-text-interop-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
const region=(id,part,skills,lowerSurfaceFrom=null)=>({id,part,zStartMm:0,zEndMm:null,skills,lowerSurfaceFrom});

test('material selections preserve geometry approval when the printing plan switches between planar and draped letters',async t=>{
  const dir=await temp(t),plan=defaults();plan.geometry=base;plan.skills['draped-skin'].enabled=false;
  plan.process.minimumLayerSeconds=0;
  await initBundle(dir,plan,{setupFile:join(dir,'absent.json')});
  let state=await applyText(dir,{feature:f()});
  await approve(dir,{stage:'geometry',revision:state.revision,actor:'SYNTHETIC INTEROPERABILITY TEST — not a manufacturing approval'});
  state=await loadBundle(dir,{program:false});const geometryHash=state.geometryHash;
  const regions=[region('body','base',{'full-fill':{}}),region('label','text/label',{'full-fill':{}},'body')];
  state=await adjustBundle(dir,{composition:{regions}},{expectedRevision:state.revision});
  assert.equal(state.geometryHash,geometryHash);assert.equal(state.geometryApproved,true);
  regions[1].skills={'draped-skin':{layers:4,normalMm:0.2,surveyStepMm:0.1}};
  state=await adjustBundle(dir,{composition:{regions}},{expectedRevision:state.revision});
  assert.equal(state.geometryHash,geometryHash);assert.equal(state.geometryApproved,true);
  const path=generatePath(state.plan,machine,r);
  assert.ok(path.actions.some(a=>a.region==='label'&&a.phase==='draped-skin'&&a.volumeMm3>0));
  const overlap=structuredClone(state.plan);overlap.composition.regions[0].part=null;
  overlap.composition.regions[1].lowerSurfaceFrom=null;
  assert.throws(()=>generatePath(overlap,machine,r),/Overlapping material regions/,'whole solid and one of its partitions cannot both own the same material');
  await assert.rejects(applyText(dir,{remove:'label'}),/Region must select/);
  assert.equal((await loadBundle(dir,{program:false})).geometryHash,geometryHash,'an invalid dependent edit leaves the bundle unchanged');
  state=await applyText(dir,{remove:'label',regions:[region('body',null,{'full-fill':{}})]});
  assert.deepEqual(state.plan.geometry,base,'feature and dependent region changes save atomically');
});

test('overlapping labels and later engraving partition the final solid without double ownership',async()=>{
  const geometry=await compile(base,[f({id:'one',text:'OO'}),f({id:'two',text:'BO',positionMm:[3,2]}),
    f({id:'cut',text:'I',positionMm:[5,2],mode:'recessed',offsetMm:0.8,depthMm:1.2})]);
  const selections=geometrySelections(geometry),parts=[...selections.values()].filter(s=>s.material!==null);
  assert.equal(selections.has('text/cut'),false,'cutters are not printable material');
  assert.ok(parts.length===3);assert.ok(parts.find(p=>p.material==='base').geometry.shape==='mesh','engraving updates the substrate material too');
  const k=await solidKernel();
  const volume=g=>{const solid=solidFromMesh(k,tessellateShell(buildShell(r,g)));try{return solid.volume();}finally{solid.delete();}};
  assert.ok(Math.abs(parts.reduce((sum,p)=>sum+volume(p.geometry),0)-volume(geometry))<1e-4);
  for(const z of [1,1.8,2.3,2.6]){
    const sum=parts.reduce((sum,p)=>sum+regionArea(sectionGeometry(buildShell(r,p.geometry),z).loops),0);
    assert.ok(Math.abs(sum-regionArea(sectionGeometry(buildShell(r,geometry),z).loops))<1e-4,'material sections cover the final solid once');
  }
});

test('translated assembly text partitions remain in the selected component frame',async()=>{
  const text=await compile(base,[f()]),plan=defaults();
  plan.geometry={shape:'assembly',parts:[{id:'nameplate',geometry:text,xMm:11,yMm:7,zMm:0},
    {id:'other',geometry:base,xMm:40,yMm:0,zMm:0}]};
  plan.composition.regions=[region('body','nameplate/base',{'full-fill':{}}),
    region('name','nameplate/text/label',{'draped-skin':{layers:4,normalMm:0.2,surveyStepMm:0.1}},'body'),
    region('other','other',{'full-fill':{}})];
  plan.process.minimumLayerSeconds=0;
  const path=generatePath(plan,machine,r),moves=path.actions.filter(a=>a.region==='name'&&a.volumeMm3>0);
  assert.ok(moves.length>20);
  assert.ok(moves.every(m=>m.to[0]>plan.placement.xMm+11&&m.to[1]>plan.placement.yMm+7));
});

test('standalone text retains a native top reference through edits without printing or restoring its substrate',async t=>{
  const dir=await temp(t),plan=defaults();plan.geometry=base;plan.skills['draped-skin'].enabled=false;
  await initBundle(dir,plan,{setupFile:join(dir,'absent.json')});
  let state=await applyText(dir,{standalone:true,feature:f({overlapMm:0})});
  assert.deepEqual(state.plan.geometry.base,base);assert.equal(state.plan.geometry.standalone,true);
  assert.equal(geometrySelections(state.plan.geometry).has('base'),false);
  assert.ok(state.geometry.boundsMm.min[2]>=2);
  state=await applyText(dir,{feature:{id:'label',text:'B'}});
  assert.equal(state.plan.geometry.standalone,true);assert.ok(state.geometry.boundsMm.min[2]>=2);
  await assert.rejects(applyText(dir,{remove:'label'}),/last standalone text/);
});

test('older text records remain readable and whole-solid planar consumers retain side-letter geometry',async()=>{
  const side={kind:'plane',origin:[0,0,0],xAxis:[1,0,0],yAxis:[0,0,1]};
  const guide={...base,heightMm:10},geometry=await compile(guide,[f({text:'O',sizeMm:6,positionMm:[5,2],reference:side})]);
  const plan=defaults();plan.geometry=geometry;plan.skills['draped-skin'].enabled=false;
  plan.process.minimumLayerSeconds=0;
  const path=generatePath(plan,machine,r);
  assert.ok(path.actions.some(a=>a.volumeMm3>0&&a.to[1]<plan.placement.yMm-0.1),'planar wall follows side lettering');
  const legacy=structuredClone(geometry);delete legacy.materialParts;legacy.compiledHash=textDigest(legacy);
  plan.geometry=legacy;validatePlan(plan,machine);
  assert.deepEqual([...geometrySelections(legacy).keys()],[null]);
});

test('selected text bases preserve heat-set reinforcement while standalone reference bodies contribute none',async()=>{
  const host=await compileHeatSet({shape:'box',runMm:30,widthMm:30,heightMm:12},
    [heatSetFeature({positionMm:[20,20,12]})],{buildGeometry:g=>buildShell(r,g)});
  // A separate engraved mark forces a mesh base partition, exercising the
  // retained preparation details rather than relying on a native base wrapper.
  const features=[f({text:'B'}),f({id:'engraving',text:'I',mode:'recessed',positionMm:[12,2]})];
  const plan=defaults();plan.geometry=await compile(host,features);plan.process.minimumLayerSeconds=0;
  plan.composition.regions=[region('body','base',{'full-fill':{}}),region('name','text/label',{'draped-skin':{layers:4,normalMm:0.2,surveyStepMm:0.1}},'body')];
  const path=generatePath(plan,machine,r);
  assert.ok(path.actions.some(a=>a.region==='body'&&a.role==='heat-set-loop'));
  assert.ok(path.actions.some(a=>a.region==='body'&&a.role==='heat-set-fin'));
  assert.ok(!path.actions.some(a=>a.region==='name'&&a.role?.startsWith('heat-set')));
  const missing=structuredClone(plan);missing.composition.regions.shift();missing.composition.regions[0].lowerSurfaceFrom=null;
  assert.throws(()=>generatePath(missing,machine,r),/covering its entire bore depth/);
  const standalone=await compile(host,[f({text:'B',overlapMm:0})],{standalone:true});
  assert.deepEqual(heatSetFeatures(standalone),[]);
  assert.equal(buildShell(r,standalone).planarDetails,undefined);
});
