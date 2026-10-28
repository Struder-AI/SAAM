#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {runningInstance,readyInstance,controlRequest,controlWaitMs} from '../core/application/control.mjs';
import {selectRuntime,orchestratorContract,contractProblem} from '../core/application/runtime-selection.mjs';
import {homePaths,canonicalHome} from '../core/application/home.mjs';

// help answers from this code alone; status, quit and stop-runtime reach a running SAAM
// only; the other commands start SAAM when none runs.
const globalCommands=new Set(['status','quit','update','diagnostics']);
const startsSaam=new Set(['open','new-instance','call','wait','start-tour','reload-runtime','update','diagnostics']),runningOnly=new Set(['status','quit','stop-runtime','stop-session']);
const camel=name=>name.replace(/-([a-z])/g,(_match,letter)=>letter.toUpperCase());
function enabled(value){return value===true||value==='true';}
export function commandInput(args,environment=process.env){
  if(args.some(argument=>argument==='--data-home'||argument.startsWith('--data-home=')))throw Error('Every SAAM runtime uses the installed print library. Select code with --code-root; temporary work belongs in the installed home tmp folder.');
  // Target options may precede the command, so the reported command is reusable.
  const target={options:{},index:0};
  while(['--code-root','--background'].includes(args[target.index])){
    const name=args[target.index++].slice(2),value=args[target.index];
    if(name==='background'){target.options.background=['true','false'].includes(value)?args[target.index++]:true;continue;}
    if(!value||value.startsWith('--'))throw Error('Supply '+name+'.');
    target.options[camel(name)]=args[target.index++];
  }
  const commandArgs=args.slice(target.index);
  const parsed={command:['--help','-h'].includes(commandArgs[0])?'help':commandArgs[0]??'help',operation:null,flags:{},options:{...target.options},index:1};
  if(parsed.command==='call'||parsed.command==='help'){
    if(commandArgs[parsed.index]&&!commandArgs[parsed.index].startsWith('--'))parsed.operation=commandArgs[parsed.index++];
  }
  for(;parsed.index<commandArgs.length;parsed.index++){
    const argument=commandArgs[parsed.index];
    if(!argument.startsWith('--'))throw Error(`Unexpected argument ${argument}. Use saam help.`);
    const equal=argument.indexOf('='),name=argument.slice(2,equal<0?undefined:equal);
    const next=commandArgs[parsed.index+1];
    const value=equal>=0?argument.slice(equal+1):next&&!next.startsWith('--')?commandArgs[++parsed.index]:true;
    if(['input','stdin','chat-id','chat-name','bundle-id','force','code-root','background'].includes(name))parsed.options[camel(name)]=value;
    else parsed.flags[camel(name)]=value;
  }
  if(parsed.options.codeRoot===true)throw Error('Supply codeRoot.');
  if(parsed.options.background!==undefined&&![true,false,'true','false'].includes(parsed.options.background))throw Error('Background accepts true or false.');
  const chatId=parsed.options.chatId??environment.CLAUDE_CODE_SESSION_ID??environment.CODEX_THREAD_ID??environment.CODEX_SESSION_ID;
  return {...parsed,chatId:chatId??randomUUID(),fallbackChatId:!chatId,
    client:environment.CLAUDE_CODE_SESSION_ID?'claude':environment.CODEX_THREAD_ID||environment.CODEX_SESSION_ID?'codex':null};
}
// Help describes the operations of the code this command runs, which a runtime started
// from it would offer, without starting an orchestrator, runtime or window.
async function help(runtime,operationName){
  const selectedRequire=createRequire(resolve(runtime.codeRoot,'package.json'));
  const [{createLocalRuntime,instructions},{z}]=await Promise.all([import(pathToFileURL(resolve(runtime.codeRoot,'core/application/runtime.mjs')).href),import(pathToFileURL(selectedRequire.resolve('zod')).href)]);
  const paths=homePaths(),local=createLocalRuntime({paths,stateRoot:resolve(paths.state,'runtimes',runtime.id.replaceAll(':','-')),autoOpen:false});
  try{
    const operation=operationName?local.operations.find(value=>value.name===operationName):null;
    if(operationName&&!operation)throw Error('Unknown SAAM operation '+operationName+'.');
    return {ok:true,instructions,commands:['open','new-instance','help [OP]','call OP --input FILE|--stdin|--flags','wait','start-tour','status','reload-runtime','stop-runtime','stop-session --studio-instance-id ID','update','quit'],
      operations:(operation?[operation]:local.operations).map(value=>({name:value.name,description:value.description,readOnly:value.readOnly,
        ...(operation?{input:z.toJSONSchema(value.schema,{target:'draft-7',io:'input'})}:{})})),
      runtime:{id:runtime.id,label:runtime.label}};
  }finally{await local.close();}
}
// A write's callback, rather than its backpressure boolean, is the output boundary.
export function writeJSONLine(output,value){
  const text=JSON.stringify(value)+'\n';
  return new Promise((done,fail)=>{
    const completion={scheduled:false,error:null};
    const finish=error=>{
      completion.error??=error;
      if(completion.scheduled)return;
      completion.scheduled=true;
      // Writable emits an errored write's 'error' after its callback. Keep our
      // listener for that turn, so EPIPE rejects without an unhandled event.
      setImmediate(()=>{output.removeListener('error',finish);completion.error?fail(completion.error):done();});
    };
    output.once('error',finish);
    try{output.write(text,finish);}catch(error){finish(error);}
  });
}
export async function runSaam(args=process.argv.slice(2),{input=process.stdin,write=value=>writeJSONLine(process.stdout,value),reportFinding=value=>writeJSONLine(process.stderr,value)}={}){
  const parsed=commandInput(args);
  // Cached retired hooks may finish before the required client restart.
  if(parsed.command==='client-event'){if(!input.isTTY)for await(const chunk of input){}return;}
  const identity=!['help','status','diagnostics','open','update','quit'].includes(parsed.command)
    ?{chatId:parsed.chatId,...(parsed.fallbackChatId?{nextCommand:'Pass --chat-id '+parsed.chatId+' on every later saam command in this chat.'}:{})}:{};
  const selection={runtime:null};
  try{
    if(parsed.command!=='help'&&!startsSaam.has(parsed.command)&&!runningOnly.has(parsed.command))throw Error('Unknown command '+parsed.command+'. Use saam help.');
    const chooseRuntime=()=>selectRuntime(parsed.options.codeRoot===undefined?undefined:String(parsed.options.codeRoot));
    if(parsed.command==='help'){const runtime=selection.runtime=await chooseRuntime(),result=await help(runtime,parsed.operation);await write(result);return result;}
    const fields={};
    if(parsed.options.input&&enabled(parsed.options.stdin))throw Error('Choose --input FILE or --stdin.');
    if(parsed.options.input===true)throw Error('Supply the input filename.');
    if(parsed.options.input)Object.assign(fields,JSON.parse(await readFile(resolve(String(parsed.options.input)),'utf8')));
    if(enabled(parsed.options.stdin)){const chunks=[];for await(const chunk of input)chunks.push(Buffer.from(chunk));Object.assign(fields,JSON.parse(Buffer.concat(chunks).toString('utf8')));}
    const operation=['call','wait','start-tour'].includes(parsed.command);
    if(!operation)Object.assign(fields,parsed.flags);
    const manager=['stop-runtime','reload-runtime','stop-session'].includes(parsed.command);
    const runtime=selection.runtime=globalCommands.has(parsed.command)||manager&&(fields.runtimeId||parsed.command==='stop-session')?null:await chooseRuntime();
    const preflight=runtime&&contractProblem({contract:orchestratorContract,label:'This SAAM command'},runtime);
    if(preflight)throw preflight;
    const instance=runningOnly.has(parsed.command)?await runningInstance():await readyInstance();
    if(!instance){const result={ok:true,running:false,home:canonicalHome(),...(runtime&&{runtime:{id:runtime.id,label:runtime.label}})};await write({...result,...identity});return result;}
    const problem=contractProblem({contract:instance.contract,label:'the running SAAM ('+instance.version+')'},runtime??{contract:orchestratorContract,label:'This SAAM command'});
    if(problem)throw problem;
    const waits=parsed.command==='wait'||parsed.command==='call'&&parsed.operation==='wait_for_studio_request';
    // An operation's runtime types its named flags from the operation's schema (runtime-host.mjs).
    const message={...(runtime&&{runtime}),command:parsed.command,operation:parsed.operation,args:fields,...(manager&&{runtimeId:fields.runtimeId,studioInstanceId:fields.studioInstanceId}),...(operation&&{flags:parsed.flags}),...(waits&&{responseDelivery:'cli-output'}),chatId:parsed.chatId,client:parsed.client,
      ...(parsed.options.background===undefined?{}:{visibility:enabled(parsed.options.background)?'hidden':'visible'}),
      chatName:parsed.options.chatName,bundleId:parsed.options.bundleId??fields.bundleId,force:enabled(parsed.options.force)};
    const {studioEventDelivery,...result}=await controlRequest(instance,message,['call','start-tour','wait','update'].includes(parsed.command)?{}:{waitMs:controlWaitMs});
    await write({...result,...identity});
    if(waits&&studioEventDelivery){
      try{await controlRequest(instance,{command:'ack-response-events',runtimeId:studioEventDelivery.runtimeId,receipt:studioEventDelivery},{waitMs:controlWaitMs});}
      catch(error){
        const finding={kind:'delivery-ack-retry',delivered:true,message:'The response was written, but its Studio event acknowledgement failed. Retry only acknowledgement; do not replay the delivered work.',
          error:error.message,...(error.code??error.result?.code?{code:error.code??error.result.code}:{}),receipt:studioEventDelivery};
        // The response has crossed the output boundary; never turn this into an
        // ordinary command failure or write the delivered result a second time.
        try{await reportFinding(finding);}catch(reportError){finding.reportingError=reportError.message;}
        return {...result,deliveryFinding:finding};
      }
    }
    return result;
  }catch(error){error.result={...(selection.runtime&&{runtime:{id:selection.runtime.id,label:selection.runtime.label}}),...(error.code&&{code:error.code}),...error.result,...identity};throw error;}

}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  runSaam().then(result=>{if(result?.deliveryFinding)process.exitCode=1;},error=>{console.error(JSON.stringify({ok:false,...error.result,error:error.message}));process.exitCode=1;});
}
