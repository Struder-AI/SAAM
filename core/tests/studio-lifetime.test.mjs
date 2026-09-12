import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import http from 'node:http';
import net from 'node:net';
import {createStudio} from '../../studio/server.mjs';
import {viewerLifetime} from '../../studio/lifetime.mjs';

// No geometry creation, interpretation or slicing: only sockets and timers.
async function fixture(t,options={}){
  const server=createStudio('missing-synthetic-lifetime-bundle',{disconnectMs:60,...options});
  t.after(()=>server.shutdown());
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const url=`http://127.0.0.1:${server.address().port}`;
  const html=await(await fetch(url)).text();
  const token=html.match(/name="saam-token" content="([^"]+)"/)[1];
  async function connect(){
    // EventSource uses a dedicated long-lived request. Avoid undici reusing a
    // just-cancelled stream socket for the simulated refresh on newer Node.
    const response=await fetch(url+'/api/viewer?token='+token,{headers:{Connection:'close'}});
    assert.equal(response.status,200);
    const close=()=>response.body.cancel();t.after(close);
    return close;
  }
  return {server,url,token,connect};
}

test('Studio waits indefinitely before the first browser requests a page',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const server=createStudio('missing-synthetic-lifetime-bundle');
  t.after(()=>server.shutdown());
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.mock.timers.tick(24*60*60*1000);
  assert.equal(server.listening,true);
});

test('ordinary requests and rejected viewer connections leave Studio ready for a late viewer',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const {server,url,connect}=await fixture(t);
  assert.equal((await fetch(url+'/api/viewer?token=wrong')).status,403);
  t.mock.timers.tick(24*60*60*1000);await(await fetch(url)).text();
  assert.equal(server.listening,true);
  await connect();assert.equal(server.listening,true);
});

test('last viewer closes only its instance; live background viewers need no polling',async t=>{
  const a=await fixture(t),b=await fixture(t);
  const closeA1=await a.connect(),closeA2=await a.connect(),closeB=await b.connect();
  await delay(180);
  assert.ok(a.server.listening&&b.server.listening,'background viewers keep both instances alive');
  await closeA1();await delay(100);assert.ok(a.server.listening,'second tab still owns instance');
  const closed=once(a.server,'close');await closeA2();await closed;
  assert.ok(b.server.listening,'another agent instance stays alive');
  await closeB();
});

test('refresh reconnects during grace without replacing the server',async t=>{
  // Keep the assertion comfortably outside scheduler jitter from the rest of
  // the parallel suite; this is a lifecycle test, not a 150 ms benchmark.
  const {server,connect}=await fixture(t,{disconnectMs:1_000});
  const closeFirst=await connect();await closeFirst();
  await delay(20);const closeNext=await connect();
  await delay(1_100);assert.ok(server.listening);
  const closed=once(server,'close');await closeNext();await closed;
});

test('owner shutdown closes live viewer connections and is idempotent',async t=>{
  const {server,connect}=await fixture(t);await connect();
  await server.shutdown();await server.shutdown();assert.equal(server.listening,false);
});

test('shutdown releases speculative sockets that never sent an HTTP request',async t=>{
  const {server}=await fixture(t);
  const socket=net.connect(server.address().port,'127.0.0.1');t.after(()=>socket.destroy());
  await once(socket,'connect');
  const closed=new Promise(resolve=>socket.once('close',resolve));
  socket.on('error',error=>assert.equal(error.code,'ECONNRESET'));
  await server.shutdown();await closed;assert.equal(socket.destroyed,true);
});

test('shutdown drains accepted work before completing',async t=>{
  let finish;
  const server=http.createServer((_req,res)=>{finish=()=>res.end('saved');});
  const lifetime=viewerLifetime(server);t.after(()=>lifetime.shutdown());
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const accepted=once(server,'request');
  const response=fetch(`http://127.0.0.1:${server.address().port}`);await accepted;
  let stopped=false;const stopping=lifetime.shutdown().then(()=>{stopped=true;});
  await delay(20);assert.equal(stopped,false);
  finish();assert.equal(await(await response).text(),'saved');await stopping;
});

test('page lifecycle opens independently, closes on pagehide and reconnects on history restore',async()=>{
  const events={},streams=[];
  const source=await readFile(new URL('../../studio/viewer-session.mjs',import.meta.url),'utf8');
  runInNewContext(source,{
    document:{querySelector:()=>({content:'test-token'})},
    EventSource:class{constructor(url){this.url=url;streams.push(this);}close(){this.closed=true;}},
    addEventListener:(name,handler)=>{events[name]=handler;}
  });
  assert.equal(streams.length,1);assert.equal(streams[0].url,'/api/viewer?token=test-token');
  events.pagehide();assert.equal(streams[0].closed,true);
  events.pageshow({persisted:true});assert.equal(streams.length,2);
});
