import {createServer} from 'node:http';
import {readFile,mkdir,open,rm} from 'node:fs/promises';
import {resolve,join,extname} from 'node:path';
import {Worker} from 'node:worker_threads';
import {randomUUID} from 'node:crypto';
import {replaceFile} from '../core/file-write.mjs';
import {loadWorkspaceRuntime,requireWorkspaceCurrent,workspacePieces} from '../core/extensions/workspaces.mjs';
import {relativeExtensionFile} from '../core/extensions/library.mjs';

const contentTypes={'.html':'text/html','.css':'text/css','.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2'};

// One host for bundled and locally imported workspaces. Domain code stays in extensions.
export async function startWorkspace({extensionId,port=0,directory,appRoot,dataRoot,onEvent=()=>{}}={}){
  if(typeof directory!=='string'||!directory.trim())throw Error('The SAAM application must supply a workspace directory.');
  if(!Number.isInteger(port)||port<0||port>65535)throw Error('Workspace port must be an integer from 0 to 65535.');
  const options={appRoot,dataRoot},{definition,selected,extension}=await loadWorkspaceRuntime(extensionId,options);
  directory=resolve(directory);
  await mkdir(directory,{recursive:true});
  const lockPath=join(directory,'.workspace.lock');
  const lock=await open(lockPath,'wx').catch(error=>{
    if(error.code==='EEXIST')throw Error('This workspace design is already open, or its previous host was interrupted. Close that host first; an abandoned .workspace.lock requires explicit recovery.');
    throw error;
  });
  let server,worker=null,stopping=null,closed=false,queue=Promise.resolve();
  const viewers=new Set(),saved=join(directory,'design.json');
  const emit=(kind,detail={})=>{
    const event={kind,extensionId:extension.id,extensionDigest:extension.digest,...detail};
    onEvent(event);
    for(const res of viewers)res.write('data: '+JSON.stringify(event)+'\n\n');
  };
  const serialize=action=>{
    const operation=queue.then(()=>{if(closed)throw Error('Workspace is closed.');return action();});
    queue=operation.catch(()=>{});return operation;
  };
  try{
    await lock.writeFile(JSON.stringify({pid:process.pid,extensionId}));
    const loaded=await readFile(saved,'utf8').catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    const state={design:await definition.normalize(loaded?JSON.parse(loaded):structuredClone(definition.defaults)),job:null};
    const snapshot=()=>({design:structuredClone(state.design),job:structuredClone(state.job),extension:structuredClone(extension)});
    const inspect=async()=>snapshot();
    const preview=async(design=state.design,{interactive=false}={})=>{
      await requireWorkspaceCurrent(extension,options);
      const normalized=await definition.normalize(structuredClone(design));
      return {design:normalized,preview:await definition.preview(normalized,{interactive})};
    };
    const updateDesign=(design,{source='agent'}={})=>serialize(async()=>{
      await requireWorkspaceCurrent(extension,options);
      const normalized=await definition.normalize(structuredClone(design));
      // Disk publication precedes visible state. A failed save leaves both unchanged.
      await replaceFile(saved,JSON.stringify(normalized,null,2));
      state.design=structuredClone(normalized);
      emit('workspace-design-updated',{source});return snapshot();
    });
    const createBundles=(design=state.design)=>serialize(async()=>{
      await requireWorkspaceCurrent(extension,options);
      if(worker)throw Error('A bundle creation job is already running.');
      const normalized=await definition.normalize(structuredClone(design));
      const pieces=workspacePieces(await definition.pieces(normalized));
      const id=randomUUID(),out=join(directory,'set-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+id.slice(0,6));
      state.job={id,stage:'starting',directory:out,completed:0,total:pieces.length,bundles:[]};
      const job=state.job;
      const finish=(stage,detail)=>{
        if(state.job.id!==id||['complete','failed'].includes(state.job.stage))return;
        state.job={...state.job,stage,...detail};
        emit(stage==='complete'?'workspace-bundles-completed':'workspace-bundles-failed',{jobId:id,...detail});
      };
      worker=new Worker(new URL('./export-worker.mjs',import.meta.url),{execArgv:[],workerData:{extensionId,extension,design:normalized,directory:out,...options}});
      const running=worker;
      running.on('message',message=>{
        if(message.stage==='complete')finish('complete',{result:message.result});
        else if(message.stage==='failed')finish('failed',{error:message.error});
        else{
          state.job={...state.job,...message};
          emit('workspace-bundles-progress',{jobId:id,directory:job.directory,stage:message.stage,piece:message.piece,completed:message.completed,total:message.total,bundles:message.bundles});
        }
      });
      running.on('error',error=>finish('failed',{error:error.message}));
      running.on('exit',code=>{
        finish('failed',{error:'Workspace construction worker exited before completing ('+code+').'});
        if(worker===running)worker=null;
      });
      emit('workspace-bundles-started',{jobId:id});return structuredClone(job);
    });
    const send=(res,value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
    const body=async req=>{
      const chunks=[];let bytes=0;
      for await(const chunk of req){bytes+=chunk.length;if(bytes>4*1024*1024)throw Error('Workspace request is too large.');chunks.push(chunk);}
      return JSON.parse(Buffer.concat(chunks).toString());
    };
    server=createServer(async(req,res)=>{
      try{
        if(closed)return send(res,{error:'Workspace is closing.'},503);
        const origin=`http://127.0.0.1:${server.address().port}`;
        if(req.headers.host!==new URL(origin).host||req.headers.origin&&req.headers.origin!==origin)return send(res,{error:'Cross-origin requests are not accepted.'},403);
        const url=new URL(req.url,origin);
        if(req.method==='GET'&&url.pathname==='/api/design')return send(res,await inspect());
        if(req.method==='GET'&&url.pathname==='/api/job')return send(res,state.job);
        if(req.method==='GET'&&url.pathname==='/api/resources')return send(res,definition.resources?await definition.resources():null);
        if(req.method==='GET'&&url.pathname==='/api/events'){
          res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive'});
          res.write(': connected\n\n');viewers.add(res);emit('workspace-viewer-opened',{viewers:viewers.size});
          const timer=setInterval(()=>res.write(': heartbeat\n\n'),15000);timer.unref();
          res.on('close',()=>{clearInterval(timer);if(viewers.delete(res))emit('workspace-viewer-closed',{viewers:viewers.size});});return;
        }
        if(req.method==='POST'&&['/api/design','/api/preview','/api/bundles'].includes(url.pathname)){
          const request=await body(req);
          if(url.pathname==='/api/preview')return send(res,await preview(request.design,{interactive:Boolean(request.interactive??true)}));
          if(url.pathname==='/api/design')return send(res,await updateDesign(request.design,{source:'ui'}));
          return send(res,await createBundles(request.design),202);
        }
        if(req.method!=='GET')return send(res,{error:'Not found'},404);
        if(url.pathname==='/_saam/workspace.mjs'){
          res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'});return res.end(await readFile(new URL('./client.mjs',import.meta.url)));
        }
        const name=relativeExtensionFile(url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1)));
        // The imported package inventory limits serving to files in its declared UI subtree.
        const content=uiFiles.get(name);
        if(content===undefined)return send(res,{error:'Not found'},404);
        res.writeHead(200,{'Content-Type':contentTypes[extname(name)]??'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
        if(name==='index.html'){
          const html=content.toString(),bridge='<script type="module" src="/_saam/workspace.mjs"></script>';
          return res.end(/<\/head\s*>/i.test(html)?html.replace(/<\/head\s*>/i,closing=>bridge+closing):html+bridge);
        }
        return res.end(content);
      }catch(error){send(res,{error:error.message},error.code==='ENOENT'?404:400);}
    });
    // Read only selected extension UI files once. Import never evaluates this code.
    const {readExtension}=await import('../core/extensions/library.mjs');
    const uiFiles=new Map((await readExtension(extensionId,options)).files
      .filter(file=>file.path.startsWith(selected.manifest.workspace.ui+'/'))
      .map(file=>[file.path.slice(selected.manifest.workspace.ui.length+1),file.bytes]));
    await requireWorkspaceCurrent(extension,options);
    await new Promise((done,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',done);});
    const shutdown=()=>stopping??=(async()=>{
      closed=true;await queue;
      for(const res of viewers)res.end();
      if(worker){await worker.terminate();worker=null;}
      await lock.close();await rm(lockPath,{force:true});emit('workspace-closed');
      if(server.listening){const ended=new Promise(done=>server.close(done));server.closeAllConnections();await ended;}
    })();
    server.viewerCount=()=>viewers.size;
    server.once('close',()=>void shutdown());
    const url=`http://127.0.0.1:${server.address().port}`;
    emit('workspace-opened');
    return {server,url,directory,extension,inspect,preview,updateDesign,createBundles,shutdown};
  }catch(error){
    closed=true;server?.close();await lock.close();await rm(lockPath,{force:true});throw error;
  }
}
