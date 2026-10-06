#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readInstance,runningInstance,readyInstance,controlRequest} from '../core/application/control.mjs';
import {selectRuntime,contractProblem} from '../core/application/runtime-selection.mjs';
import {homePaths} from '../core/application/home.mjs';

// help answers from this code alone; status, quit and stop-runtime reach a running SAAM
// only; the other commands start SAAM when none runs.
const startsSaam=new Set(['open','call','wait','start-tour','reload-runtime','update','diagnostics']),runningOnly=new Set(['status','quit','stop-runtime']);
const camel=name=>name.replace(/-([a-z])/g,(_match,letter)=>letter.toUpperCase());
function enabled(value){return value===true||value==='true';}
export function commandInput(args,environment=process.env){
  const parsed={command:['--help','-h'].includes(args[0])?'help':args[0]??'help',operation:null,flags:{},options:{},index:1};
  if(parsed.command==='call'||parsed.command==='help'){
    if(args[parsed.index]&&!args[parsed.index].startsWith('--'))parsed.operation=args[parsed.index++];
  }
  for(;parsed.index<args.length;parsed.index++){
    const argument=args[parsed.index];
    if(!argument.startsWith('--'))throw Error(`Unexpected argument ${argument}. Use saam help.`);
    const equal=argument.indexOf('='),name=argument.slice(2,equal<0?undefined:equal);
    const next=args[parsed.index+1];
    const value=equal>=0?argument.slice(equal+1):next&&!next.startsWith('--')?args[++parsed.index]:true;
    if(['input','stdin','chat-id','chat-name','bundle-id','force'].includes(name))parsed.options[camel(name)]=value;
    else parsed.flags[camel(name)]=value;
  }
  const chatId=parsed.options.chatId??environment.CLAUDE_CODE_SESSION_ID??environment.CODEX_SESSION_ID;
  return {...parsed,chatId:chatId??randomUUID(),fallbackChatId:!chatId,
    client:environment.CLAUDE_CODE_SESSION_ID?'claude':environment.CODEX_SESSION_ID?'codex':null};
}
// Client hooks (client setup registers them) report events as JSON on stdin. The agent is
// with the person after a turn ends, the person writes or interrupts, or the chat closes;
// a subagent's events (agent_id) and other notifications mean nothing here.
const counterReasons={Stop:'turn',StopFailure:'turn',Interrupt:'interrupt',UserPromptSubmit:'message',SessionEnd:'closed'};
function counterReason(event){
  if(event.agent_id)return null;
  if(event.hook_event_name==='Notification')return event.notification_type==='idle_prompt'?'turn':null;
  return counterReasons[event.hook_event_name]??null;
}
// Reaches only a running SAAM and prints nothing, because the client reads hook output.
async function clientEvent(input){
  const chunks=[];if(!input.isTTY)for await(const chunk of input)chunks.push(Buffer.from(chunk));
  const text=Buffer.concat(chunks).toString('utf8').trim(),event=text?JSON.parse(text):{},reason=counterReason(event);
  const instance=reason&&event.session_id?await readInstance():null;
  if(!instance)return;
  try{await controlRequest(instance,{command:'end-turn',chatId:event.session_id,reason});}
  catch(error){if(error.result)throw error;/* No SAAM answers at its record: nothing is attached. */}
}
// Help describes the operations of the code this command runs, which a runtime started
// from it would offer, without starting an orchestrator, runtime or window.
async function help(runtime,operationName){
  const [{createLocalRuntime,instructions},{z}]=await Promise.all([import('../core/application/runtime.mjs'),import('zod')]);
  const paths=homePaths(),local=createLocalRuntime({paths,stateRoot:resolve(paths.state,'runtimes',runtime.id.replace(':','-')),autoOpen:false});
  try{
    const operation=operationName?local.operations.find(value=>value.name===operationName):null;
    if(operationName&&!operation)throw Error('Unknown SAAM operation '+operationName+'.');
    return {ok:true,instructions,commands:['open','help [OP]','call OP --input FILE|--stdin|--flags','wait','start-tour','status','reload-runtime','stop-runtime','update','quit'],
      operations:(operation?[operation]:local.operations).map(value=>({name:value.name,description:value.description,readOnly:value.readOnly,
        ...(operation?{input:z.toJSONSchema(value.schema,{target:'draft-7',io:'input'})}:{})})),
      runtime:{id:runtime.id,label:runtime.label}};
  }finally{await local.close();}
}
export async function runSaam(args=process.argv.slice(2),{input=process.stdin,write=value=>console.log(JSON.stringify(value))}={}){
  const parsed=commandInput(args);
  if(parsed.command==='client-event')return clientEvent(input);
  const identity=!['help','status','diagnostics','open','update','quit'].includes(parsed.command)
    ?{chatId:parsed.chatId,...(parsed.fallbackChatId?{nextCommand:'Pass --chat-id '+parsed.chatId+' on every later saam command in this chat.'}:{})}:{};
  const selection={runtime:null};
  try{
    if(parsed.command!=='help'&&!startsSaam.has(parsed.command)&&!runningOnly.has(parsed.command))throw Error('Unknown command '+parsed.command+'. Use saam help.');
    const runtime=selection.runtime=await selectRuntime();
    if(parsed.command==='help'){const result=await help(runtime,parsed.operation);write(result);return result;}
    const fields={};
    if(parsed.options.input&&enabled(parsed.options.stdin))throw Error('Choose --input FILE or --stdin.');
    if(parsed.options.input===true)throw Error('Supply the input filename.');
    if(parsed.options.input)Object.assign(fields,JSON.parse(await readFile(resolve(String(parsed.options.input)),'utf8')));
    if(enabled(parsed.options.stdin)){const chunks=[];for await(const chunk of input)chunks.push(Buffer.from(chunk));Object.assign(fields,JSON.parse(Buffer.concat(chunks).toString('utf8')));}
    const instance=runningOnly.has(parsed.command)?await runningInstance():await readyInstance();
    if(!instance){const result={ok:true,running:false,home:homePaths().home,runtime:{id:runtime.id,label:runtime.label}};write({...result,...identity});return result;}
    const problem=contractProblem({contract:instance.contract,label:'the running SAAM ('+instance.version+')'},runtime);
    if(problem)throw problem;
    // An operation's runtime types its named flags from the operation's schema (runtime-host.mjs).
    const operation=['call','wait','start-tour'].includes(parsed.command);
    if(!operation)Object.assign(fields,parsed.flags);
    const message={runtime,command:parsed.command,operation:parsed.operation,args:fields,...(operation&&{flags:parsed.flags}),chatId:parsed.chatId,client:parsed.client,
      chatName:parsed.options.chatName,bundleId:parsed.options.bundleId??fields.bundleId,force:enabled(parsed.options.force)};
    const result=await controlRequest(instance,message,['call','start-tour','wait','update'].includes(parsed.command)?{}:{waitMs:35000});
    write({...result,...identity});return result;
  }catch(error){error.result={...(selection.runtime&&{runtime:{id:selection.runtime.id,label:selection.runtime.label}}),...(error.code&&{code:error.code}),...error.result,...identity};throw error;}

}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  runSaam().catch(error=>{console.error(JSON.stringify({ok:false,...error.result,error:error.message}));process.exitCode=1;});
}
