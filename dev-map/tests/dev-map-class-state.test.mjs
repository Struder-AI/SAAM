import test from 'node:test';
import assert from 'node:assert/strict';
import {loadFlow,flowPacket} from '../lib/flow.mjs';
import {compactPage} from '../lib/agent-view.mjs';
import {presentationPage} from '../lib/presentation.mjs';
const file='core/runtime.mjs';
async function page(source,name='Runtime'){
  return flowPacket(await loadFlow({repo:'',files:[file],readSource:()=>source}),`${file}::${name}`);
}
test('class boundaries expose source-proven state updates and indirect receiver limits',async()=>{
  const p=await page(`export class Runtime {
constructor(){this.count=0;this.globals=new Map();this.record={};}
step(){this.count++;this.globals.set('x',1);this.record.value=2;}
read(){return [this.count,this.record.value,this.globals.get('x')];}
}`);
  assert.equal(p.stateful,true);
  assert.equal(compactPage(p).stateful,true);
  const id=name=>p.components.find(c=>c.label===`Runtime::${name}`).index;
  for(const field of ['count','record'])assert.ok(p.wires.some(w=>w.from===id('step')&&w.to===id('read')&&w.label===field&&w.kind==='state'));
  assert.ok(!p.wires.some(w=>w.from===id('step')&&w.to===id('read')&&w.label==='globals'),'unknown method effect is not an invented mutation wire');
  assert.equal(p.uncertainty.filter(u=>u.kind==='nested-receiver-effect'&&u.field==='globals').length,2);
});
test('constructor initialization and foreign this scopes do not imply stateful instances',async()=>{
  const p=await page(`export class Runtime {
constructor(){this.value=1;}
read(){function foreign(){this.value++;} return this.value;}
}`);
  assert.equal(p.stateful,undefined);
  const lexical=await page(`export class Runtime {constructor(){this.value=0;} change(){const update=()=>this.value++;update();}}`);
  assert.equal(lexical.stateful,true);
});
test('class field dependencies keep static and instance receivers separate',async()=>{
  const p=await page(`export class Runtime {
constructor(){this.value=0;}
read(){return this.value;}
static change(){this.value++;}
static readStatic(){return this.value;}
}`);
  const id=(name,isStatic=false)=>p.components.find(c=>c.label===`Runtime::${isStatic?'@static/':''}${name}`).index;
  assert.ok(!p.wires.some(w=>w.kind==='state'&&w.from===id('change',true)&&w.to===id('read')));
  assert.ok(p.wires.some(w=>w.kind==='state'&&w.from===id('change',true)&&w.to===id('readStatic',true)));
});

test('literal computed fields are connected and dynamic instance fields stay explicit',async()=>{
  const p=await page(`export class Runtime {write(){this['value']=1;} read(){return this['value'];} dynamic(key){return this[key];}}`);
  const id=name=>p.components.find(c=>c.label===`Runtime::${name}`).index;
  assert.ok(p.wires.some(w=>w.kind==='state'&&w.from===id('write')&&w.to===id('read')&&w.label==='value'));
  assert.ok(p.uncertainty.some(u=>u.kind==='computed-instance-field'&&u.path.endsWith('::dynamic')));
});

test('class overview repeats collapse without losing callers, field identity or detailed evidence',()=>{
  const page={kind:'class',index:'1.1.1',components:[{index:'a',callerReferences:[{index:'elsewhere'}]},{index:'b'}],
    wires:[{from:'a',to:'b',kind:'call',edgeId:'1'},{from:'a',to:'b',kind:'call',edgeId:'2'},
      {from:'a',to:'b',kind:'state',label:'stack',edgeId:'3'},{from:'a',to:'b',kind:'state',label:'stack',edgeId:'4'},
      {from:'b',to:'a',kind:'state',label:'stack',edgeId:'5'}]};
  const shown=presentationPage(page);
  assert.equal(shown.wires.length,3);
  assert.equal(shown.wires.find(w=>w.kind==='call').label,'call ×2');
  assert.equal(shown.wires.filter(w=>w.kind==='state').every(w=>w.label==='stack'),true);
  assert.deepEqual(shown.components[0].callerReferences,[{index:'elsewhere'}]);
  assert.deepEqual(presentationPage(shown),shown);
  assert.equal(page.wires.length,5);
  assert.deepEqual(shown.relationshipSummary,{sites:5,connections:3,details:'1.1.1'});
});
