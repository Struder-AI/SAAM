#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readyInstance,controlRequest} from '../core/application/control.mjs';
import {selectRuntime} from '../core/application/runtime-selection.mjs';

const camel=name=>name.replace(/-([a-z])/g,(_match,letter)=>letter.toUpperCase());
function flagValue(value,schema={}){
  const types=[schema.type,...(schema.anyOf??[]).map(item=>item.type)];
  if(types.includes('boolean')){
    if(value===true||value==='true')return true;if(value===false||value==='false')return false;
    throw Error('Boolean flags accept true or false.');
  }
  if(types.includes('number')||types.includes('integer')){const number=Number(value);if(!Number.isFinite(number))throw Error('Numeric flags need a finite number.');return number;}
  if(types.includes('null')&&value==='null')return null;
  if(value===true)throw Error('Supply a value for this flag. Use --input for arrays and objects.');
  return String(value);
}
function enabled(value){return value===true||value==='true';}
export function commandInput(args,environment=process.env){
  const parsed={command:args[0]??'help',operation:null,flags:{},options:{},index:1};
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
export async function runSaam(args=process.argv.slice(2),{input=process.stdin,write=value=>console.log(JSON.stringify(value))}={}){
  const parsed=commandInput(args);
  const identity=!['help','status','diagnostics','open','update','quit'].includes(parsed.command)
    ?{chatId:parsed.chatId,...(parsed.fallbackChatId?{nextCommand:'Pass --chat-id '+parsed.chatId+' on every later saam command in this chat.'}:{})}:{};
  try{
    const fields={};
    if(parsed.options.input&&enabled(parsed.options.stdin))throw Error('Choose --input FILE or --stdin.');
    if(parsed.options.input===true)throw Error('Supply the input filename.');
    if(parsed.options.input)Object.assign(fields,JSON.parse(await readFile(resolve(String(parsed.options.input)),'utf8')));
    if(enabled(parsed.options.stdin)){const chunks=[];for await(const chunk of input)chunks.push(Buffer.from(chunk));Object.assign(fields,JSON.parse(Buffer.concat(chunks).toString('utf8')));}
    const instance=await readyInstance();
    if(instance.contract!==1)throw Error('Update the installed SAAM first: this checkout requires orchestrator contract 1.');
    const runtime=await selectRuntime();
    const operation=parsed.command==='call'?parsed.operation:parsed.command==='wait'?'wait_for_studio_request':parsed.command==='start-tour'?'start_tour':null;
    if(operation){
      const help=await controlRequest(instance,{command:'help',operation,runtime});
      const properties=help.operations[0].input.properties??{};
      for(const [key,value] of Object.entries(parsed.flags))fields[key]=flagValue(value,properties[key]);
      if(parsed.command==='call'&&properties.bundleId&&parsed.options.bundleId!==undefined)fields.bundleId??=String(parsed.options.bundleId);
    }else for(const [key,value] of Object.entries(parsed.flags))fields[key]=value;
    const message={runtime,command:parsed.command,operation:parsed.operation,args:fields,chatId:parsed.chatId,client:parsed.client,
      chatName:parsed.options.chatName,bundleId:parsed.options.bundleId??fields.bundleId,force:enabled(parsed.options.force)};
    const result=await controlRequest(instance,message,{waitMs:['call','start-tour','wait'].includes(parsed.command)?null:35000});
    write({...result,...identity});return result;
  }catch(error){error.result={...error.result,...identity};throw error;}

}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  runSaam().catch(error=>{console.error(JSON.stringify({ok:false,...error.result,error:error.message}));process.exitCode=1;});
}
