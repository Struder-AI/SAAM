// Representative SAAM runs for influence traces, driven without manual steps:
//   node dev-map/influence/trace/workflows.mjs NAME HOME
// HOME is a disposable directory (trace.mjs makes one and sets SAAM_DATA inside it); nothing
// touches the user's prints or SAAM home. Approvals are synthetic and say so.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createChatChannel} from '../../../core/application/chat-requests.mjs';

const core=path=>import(new URL(`../../../core/${path}`,import.meta.url).href);
const example=path=>import(new URL(`../../../examples/prints/${path}`,import.meta.url).href);

// Generate and export the exact checked machine file, as Studio's Export does.
async function generateAndExport(directory) {
  const {generateBundle,loadBundle,exportReviewed}=await core('print/bundle.mjs');
  const checks=await generateBundle(directory);
  const state=await loadBundle(directory,{program:'source'});
  if(!state.program||state.programError)throw Error('Generation produced no program: '+(state.programError??'unknown'));
  const delivered=(await exportReviewed(state)).file;
  return {mode:checks?.mode,delivered};
}

export const workflows={
  // The tour's starting part (fin block) on the Ultimaker S5: recipe to bundle, toolpath, Griffin export.
  async 'starter-griffin'(home) {
    const {initBundle}=await core('print/bundle.mjs');
    const {starterPlan}=await example('starter/recipe.mjs');
    const directory=join(home,'Prints','starter');
    await initBundle(directory,starterPlan(),{machineId:'ultimaker-s5'});
    return generateAndExport(directory);
  },
  // An STL import (ASCII box) for the Bambu H2D: import, toolpath, Bambu export.
  async 'stl-bambu'(home) {
    const {createSTLBundle}=await core('print/import-stl.mjs');
    const x=24,y=18,z=6;
    const vertices=[[0,0,0],[x,0,0],[x,y,0],[0,y,0],[0,0,z],[x,0,z],[x,y,z],[0,y,z]];
    const quads=[[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]];
    const triangles=quads.flatMap(([a,b,c,d])=>[[a,b,c],[a,c,d]]);
    const stl='solid box\n'+triangles.map(t=>'facet normal 0 0 0\nouter loop\n'+t.map(i=>'vertex '+vertices[i].join(' ')).join('\n')+'\nendloop\nendfacet').join('\n')+'\nendsolid box\n';
    await mkdir(join(home,'source'),{recursive:true});
    const source=join(home,'source','box.stl');await writeFile(source,stl);
    const {directory}=await createSTLBundle(join(home,'Prints','box'),source,{units:'mm',machineId:'bambu-h2d'});
    return generateAndExport(directory);
  },
  // The tour's wavy pipe-cladding part on the Denso arm: static recipe, toolpath, robot program export.
  async 'denso-cladding'(home) {
    const {initBundle}=await core('print/bundle.mjs');
    const {machineId,plan}=JSON.parse(await readFile(new URL('../../../examples/prints/wavy-denso/recipe.json',import.meta.url),'utf8'));
    const directory=join(home,'Prints','wavy');
    await initBundle(directory,plan,{machineId});
    return generateAndExport(directory);
  },
  // Studio's Node side driven over HTTP as the browser would: page, state, generation (Studio's
  // job running Bundle's generation worker), synthetic confirmation and delivery. (The browser
  // code itself is not run.)
  async 'studio-session'(home) {
    const {initBundle}=await core('print/bundle.mjs');
    const {starterPlan}=await example('starter/recipe.mjs');
    const {createStudio}=await import(new URL('../../../studio/server.mjs',import.meta.url).href);
    const root=join(home,'Prints'),directory=join(root,'studio-part');
    await initBundle(directory,starterPlan(),{machineId:'ultimaker-s5'});
    const server=createStudio(directory,{libraryRoot:root,chat:createChatChannel(root,{ownerId:'studio:test'}).binding});
    try {
      await server.ready?.();
      await new Promise(done=>server.listen(0,'127.0.0.1',done));
      const origin=`http://127.0.0.1:${server.address().port}`;
      const token=/name="saam-token" content="([^"]+)"/.exec(await (await fetch(origin)).text())[1];
      const get=async path=>(await fetch(origin+'/api/'+path)).json();
      const post=async(path,body)=>{const r=await fetch(origin+'/api/'+path,{method:'POST',headers:{Origin:origin,'X-SAAM-Token':token,'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,text:await r.text()};};
      let state=await get('state');
      await fetch(origin+'/studio/app.mjs');
      const generated=await post('generate',{printId:state.printId,editRevision:state.editRevision});
      if(generated.status!==200)throw Error('Studio generation failed: '+generated.text);
      state=await get('state');
      await get('preparation');
      await post('plan',{plan:{...state.plan,process:{...state.plan.process,infillPercent:state.plan.process.infillPercent}},revision:state.revision,expectedEditRevision:state.editRevision});
      // "Confirm settings & export" for the displayed checked program, as Studio's page sends it.
      const exported=await post('export',{exportSnapshot:state.exportSnapshot,name:'trace-part',downloadLink:true});
      if(exported.status!==200)throw Error('Studio export failed: '+exported.text);
      const link=JSON.parse(exported.text);
      const download=link.url?await fetch(origin+link.url):null;
      return {generated:generated.status,exported:exported.status,downloaded:download?.status,bytes:download?(await download.arrayBuffer()).byteLength:0};
    } finally {
      if(server.shutdown)await server.shutdown();else await new Promise(done=>server.close(done));
    }
  },
  // The application's agent operations (what `saam call OP` invokes), in-process: defaults,
  // create, generate (through a Studio session, Bundle's generation worker), check, change
  // printer, STL import (mesh repair worker).
  async 'agent-session'(home) {
    const {createLocalRuntime}=await core('application/runtime.mjs');
    const {homePaths}=await core('application/home.mjs');
    const {starterPlan}=await example('starter/recipe.mjs');
    const paths=homePaths(home);
    const runtime=createLocalRuntime({paths,stateRoot:paths.state,autoOpen:false,localExtension:{}});
    const session=runtime.beginSession({id:'synthetic-trace-chat'});
    const results={};
    const call=async(name,args)=>{try{const r=await session.invoke(name,args);results[name]=(results[name]??'')+'ok ';return r;}catch(error){results[name]=(results[name]??'')+'error: '+error.message.slice(0,120)+' ';return null;}};
    try {
      await call('maker_onboarding',{});
      await call('list_machines',{});
      await call('list_skills',{});
      const defaults=await call('get_recipe_defaults',{machineId:'ultimaker-s5'});
      const plan=defaults?.plan??starterPlan();plan.geometry=starterPlan().geometry;
      await call('create_bundle',{bundleId:'Agent part',machineId:'ultimaker-s5',plan});
      await call('generate_toolpath',{bundleId:'Agent part'});
      await call('check_bundle',{bundleId:'Agent part'});
      let bundle=await call('get_bundle',{bundleId:'Agent part'});
      await call('change_machine',{bundleId:'Agent part',machineId:'bambu-x1-carbon',expectedEditRevision:bundle?.editRevision});
      await call('generate_toolpath',{bundleId:'Agent part'});
      await call('list_bundles',{});
      const x=20,y=14,z=5;
      const vertices=[[0,0,0],[x,0,0],[x,y,0],[0,y,0],[0,0,z],[x,0,z],[x,y,z],[0,y,z]];
      const quads=[[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]];
      const stl='solid box\n'+quads.flatMap(([a,b,c,d])=>[[a,b,c],[a,c,d]]).map(t=>'facet normal 0 0 0\nouter loop\n'+t.map(i=>'vertex '+vertices[i].join(' ')).join('\n')+'\nendloop\nendfacet').join('\n')+'\nendsolid box\n';
      await mkdir(join(home,'source'),{recursive:true});await writeFile(join(home,'source','box.stl'),stl);
      await call('import_stl_bundle',{bundleId:'Agent box',sourcePath:join(home,'source','box.stl'),units:'auto',machineId:'ultimaker-s5'});
      bundle=await call('get_bundle',{bundleId:'Agent box'});
      await call('adjust_recipe',{bundleId:'Agent box',expectedEditRevision:bundle?.editRevision,patch:{process:{...(bundle?.plan?.process??{}),minimumLayerSeconds:0}}});
      await call('generate_toolpath',{bundleId:'Agent box'});
    } finally {await runtime.close?.();}
    return results;
  },
  // Agent source toolkit: onboarding and manual reads.
  async 'agent-toolkit'() {
    const {runCLI}=await import(new URL('../../../scripts/agent-toolkit.mjs',import.meta.url).href);
    const outputs=[];const write=v=>outputs.push(v.ok||v.error);
    // developer-onboarding reads stored map designs, which a fresh checkout lacks.
    for(const args of [['builder-onboarding'],['maker-onboarding','--machine','ultimaker-s5'],['read-skill','draped-skin','--maker'],['read-guidance','skills/slice/SKILL.md'],['context-budget']])
      await runCLI(args,{write});
    return {ok:outputs};
  }
};

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  const [name,home]=process.argv.slice(2);
  if(!workflows[name]||!home)throw Error(`Usage: workflows.mjs NAME HOME, NAME one of ${Object.keys(workflows).join(', ')}`);
  const started=Date.now();
  const result=await workflows[name](home);
  console.log(JSON.stringify({workflow:name,seconds:(Date.now()-started)/1000,result}));
}
