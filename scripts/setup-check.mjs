// First-use runtime check. No Git, regression suite, slicing or job approvals.
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';

export async function checkSetup({log=console.log}={}) {
  assert.ok(Number(process.versions.node.split('.')[0])>=22,'SAAM requires Node.js 22 or newer.');
  const started=performance.now(),stages={};
  const stage=async(name,action)=>{
    log(`Checking ${name}...`);
    const start=performance.now();await action();stages[name]=Math.round(performance.now()-start);
  };
  const manifest=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  await stage('dependency entry points',async()=>{
    for(const name of Object.keys(manifest.dependencies)){
      const entry=import.meta.resolve(name==='@modelcontextprotocol/sdk'?'@modelcontextprotocol/sdk/server/index.js':name);
      await access(fileURLToPath(entry));
    }
  });
  await stage('geometry kernels',async()=>{
    const r=await (await import('rhino3dm')).default();
    const line=new r.LineCurve([0,0,0],[1,0,0]);
    try{assert.deepEqual(line.pointAt(0.5),[0.5,0,0]);}finally{line.delete();}
    const {booleanPaths}=await import('../core/region/clipper2.mjs');
    const square=[{X:0,Y:0},{X:10,Y:0},{X:10,Y:10},{X:0,Y:10}];
    assert.equal(booleanPaths([square],[],'Union').length,1);
    if(manifest.dependencies['manifold-3d']){
      const {solidKernel}=await import('../core/geom/solid.mjs');
      const kernel=await solidKernel(),cube=kernel.Manifold.cube([1,1,1]);
      try{assert.ok(Math.abs(cube.volume()-1)<1e-9);}finally{cube.delete();}
    }
  });
  await stage('unapproved geometry and Studio',async()=>{
    const directory=await mkdtemp(join(tmpdir(),'saam-setup-'));let server;
    try{
      const wedge=await import('../skills/wedge-demo/scripts/bundle.mjs');
      const {defaults}=await import('../skills/wedge-demo/scripts/model.mjs');
      await wedge.initBundle(directory,defaults());
      const {createStudio}=await import('../studio/server.mjs');
      server=createStudio(directory);
      await new Promise((done,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',done);});
      const origin=`http://127.0.0.1:${server.address().port}`;
      const page=await fetch(origin,{signal:AbortSignal.timeout(10000)});
      assert.equal(page.status,200);assert.match(await page.text(),/saam-token/);
      const response=await fetch(origin+'/api/state',{signal:AbortSignal.timeout(10000)});
      assert.equal(response.status,200);const state=await response.json();
      assert.ok(state.geometry);assert.equal(state.geometryApproved,false);
      assert.equal(state.planApproved,false);assert.equal(state.toolpathApproved,false);
      assert.equal(state.program,undefined);
    }finally{
      if(server?.listening)await server.shutdown();
      await rm(directory,{recursive:true,force:true});
    }
  });
  const result={node:process.version,platform:process.platform,arch:process.arch,stagesMs:stages,totalMs:Math.round(performance.now()-started)};
  log(`SAAM is ready (${(result.totalMs/1000).toFixed(2)}s). No print approvals or machine actions were created.`);
  return result;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const deadline=setTimeout(()=>{console.error('SAAM setup check timed out after 30 seconds.');process.exit(1);},30000).unref();
  try{await checkSetup();}catch(error){console.error(`SAAM setup failed: ${error.message}`);process.exitCode=1;}
  finally{clearTimeout(deadline);}
}
