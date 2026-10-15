// Same authenticated, local-only control endpoint as saam commands. Re-read the
// instance on every delivery so a SAAM restart needs no client restart.
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
export async function control(config,message){
  const instance=JSON.parse(await readFile(join(config.home,'state','instance.json'),'utf8'));
  const response=await fetch('http://127.0.0.1:'+instance.port+'/control',{method:'POST',
    headers:{'content-type':'application/json','x-saam-control':instance.token},
    body:JSON.stringify({...message,contract:config.contract}),signal:AbortSignal.timeout(3000)});
  const result=await response.json();
  if(!response.ok||result.ok===false)throw Error(result.error??'SAAM lifecycle delivery failed.');
  return result;
}
