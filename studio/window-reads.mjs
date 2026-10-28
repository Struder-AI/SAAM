// What a Studio window serves its page: the page itself, then reads of the
// shown print (state with its version tag, drawn Paath, retained inspection), its
// library, requests, tour and progress.
import {TOUR_LESSONS as L} from './tour-catalog.mjs';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {machineEntrySource} from '../core/extensions/library.mjs';
import {listPrints} from '../core/print/view-values.mjs';
import {pipeline} from 'node:stream/promises';
import {Readable} from 'node:stream';
import {completedOutputState} from '../core/print/review-state.mjs';
import {tourExample} from './tour.mjs';
import {loadStudioImportRepair} from './import-stl.mjs';
import {resolvePhaseColours} from '../core/print/phase-colours.mjs';
import {printName} from './print-name.mjs';
import {composeStudioState} from './state-response.mjs';
import {readLocalPhaseColours} from '../core/application/local-agent-notes.mjs';

export function createWindowReads(ctx){
  // The window's records and values this part uses; ctx.NAME marks a call into another part.
  const {chat,displayedResults,escapeTitle,fingerprint,here,instanceId,libraryRoot,paths,
    noPrint,playerModules,printId,relay,root,selectedValues,session,showable,
    studioTitle,token,tourHere,viewPerformance,work,workIdFor}=ctx;
  const geometryOnly=guide=>guide.active&&guide.directory===session.dir&&guide.step<L.playback;
  const viewFingerprint=(id,fingerprint,guide)=>id+fingerprint+(geometryOnly(guide)?':geometry':':program');
  const stateTag=(fingerprint,guide,failure=work.generationFailure,cancelled=work.generationCancelled,records=[],importRepair=null)=>
    'W/"'+createHash('sha256').update(JSON.stringify([instanceId,fingerprint,guide,failure,cancelled,records,importRepair])).digest('base64url')+'"';
  const matchesStateTag=(header,tag)=>typeof header==='string'&&header.split(',').some(value=>{
    const candidate=value.trim();return candidate==='*'||candidate.replace(/^W\//,'')===tag.replace(/^W\//,'');
  });
  // The page itself: its change stream, HTML, modules and the machine kinematics plug.
  async function pageRoute(req,res,url,origin,send){
    if(req.method==='GET'&&url.pathname==='/api/viewer'){
      if(url.searchParams.get('token')!==token||(req.headers.origin&&req.headers.origin!==origin)){send({error:'Invalid local session'},403);return true;}
      ctx.lifetime.attach(res);
      res.write('event: runtime-code\ndata: '+JSON.stringify({fingerprint})+'\n\n');
      return true;
    }
    if(req.method==='GET'&&url.pathname==='/') {
      const html=(await readFile(resolve(here,'index.html'),'utf8')).replace('__CSRF__',token).replace('__SERVICE__',relay?'on':'').replace('</head>', '<meta name="saam-runtime" content="'+encodeURIComponent(fingerprint??'')+'"></head>').replace('<title>SAAM Studio</title>','<title>'+escapeTitle(studioTitle)+'</title>');
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);return true;
    }
    if(req.method==='GET'&&['/work-state.mjs','/agent-ui.mjs','/chat-ui.mjs','/tour-ui.mjs','/tour-catalog.mjs','/viewer-session.mjs','/view-performance.mjs','/refresh-plan.mjs','/viewer-renderer.mjs','/studio-state.mjs','/studio-controls.mjs','/path-preview.mjs','/source-preview.mjs','/inspection-ui.mjs','/paath-queries.mjs','/paath-view.mjs','/execution-review.mjs','/path-view-quality.mjs','/service-panel.mjs','/app.mjs','/page-sync.mjs','/page-actions.mjs','/panels.mjs','/view-controls.mjs','/playback.mjs','/camera.mjs','/toolpath-view.mjs','/mesh-view.mjs','/material-view.mjs','/machine-view.mjs','/settings.mjs','/style.css'].includes(url.pathname)) {
      res.writeHead(200,{'Content-Type':url.pathname.endsWith('.css')?'text/css':'text/javascript'});res.end(await readFile(resolve(here,url.pathname.slice(1))));return true;
    }
    if(req.method==='GET'&&url.pathname==='/struder-logo.png'){
      res.writeHead(200,{'Content-Type':'image/png'});res.end(await readFile(resolve(here,'struder-logo.png')));return true;
    }
    // A machine's kinematics plug for the machine view: the default export is
    // its createKinematics, or null when its extension supplies none.
    if(req.method==='GET'&&url.pathname.startsWith('/machine-kinematics/')){
      const [name,file]=decodeURIComponent(url.pathname.slice('/machine-kinematics/'.length)).split('/'),machineId=name.replace(/\.mjs$/,'');
      const entry=await machineEntrySource(machineId,'machine-kinematics');
      res.writeHead(200,{'Content-Type':'text/javascript'});
      res.end(!entry?'export default null;\n':file===undefined?`export {${entry.exportName} as default} from './${encodeURIComponent(machineId)}/entry.mjs';\n`:entry.bytes);return true;
    }
    if(req.method==='GET'&&playerModules.has(url.pathname.slice(1))){
      res.writeHead(200,{'Content-Type':'text/javascript'});res.end(await readFile(resolve(root,url.pathname.slice(1))));return true;
    }
    return false;
  }
  // The window's reads: its chat, tour, requests, progress, library, retained inspection, drawn Paath and state.
  async function readRoute(req,res,url,send){
    if(req.method==='GET'&&url.pathname==='/api/chat'){
      send({instanceId,attachment:ctx.server.attachment()});return true;
    }
    if(req.method==='GET'&&url.pathname==='/api/tour'){send(await chat.current.tour.info());return true;}
    if(req.method==='GET'&&url.pathname==='/api/view-performance'){send({reports:viewPerformance});return true;}
    if(req.method==='GET'&&url.pathname==='/api/agent-requests'){
      send({requests:await chat.current.binding.requestsFor(session.dir,instanceId)});return true;
    }
    if(req.method==='GET'&&url.pathname==='/api/preparation'){
      send(ctx.calculationStatus());return true;
    }
    if(req.method==='GET'&&url.pathname==='/api/prints'){
      const p=await chat.current.tour.info(),prints=tourHere(p)
        ?(await Promise.all(Object.values(p.copies).map(name=>listPrints(resolve(libraryRoot,'tour',name),showable)))).flat()
        :await listPrints(libraryRoot,showable);
      send({prints});return true;
    }
    if(req.method==='GET')await work.queue;
    // State without a print is empty rather than missing, so the page's checks log nothing.
    if(req.method==='GET'&&!session.dir){
      if(url.pathname==='/api/state'){res.writeHead(204);res.end();return true;}
      const error=noPrint();send({error:error.message,code:error.code},404);return true;
    }
    const readDir=session.dir,readId=session.dir&&printId(),readReviewEpoch=session.reviewEpoch;
    const bundle=await session.opened;
    if(req.method==='GET'&&url.pathname==='/api/inspection'){
      const chosen=session.inspection;
      if(!chosen||url.searchParams.get('selectionId')!==chosen.selectionId)throw Error('The retained inspection changed.');
      const representation=url.searchParams.get('representation')??'complete';
      const observationId=url.searchParams.get('observationId')??chosen.observationId;
      if(representation==='native'||url.searchParams.get('download')==='1'&&selectedValues.openRepresentation){
        const controller=new AbortController(),cancel=()=>controller.abort(Error('Observation download closed.'));
        res.once('close',cancel);let lease;
        try{
          lease=selectedValues.openRepresentation?await selectedValues.openRepresentation(chosen,{observationId,representation,signal:controller.signal}):await selectedValues.openNative(chosen,{observationId,signal:controller.signal});
          if(session.inspection!==chosen)throw Error('The retained inspection changed.');
          const native=representation==='native'?lease.manifest.value:null;
          res.writeHead(200,{'Content-Type':lease.contentType??'application/octet-stream','Content-Length':lease.byteLength??native.byteLength,'X-SAAM-Value-Id':native?.valueId??lease.manifest.valueId,
            'Content-Disposition':`attachment; filename="${native?observationId+'.'+(native.format==='3dm'?'3dm':'native'):observationId+'-'+representation+'.json'}"`});
          await pipeline(Readable.from(lease.bytes(),{objectMode:false,highWaterMark:64*1024}),res);
        }catch(error){if(res.headersSent){res.destroy(error);return true;}if(!res.destroyed)throw error;}
        finally{res.off('close',cancel);await lease?.close();}
        return true;
      }
      const result=await selectedValues.read(chosen,{representation,observationId});
      if(session.inspection!==chosen)throw Error('The retained inspection changed.');
      if(url.searchParams.get('download')==='1')res.setHeader('Content-Disposition',`attachment; filename="${chosen.observationId}-${representation}.json"`);
      send(result);return true;
    }
    // The drawn path: a completed output's SAAMpath, else the saved SAAMpath.
    if(req.method==='GET'&&url.pathname==='/api/path'){
      const controller=new AbortController(),cancelPreview=()=>controller.abort(Error('Toolpath preview request closed.'));
      res.once('close',cancelPreview);
      try{
        const {state}=await bundle.loadBundleSnapshot(readDir,{program:true}),output=state.completedOutput;
        if(readDir!==session.dir||url.searchParams.get('printId')!==readId||url.searchParams.get('revision')!==(output?output.id:String(state.revision))
          ||url.searchParams.get('id')!==(output?output.id:state.review?.path?.id)||output&&!completedOutputState(state).available)
          throw Error('The displayed path changed. Reload before viewing.');
        if(res.destroyed)cancelPreview();
        const bytes=await bundle.readDrawnPath(state,{signal:controller.signal});
        res.writeHead(200,{'Content-Type':'application/json','Content-Length':bytes.length});res.end(bytes);return true;
      }catch(error){if(!res.destroyed)throw error;}
      finally{res.off('close',cancelPreview);}
      return true;
    }
    if(req.method==='GET'&&url.pathname==='/api/state') {
      const condition=req.headers['if-none-match'];
      const workId=workIdFor(readDir),records=await chat.current.binding.requestsFor(readDir,instanceId),guide=await chat.current.tour.info({records});
      const [{state:saved,fingerprint,presentationFingerprint},example]=await Promise.all([
        bundle.loadBundleSnapshot(readDir,{program:!session.inspection&&!geometryOnly(guide)}),tourExample(readDir)]);
      const state=bundle.presentBundle?await bundle.presentBundle(saved):saved;
      if(readDir!==session.dir)throw new Error('The print is being updated.');
      const responseFingerprint=viewFingerprint(readId,example?`${fingerprint}:tour:${example.id}`:fingerprint,guide),failure=work.generationFailure,cancelled=work.generationCancelled;
      const importRepair=await loadStudioImportRepair(readDir);
      // The person's phase colours live in this home's local preferences.
      const local=await (paths?.phaseColours?readLocalPhaseColours(paths):Promise.resolve(null)).then(colours=>({colours}),error=>({problem:'Local phase colours ignored: '+error.message}));
      const phasePalette=resolvePhaseColours(state.phaseColours,local.colours);
      if(readDir!==session.dir)throw new Error('The print is being updated.');
      if(readReviewEpoch!==session.reviewEpoch)throw Error('The review is being updated.');
      const tag=stateTag(responseFingerprint+':output-generating:'+ctx.outputGenerating()+':'+JSON.stringify(phasePalette)+':review:'+session.reviewEpoch+':pending:'+session.normalReviewPending,guide,failure,cancelled,records,importRepair);
      if(condition&&matchesStateTag(condition,tag)){res.setHeader('ETag',tag);res.writeHead(304);res.end();return true;}
      const presentation=viewFingerprint(readId,presentationFingerprint,guide),name=await printName(readDir,state.plan);
      const assembled=composeStudioState(state,{directory:readDir,printId:readId,workId,instanceId,guide,example,records,importRepair,
        printName:name,fingerprint:responseFingerprint,presentationFingerprint:presentation,
        generationFailure:failure,generationCancelled:cancelled,outputGenerating:ctx.outputGenerating(),phasePalette,phasePaletteProblem:local.problem});
      if(session.inspection)assembled.inspection=session.inspection;
      if(session.normalReviewPending)assembled.normalReviewPending=true;
      if(!session.inspection&&!session.normalReviewPending&&completedOutputState(state).exportable){
        const output=state.completedOutput,snapshot=`${readId}:${output.id}`;
        const {dir,deferRememberSetup}=state;
        for(const key of displayedResults.keys())if(key!==snapshot)displayedResults.delete(key);
        displayedResults.set(snapshot,{bundle,reservation:session.reservation,state:{dir,plan:output.plan,machineId:output.machineId,revision:output.id,completedOutput:output,
          exportName:output.exportName,outputId:output.outputId,deferRememberSetup}});
        assembled.exportSnapshot=snapshot;
      }
      res.setHeader('ETag',tag);
      send(assembled);
      return true;
    }
    return false;
  }
  return {geometryOnly,viewFingerprint,stateTag,matchesStateTag,pageRoute,readRoute};
}
