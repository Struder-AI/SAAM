import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {defaults} from '../../../core/print/plan.mjs';
import {rhino} from '../../../core/print/geometry.mjs';
import {generatePath,buildShell,translateShell} from '../../../core/print/generate.mjs';
import {loadMachine} from '../../../core/machine/profile.mjs';
import {topAt} from '../../../core/geom/query.mjs';
import {exportProgram,interpretProgram} from '../../../core/export/registry.mjs';
import {compileText} from '../scripts/text.mjs';
import {geometrySelections} from '../../../core/geom/selections.mjs';

const bytes=await readFile(new URL('fixtures/Abel-Regular.ttf',import.meta.url));
const font={data:bytes.toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex'),postscriptName:null};
const machine=loadMachine(),r=await rhino();
async function letteredPlan(depthMm=0.8){
  const plan=defaults(machine),heightsMm=[[2,2.2,2.4,2.6],[2.4,2.6,2.8,3],[2.4,2.6,2.8,3],[2,2.2,2.4,2.6]];
  const roof={shape:'spline-top',runMm:16,widthMm:10,cpU:4,cpV:4,heightsMm};
  plan.geometry=await compileText(roof,[{id:'letters',text:'BO',font,sizeMm:7,align:'center',positionMm:[8,3],
    outlineOffsetMm:0.15,depthMm,overlapMm:0.1,reference:{kind:'top'}}],{buildGeometry:g=>buildShell(r,g)});
  plan.process.minimumLayerSeconds=0;
  plan.composition.regions=[
    {id:'roof',part:'base',zStartMm:0,zEndMm:null,skills:{'full-fill':{},'draped-skin':{layers:2,normalMm:0.2,surveyStepMm:0.2}},lowerSurfaceFrom:null},
    {id:'letters',part:'text/letters',zStartMm:0,zEndMm:null,skills:{'draped-skin':{layers:4,normalMm:0.2,sampleStepMm:0.2,surveyStepMm:0.1}},lowerSurfaceFrom:'roof'}];
  return plan;
}

test('raised glyphs deposit four curved layers above the finished native roof, with no repeated body or strokes across counters',async()=>{
  const plan=await letteredPlan(),path=generatePath(plan,machine,r);
  const base=plan.geometry.base;
  const letters=translateShell(buildShell(r,geometrySelections(plan.geometry).get('text/letters').geometry),plan.placement.xMm,plan.placement.yMm);
  const roofHeight=p=>{
    const u=(p[0]-plan.placement.xMm)/base.runMm,v=(p[1]-plan.placement.yMm)/base.widthMm;
    return 2+0.6*v+1.2*u*(1-u); // Independent bicubic height polynomial.
  };
  const groups=new Map();let previous=path.initialPosition,lastRoof=-1,firstLetters=Infinity,curved=0;
  for(const [index,a] of path.actions.entries()){
    if(a.volumeMm3>0&&a.region==='roof')lastRoof=index;
    if(a.volumeMm3>0&&a.region==='letters'){
      firstLetters=Math.min(firstLetters,index);assert.equal(a.phase,'draped-skin');
      const group=groups.get(a.operation)??{left:0,right:0};
      group[a.to[0]-plan.placement.xMm<8?'left':'right']++;groups.set(a.operation,group);
      if(Math.abs(a.to[2]-previous[2])>1e-5)curved++;
      for(const p of [previous,a.to,previous.map((v,i)=>(v+a.to[i])/2)]){
        const upper=topAt(letters,p[0],p[1]);assert.ok(upper&&upper.slopeDeg<15,'deposition stays inside glyph tops, including counters');
        const roofZ=roofHeight(p);
        assert.ok(p[2]>roofZ+0.18&&p[2]<roofZ+0.82,'letter material occupies only the requested relief');
      }
      if(a.operation.endsWith(':0')){
        const gap=((previous[2]-roofHeight(previous))+(a.to[2]-roofHeight(a.to)))/2;
        assert.ok(Math.abs(a.gapMm-gap)<1e-6,'first bead measures its actual local support');
      }
    }
    if(a.kind==='move')previous=a.to;
  }
  assert.equal(groups.size,4);assert.ok([...groups.values()].every(g=>g.left>10&&g.right>10),'both letters print in every curved layer');
  assert.ok(curved>40);assert.ok(firstLetters>lastRoof,'all roof skin precedes lettering');
  const program=interpretProgram(exportProgram(path,plan,machine,{generatorVersion:'0.1.0',buildDate:'2026-09-15'}),plan,machine);
  assert.ok(program.moves.some(m=>m.operation?.startsWith('letters:')&&m.volumeMm3>0&&Math.abs(m.to[2]-m.from[2])>1e-5),'checked machine commands preserve the curved letter strokes');
});

test('a consumed draped surface permits a thinner first bead, but rejects deposition into support and missing support',async()=>{
  const plan=await letteredPlan(0.75),path=generatePath(plan,machine,r);
  const first=path.actions.filter(a=>a.region==='letters'&&a.operation.endsWith(':0')&&a.volumeMm3>0);
  assert.ok(first.length>20&&first.every(a=>a.gapMm>0.14&&a.gapMm<0.16),'0.75 mm relief uses a 0.15 mm first bead plus three 0.2 mm skins');
  plan.composition.regions[1].skills['draped-skin'].layers=6;
  assert.throws(()=>generatePath(plan,machine,r),/deposit into material already there/);
  plan.composition.regions[1].skills['draped-skin'].layers=4;
  const selections=geometrySelections(plan.geometry);
  plan.geometry={shape:'assembly',parts:[{id:'base',geometry:selections.get('base').geometry,xMm:0,yMm:0,zMm:0},
    {id:'lettering',geometry:selections.get('text/letters').geometry,xMm:20,yMm:0,zMm:0}]};
  plan.composition.regions[1].part='lettering';
  assert.throws(()=>generatePath(plan,machine,r),/does not cover the skin stroke/);
});
