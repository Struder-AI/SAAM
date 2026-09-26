#!/usr/bin/env node
// MCP registration of the local runtime's operations, served over stdio here
// and over any other MCP transport a caller connects.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalRuntime, instructions } from './runtime.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

// One MCP connection is one SAAM session. Given a runtime, closing the
// connection ends only its session; otherwise the adapter owns the runtime.
export function createMcpAdapter({ runtime: shared, ...options } = {}) {
  const runtime = shared ?? createLocalRuntime(options), session = runtime.beginSession();
  const server = new McpServer({ name: 'saam', version: '0.2.0' }, { capabilities:{logging:{}}, instructions });
  for (const {name,description,schema,readOnly,openWorld} of runtime.operations)
    server.registerTool(name, { description, inputSchema: schema,
      annotations: { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: openWorld } }, async args => {
      try { return {content:[{type:'text',text:JSON.stringify(await session.invoke(name,args))}]}; }
      catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
    });
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
  return {server,close};
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
