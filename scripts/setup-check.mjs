// Runtime check shared by checkouts, release builds and each installed version's first start.
// No Git, regression suite, slicing or machine actions.
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';

export async function checkSetup({log=console.log}={}) {
  assert.ok(Number(process.versions.node.split('.')[0])>=22,'SAAM requires Node.js 22 or newer.');
  const started=performance.now(),stages={};
  const stage=async(name,action)=>{
    log(`Checking ${name}...`);
    const start=performance.now();
    try{await action();}catch(error){error.message=`${name}: ${error.message}`;throw error;}
    stages[name]=Math.round(performance.now()-start);
  };
  const manifest=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  await stage('dependency entry points',async()=>{
    for(const name of Object.keys(manifest.dependencies)){
      const entry=import.meta.resolve(name);
      await access(fileURLToPath(entry));
    }
  });
  await stage('geometry kernels',async()=>{
    const r=await (await import('rhino3dm')).default();
    const line=new r.LineCurve([0,0,0],[1,0,0]);
    try{assert.deepEqual(line.pointAt(0.5),[0.5,0,0]);}finally{line.delete();}
    const {clipPaths}=await import('../core/region/clipper.mjs');
    const square=[{X:0,Y:0},{X:10,Y:0},{X:10,Y:10},{X:0,Y:10}];
    assert.equal(clipPaths([square],[],'union').length,1);
    if(manifest.dependencies['manifold-3d']){
      const {solidKernel}=await import('../core/geom/solid.mjs');
      const kernel=await solidKernel(),cube=kernel.Manifold.cube([1,1,1]);
      try{assert.ok(Math.abs(cube.volume()-1)<1e-9);}finally{cube.delete();}
    }
  });
  await stage('unapproved geometry and Studio',async()=>{
    const {createTemporaryWorkspace}=await import('../core/application/temporary-workspace.mjs');
    const workspace=await createTemporaryWorkspace('setup-check'),directory=resolve(workspace.directory,'bundle');let server;
    try{
      const {initBundle}=await import('../core/print/bundle.mjs');
      const {defaults}=await import('../core/print/plan.mjs');
      // A 10 × 10 × 2 mm box: six flat patches, each a 2 × 2 net of shared corners.
      const face=(name,a,b,c,d)=>({name,degreeU:1,degreeV:1,controlPoints:[[a,b],[c,d]]});
      const box={shape:'spline',patches:[face('top',[0,0,2],[0,10,2],[10,0,2],[10,10,2]),face('bottom',[0,0,0],[0,10,0],[10,0,0],[10,10,0]),
        face('front',[0,0,0],[0,0,2],[10,0,0],[10,0,2]),face('right',[10,0,0],[10,0,2],[10,10,0],[10,10,2]),
        face('back',[0,10,0],[0,10,2],[10,10,0],[10,10,2]),face('left',[0,0,0],[0,0,2],[0,10,0],[0,10,2])]};
      const plan=defaults();plan.geometry=box;
      await initBundle(directory,plan,{machineId:'ultimaker-s5'});
      const {createStudio}=await import('../studio/server.mjs');
      const {createChatChannel}=await import('../core/application/chat-requests.mjs');
      server=createStudio(directory,{libraryRoot:workspace.directory,chat:createChatChannel(workspace.directory,{ownerId:'setup-check'}).binding});
      await new Promise((done,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',done);});
      const origin=`http://127.0.0.1:${server.address().port}`;
      const page=await fetch(origin,{signal:AbortSignal.timeout(10000)});
      assert.equal(page.status,200);assert.match(await page.text(),/saam-token/);
      const response=await fetch(origin+'/api/state',{signal:AbortSignal.timeout(10000)});
      const state=await response.json();assert.equal(response.status,200,state.error);
      assert.ok(state.geometry);
      assert.equal(state.program,undefined);
    }finally{
      if(server?.listening)await server.shutdown();
      await workspace.release();
    }
  });
  const result={node:process.version,platform:process.platform,arch:process.arch,stagesMs:stages,totalMs:Math.round(performance.now()-started)};
  log(`SAAM is ready (${(result.totalMs/1000).toFixed(2)}s). No machine actions were created.`);
  return result;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const deadline=setTimeout(()=>{console.error('SAAM setup check timed out after 30 seconds.');process.exit(1);},30000).unref();
  try{await checkSetup();}catch(error){console.error(`SAAM setup failed: ${error.message}`);process.exitCode=1;}
  finally{clearTimeout(deadline);}
}
