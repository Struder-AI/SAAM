// Extensions owns workspace sessions and named operations. Runtime controls
// application lifetime and observes identified outcomes; it does not supply
// technique handlers, presentation workflows or request authority here.
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {startWorkspace} from './server.mjs';
const idSchema=z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/).refine(id=>!/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(id),'Reserved filename.');

export function createWorkspaceRegistry({appRoot,dataRoot,isClosing=()=>false}={}){
  const sessions=new Map();
  function bindChat({ownerId,directory,onEvent=()=>{}}){
    function owned(workspaceInstanceId){
      const session=sessions.get(workspaceInstanceId);
      if(!session||session.ownerId!==ownerId)throw Error('Choose a live workspace instance owned by this chat.');
      return session;
    }
    async function openWorkspace({extensionId}={}){
      if(isClosing())throw Error('The SAAM runtime is closing.');
      idSchema.parse(extensionId);
      let session=[...sessions.values()].find(workspace=>workspace.extension.id===extensionId&&workspace.server.listening);
      if(session&&session.ownerId!==ownerId)throw Error('This workspace is attached to another chat.');
      if(!session){
        const workspaceInstanceId=randomUUID(),dir=await directory(`${extensionId}-workspace`,{create:true,exclusive:false});
        session=await startWorkspace({extensionId,directory:dir,appRoot,dataRoot,onEvent:event=>onEvent(structuredClone({...event,workspaceInstanceId,extensionId}))});
        session.workspaceInstanceId=workspaceInstanceId;session.ownerId=ownerId;
        sessions.set(workspaceInstanceId,session);
        session.server.once('close',()=>{if(sessions.get(workspaceInstanceId)===session)sessions.delete(workspaceInstanceId);});
      }
      return {workspaceInstanceId:session.workspaceInstanceId,url:session.url,directory:session.directory,extension:structuredClone(session.extension)};
    }
    async function getWorkspace({workspaceInstanceId},legacyPresentation={studios:[]}){
      const workspace=owned(workspaceInstanceId),presentation=structuredClone(await legacyPresentation);
      return {workspaceInstanceId,...await workspace.inspect(),studios:presentation.studios??[],...(presentation.viewError?{viewError:presentation.viewError}:{})};
    }
    async function previewWorkspace({workspaceInstanceId,design,interactive=false}){
      return {workspaceInstanceId,...await owned(workspaceInstanceId).preview(design,{interactive})};
    }
    async function closeWorkspace({workspaceInstanceId}){
      await owned(workspaceInstanceId).shutdown();return {workspaceInstanceId,closed:true};
    }
    async function updateWorkspace({workspaceInstanceId,design}){
      return {workspaceInstanceId,...await owned(workspaceInstanceId).updateDesign(design)};
    }
    async function createWorkspaceBundles({workspaceInstanceId,design}){
      return {workspaceInstanceId,job:await owned(workspaceInstanceId).createBundles(design)};
    }
    return Object.freeze({openWorkspace,getWorkspace,previewWorkspace,closeWorkspace,updateWorkspace,createWorkspaceBundles});
  }
  return Object.freeze({bindChat,
    hasViewer:workspaceInstanceId=>Boolean(sessions.get(workspaceInstanceId)?.server.viewerCount?.()),
    jobInspections:()=>[...sessions.values()].map(session=>({workspaceInstanceId:session.workspaceInstanceId,inspect:session.inspect})),
    inspectJobs:()=>Promise.all([...sessions.values()].map(async session=>({workspaceInstanceId:session.workspaceInstanceId,...await session.inspect()}))),
    async closeAll(){await Promise.all([...sessions.values()].map(session=>session.shutdown()));sessions.clear();}
  });
}
