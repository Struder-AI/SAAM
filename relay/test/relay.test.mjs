// The Worker under `wrangler dev`, a real local runtime connected as a device,
// and an SDK MCP client over Streamable HTTP with a token from the OAuth flow.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createServer} from 'node:net';
import {createHash,randomBytes} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {createLocalRuntime} from '../../adapters/mcp/src/runtime.mjs';
import {loadDevice,linkCode,unpair,connectRelay} from '../../adapters/mcp/src/relay-device.mjs';

const relayRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const freePort=()=>new Promise(done=>{const server=createServer().listen(0,'127.0.0.1',()=>{const {port}=server.address();server.close(()=>done(port));});});
const until=async(check,label,ms=60_000)=>{const end=Date.now()+ms;for(;;){if(await check().catch(()=>false))return;if(Date.now()>end)throw Error('Timed out: '+label);await new Promise(r=>setTimeout(r,200));}};

async function startRelay(t){
  const port=await freePort(),base=`http://127.0.0.1:${port}`,state=await mkdtemp(resolve(tmpdir(),'saam-relay-state-'));
  const child=spawn(process.execPath,[resolve(relayRoot,'node_modules/wrangler/bin/wrangler.js'),'dev','--port',String(port),'--ip','127.0.0.1','--persist-to',state,'--var',`PUBLIC_URL:${base}`,'--var','MAX_PAIRED_DEVICES:2'],
    {cwd:relayRoot,env:{...process.env,WRANGLER_SEND_METRICS:'false',CI:'1'},stdio:['ignore','pipe','pipe']});
  let log='';child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);
  t.after(async()=>{
    if(process.platform==='win32')try{execFileSync('taskkill',['/pid',String(child.pid),'/T','/F'],{stdio:'ignore'});}catch{/* already exited */}
    else child.kill();
    await rm(state,{recursive:true,force:true}).catch(()=>{});
  });
  await until(async()=>(await fetch(base+'/')).ok,'wrangler dev\n'+log,90_000);
  return base;
}

async function authorize(base,code){
  const redirectUri='http://127.0.0.1:9/callback';
  const client=await(await fetch(base+'/oauth/register',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({client_name:'SAAM relay test',redirect_uris:[redirectUri],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']})})).json();
  const verifier=randomBytes(32).toString('base64url'),challenge=createHash('sha256').update(verifier).digest('base64url');
  const url=base+'/authorize?'+new URLSearchParams({response_type:'code',client_id:client.client_id,redirect_uri:redirectUri,code_challenge:challenge,code_challenge_method:'S256',state:'test-state',scope:'saam',resource:base+'/mcp'});
  const shown=await fetch(url,{redirect:'manual'}),html=await shown.text();
  assert.equal(shown.status,200,html);assert.match(html,/SAAM relay test/);assert.match(html,/Code shown by SAAM/);
  const cookie=shown.headers.getSetCookie().map(value=>value.split(';')[0]).join('; '),handle=/name="handle" value="([^"]+)"/.exec(html)[1];
  const submit=value=>fetch(url,{method:'POST',redirect:'manual',headers:{Cookie:cookie,Origin:base,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({handle,code:value,decision:'approve'})});
  const wrong=await submit('AAAA-AAAA');
  assert.equal(wrong.status,200);assert.match(await wrong.text(),/not valid/);
  const approved=await submit(code.toLowerCase());
  assert.equal(approved.status,302,await approved.text());
  const location=new URL(approved.headers.get('Location'));
  assert.equal(location.searchParams.get('state'),'test-state');
  const tokens=await(await fetch(base+'/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'authorization_code',code:location.searchParams.get('code'),redirect_uri:redirectUri,client_id:client.client_id,code_verifier:verifier,resource:base+'/mcp'})})).json();
  assert.ok(tokens.access_token,JSON.stringify(tokens));
  return tokens.access_token;
}

test('a chat reaches the paired computer through the relay; link loss fails fast and unpairing revokes access',{timeout:240_000},async t=>{
  const base=await startRelay(t);
  const printsRoot=await mkdtemp(resolve(tmpdir(),'saam-relay-prints-')),statePath=resolve(printsRoot,'.device.json');
  t.after(()=>rm(printsRoot,{recursive:true,force:true}));

  const challenge=await fetch(base+'/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  assert.equal(challenge.status,401);assert.match(challenge.headers.get('WWW-Authenticate'),/resource_metadata=/);

  const device=await loadDevice(base,statePath);
  assert.deepEqual(await loadDevice(base,statePath),device,'the pairing is reused');
  // MAX_PAIRED_DEVICES is 2 here: a second computer pairs, a third is refused until one unpairs.
  const second=await loadDevice(base,resolve(printsRoot,'.second.json'));
  await assert.rejects(loadDevice(base,resolve(printsRoot,'.third.json')),/relay is full: 2 computers/);
  await unpair(second);
  const third=await loadDevice(base,resolve(printsRoot,'.third.json'));assert.notEqual(third.deviceId,second.deviceId);
  const runtime=createLocalRuntime({printsRoot,autoOpen:false});t.after(()=>runtime.close());
  const connection=connectRelay({device,runtime});t.after(()=>connection.close());
  await until(async()=>connection.connected(),'device connection');

  const token=await authorize(base,(await linkCode(device)).code);
  const client=new Client({name:'relay-chat',version:'1'});
  await client.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp'),{requestInit:{headers:{Authorization:`Bearer ${token}`}}}));
  t.after(()=>client.close().catch(()=>{}));
  const call=async(name,args={})=>{const result=await client.callTool({name,arguments:args});assert.ok(!result.isError,JSON.stringify(result));return JSON.parse(result.content[0].text);};

  assert.deepEqual((await client.listTools()).tools.map(tool=>tool.name).sort(),runtime.operations.map(operation=>operation.name).sort());
  const {plan}=await call('get_plan_template',{kind:'shell',machineId:'ultimaker-s5'});
  plan.process.minimumLayerSeconds=0;plan.geometry={shape:'box',runMm:12,widthMm:10,heightMm:1};plan.skills['draped-skin'].enabled=false;
  const created=await call('create_print',{printId:'relayed',kind:'shell',machineId:'ultimaker-s5',plan});
  assert.equal(created.toolpathApproved,false);
  const repeated=await client.callTool({name:'adjust_print',arguments:{printId:'relayed',expectedRevision:'stale',patch:{}}});
  assert.equal(repeated.isError,true,'a stale repeat is rejected by the revision check');

  // Link loss fails the pending call at once; the session survives the reconnect.
  const waiting=client.callTool({name:'wait_for_studio_request',arguments:{waitMs:20000}});
  await new Promise(r=>setTimeout(r,500));
  const dropped=Date.now();connection.disconnect();
  await assert.rejects(waiting,/dropped/);assert.ok(Date.now()-dropped<5000,'the relay does not wait out the call');
  await until(async()=>connection.connected(),'device reconnection');
  assert.equal((await call('get_print',{printId:'relayed'})).revision,created.revision);

  await connection.close();
  await assert.rejects(client.callTool({name:'list_machines',arguments:{}}),/not running|Session not found/);

  await unpair(device);
  const revoked=await fetch(base+'/mcp',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})});
  assert.equal(revoked.status,401,'unpairing revokes the chat grant');
});
