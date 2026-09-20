import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {catalog,parseDat,metrics} from '../prototype/airfoils.mjs';
import {defaults,validateDesign,buildModel,wingPoint} from '../prototype/model.mjs';
const profiles=Object.fromEntries(await Promise.all(catalog.map(async f=>[f.id,parseDat(await readFile(new URL('../prototype/data/'+f.id+'.dat',import.meta.url),'utf8'))])));
test('both coordinate layouts preserve independently known NACA and Clark Y dimensions',()=>{
  assert.ok(Math.abs(metrics(profiles.naca2412).thickness-.12)<.001);
  assert.ok(Math.abs(metrics(profiles.naca2412).camber-.02)<.001);
  assert.equal(metrics(profiles.n0012).camber,0);
  assert.ok(Math.abs(metrics(profiles.clarky).thickness-.117)<.001);
  assert.throws(()=>parseDat('broken\n61 61\n0 0\n1 0'));
});
test('planform follows chord, span, twist and mirrored span convention',()=>{
  const d={...defaults,sweep:0,dihedral:0,twist:0};
  const a=wingPoint(d,profiles.naca2412,1,0,'upper'),b=wingPoint(d,profiles.naca2412,1,1,'upper');
  assert.equal(a[0],600);assert.equal(b[1]-a[1],143);
  assert.equal(wingPoint(d,profiles.naca2412,1,0,'upper',-1)[0],-600);
});
test('all airfoils and feature variants generate finite geometry with meaningful changes',()=>{
  for(const profile of Object.values(profiles))for(const tip of ['square','rounded','tapered','winglet'])for(const mount of ['bolts','bands','telescopic']){
    const m=buildModel({...defaults,tip,mount,flaps:true,deflection:25},profile,profiles.n0012);
    assert.ok(m.parts.every(p=>p.faces.every(f=>f.every(v=>v.length===3&&v.every(Number.isFinite)))));
    assert.ok(m.bounds.max[0]>500);
  }
  const build=d=>buildModel({...defaults,...d},profiles.naca2412,profiles.n0012);
  assert.ok(!build({ailerons:false,flaps:false}).parts.some(p=>p.group==='servos'));
  assert.ok(!build({tail:'none'}).parts.some(p=>p.id==='tail'));
  assert.notDeepEqual(build({deflection:0}).parts.find(p=>p.id==='ailerons').faces,build({deflection:20}).parts.find(p=>p.id==='ailerons').faces);
  assert.ok(build({sparDiameter:20,taper:.3}).warnings.some(w=>w.includes('exceeds')));
});
test('design files reject corrupt, unknown and out-of-range values without accepting them',()=>{
  for(const patch of [{span:0},{foil:'missing'},{sparCount:1.5},{version:2},{ailerons:'yes'},{unknown:1},{notes:4}])assert.throws(()=>validateDesign({...defaults,...patch}));
  assert.deepEqual(validateDesign(JSON.parse(JSON.stringify(defaults))),defaults);
});
