#!/usr/bin/env node
// MCP registration of the local runtime's operations, served over stdio here
// and over any other MCP transport a caller connects.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { resolve, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createLocalRuntime, instructions } from './runtime.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
// The SAAM panel: an MCP App a chat client that supports them shows with
// maker_onboarding's result. It hears this session's status from the relay and
// posts Studio requests into the chat, so the chat needs no listener.
const PANEL_URI='ui://saam/panel',PANEL_TOOL='maker_onboarding',PANEL_MIME='text/html;profile=mcp-app';
const PANEL_HTML=readFileSync(resolve(dirname(fileURLToPath(import.meta.url)),'panel.html'),'utf8');
// The origins the panel may connect to: the relay, over HTTPS and WebSocket.
function panelOrigins(relayUrl){
  const origin=new URL(relayUrl).origin,socket=new URL(origin);socket.protocol=socket.protocol==='https:'?'wss:':'ws:';
  return [origin,socket.origin];
}

// One MCP connection is one SAAM session. Given a runtime, closing the
// connection ends only its session; otherwise the adapter owns the runtime.
// `guidance` adds instructions for how this session's client reaches SAAM.
// `panel`, {relayUrl, key}, shows the SAAM panel; key admits it to this session.
export function createMcpAdapter({ runtime: shared, listen, remote, guidance, panel, ...options } = {}) {
  const runtime = shared ?? createLocalRuntime(options), session = runtime.beginSession({ listen, remote, guidance });
  const server = new McpServer({ name: 'saam', version: '0.2.0' }, { capabilities:{logging:{}}, instructions: guidance ? guidance + ' ' + instructions : instructions });
  if(panel)server.registerResource('saam-panel',PANEL_URI,{title:'SAAM',mimeType:PANEL_MIME,
    _meta:{ui:{csp:{connectDomains:panelOrigins(panel.relayUrl)},prefersBorder:true}}},
    async()=>({contents:[{uri:PANEL_URI,mimeType:PANEL_MIME,text:PANEL_HTML}]}));
  for (const {name,description,schema,readOnly,openWorld} of session.operations){
    const showsPanel=panel&&name===PANEL_TOOL;
    server.registerTool(name, { description, inputSchema: schema,
      annotations: { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: openWorld },
      ...(showsPanel?{_meta:{ui:{resourceUri:PANEL_URI}}}:{}) }, async args => {
      try {
        const result = await session.invoke(name,args), reminder = session.onboardingReminder();
        return {content:[{type:'text',text:JSON.stringify(result)},...(reminder?[{type:'text',text:reminder}]:[])],
          ...(showsPanel?{_meta:{'saam/panel':{relay:panel.relayUrl,key:panel.key}}}:{})};
      }
      catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
    });
  }
  const connection={closing:null,notifying:false,notified:new Set()};
  async function notifyRequests(){
    if(connection.closing||connection.notifying)return;connection.notifying=true;
    try{for(const request of await runtime.queuedRequests())if(!connection.notified.has(request.id)){
      await server.server.sendLoggingMessage({level:'info',logger:'saam.studio',data:{type:'studio-request',request}});connection.notified.add(request.id);
    }}catch{/* Persisted requests and the independent wait endpoint remain authoritative. */}finally{connection.notifying=false;}
  }
  const stopRequestWatch=runtime.subscribeRequests(()=>{void notifyRequests();});
  const stopEventWatch=runtime.subscribeEvents(events=>{
    if(connection.closing)return;
    try{void server.server.sendLoggingMessage({level:'info',logger:'saam.studio',data:{type:'studio-events',events}}).catch(()=>{});}
    catch{/* Tool results and get_studio_events still carry the queue. */}
  });
  server.server.oninitialized=()=>{void notifyRequests();};
  function close(){return connection.closing??=Promise.resolve().then(async()=>{
    stopRequestWatch();stopEventWatch();
    await session.end();
    if(!shared)await runtime.close();
    await server.close();
  });}
  server.server.onclose=()=>{void close().catch(error=>console.error('SAAM connection cleanup:',error));};
  return {server,close,setPanel:session.setPanel};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const adapter = createMcpAdapter({ printsRoot: process.env.SAAM_PRINTS_ROOT ?? resolve(root, 'Prints') });
  const transport = new StdioServerTransport();
  await adapter.server.connect(transport);
  let closing = false;
  async function close() { if (closing) return; closing = true; await adapter.close(); }
  process.stdin.on('end', close);
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
}
