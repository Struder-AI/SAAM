// The service panel's host actions (activate, report, check for or install an
// update, quit), through the release service when one is attached.

export function createServiceRoute(ctx){
  // The window's records and values this part uses; ctx.NAME marks a call into another part.
  const {instanceId,relay,runtimeId,runtimeLabel,serviceInput,session,token,workIdFor}=ctx;
  // The service panel's host actions, through the release service when one is attached.
  async function serviceRoute(req,res,url,origin,send){
    if(url.pathname==='/api/service'||url.pathname.startsWith('/api/service/')){
      // The optional release service never gates local making or viewing.
      // Mutations use the same local token and origin checks as Studio edits.
      const reading=req.method==='GET'&&url.pathname==='/api/service';
      const action=req.method==='POST'?url.pathname.slice('/api/service/'.length):null;
      if(!relay||!reading&&!['activate','dismiss','check-update','update','quit','report'].includes(action)){send({error:'Not found'},404);return true;}
      if(req.headers['x-saam-token']!==token||(reading?req.headers.origin&&req.headers.origin!==origin:req.headers.origin!==origin)){send({error:'Invalid local session'},403);return true;}
      const serviceStatus=()=>relay.status({studioInstanceId:instanceId});
      if(reading){send(await serviceStatus());return true;}
      if(action==='activate'){
        const {invite}=await serviceInput(req);
        try{await relay.activate(String(invite??''));send(await serviceStatus());}catch(error){send({error:error.message},400);}
        return true;
      }
      if(action==='report'){
        // The report names the window and print it came from; the person's text is all it adds.
        const {description,stage}=await serviceInput(req);
        const context={reporter:'studio',studioInstanceId:instanceId,printId:workIdFor(session.dir),runtimeId:runtimeId??null,runtimeLabel:runtimeLabel??null,stage:['geometry','toolpath'].includes(stage)?stage:null};
        try{send(await relay.report({description:String(description??''),context}));}catch(error){send({error:error.message},400);}
        return true;
      }
      if(action==='dismiss'){try{await relay.dismissFirstRun();send(await serviceStatus());}catch(error){send({error:error.message},500);}return true;}
      if(action==='check-update'){try{await relay.checkUpdate();send(await serviceStatus());}catch(error){send({error:error.message},502);}return true;}
      if(action==='update'){try{send(await relay.update(await serviceInput(req)));}catch(error){send({error:'SAAM could not update: '+error.message},502);}return true;}
      if(action==='quit'){try{send(await relay.quit({...await serviceInput(req),studioInstanceId:instanceId}));}catch(error){send({error:error.message},400);}return true;}
      return true;
    }
    return false;
  }
  return {serviceRoute};
}
