import {home} from './temporary-home.mjs';
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
  const server=createStudio('missing-synthetic-lifetime-bundle',{libraryRoot:home,...options});
  t.after(()=>server.shutdown());
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const url=`http://127.0.0.1:${server.address().port}`;
  const html=await(await fetch(url)).text();
  const token=html.match(/name="saam-token" content="([^"]+)"/)[1];
  const viewers=new Set();
  async function connect(){
    const controller=new AbortController();t.after(()=>controller.abort());
    const response=await fetch(url+'/api/viewer?token='+token,{signal:controller.signal});
    assert.equal(response.status,200);
    viewers.add(response);
    return ()=>{viewers.delete(response);controller.abort();};
  }
  return {server,url,token,connect};
}

test('Studio waits indefinitely before the first browser requests a page',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const server=createStudio('missing-synthetic-lifetime-bundle',{libraryRoot:home});
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

test('owner shutdown closes live viewer connections and is idempotent',async t=>{
  const {server,connect}=await fixture(t);await connect();
  await server.shutdown();await server.shutdown();assert.equal(server.listening,false);
});

test('shutdown releases speculative sockets that never sent an HTTP request',async t=>{
  const {server}=await fixture(t);
  const socket=net.connect(server.address().port,'127.0.0.1');t.after(()=>socket.destroy());
  await once(socket,'connect');
  const closed=once(socket,'close');
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
  const events={},streams=[],dispatched=[];
  const source=await readFile(new URL('../../studio/viewer-session.mjs',import.meta.url),'utf8');
  runInNewContext(source.replace('export const viewerConnected','const viewerConnected'),{
    document:{querySelector:()=>({content:'test-token'})},
    EventSource:class{constructor(url){this.url=url;this.events={};streams.push(this);}addEventListener(name,handler){this.events[name]=handler;}close(){this.closed=true;}},
    CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},
    dispatchEvent:event=>dispatched.push(event),
    addEventListener:(name,handler)=>{events[name]=handler;}
  });
  assert.equal(streams.length,1);assert.equal(streams[0].url,'/api/viewer?token=test-token');
  // Every open establishes connected delivery and triggers one recovery check.
  streams[0].events.open();assert.equal(dispatched.length,1);
  streams[0].events.error();streams[0].events.open();
  assert.deepEqual(dispatched.map(event=>[event.type,event.detail.open]),
    [['saam-viewer-connection',true],['saam-viewer-connection',false],['saam-viewer-connection',true]]);
  events.pagehide();assert.equal(streams[0].closed,true);
  events.pageshow({persisted:true});assert.equal(streams.length,2);
  streams[1].events.open();assert.equal(dispatched.at(-1).detail.open,true,'a restored page checks what it missed');
});
