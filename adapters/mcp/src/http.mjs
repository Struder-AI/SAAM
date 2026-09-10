// Transport bridge only: all tools execute on the existing local MCP adapter.
import express from 'express';
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createMcpAdapter } from './server.mjs';
import { createDevOAuth, page } from './dev-oauth.mjs';

export async function createHttpBridge({ publicUrl, printsRoot, autoOpen = true, pairingCode, now } = {}) {
  const url = new URL(publicUrl);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1')))
    throw new Error('Use a public HTTPS origin, or HTTP 127.0.0.1 for local tests.');
  const auth = createDevOAuth({ publicUrl, pairingCode, now });
  const adapter = createMcpAdapter({ printsRoot, autoOpen });
  const upstream = new Client({ name: 'saam-http-bridge', version: '0.1.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await adapter.server.connect(serverTransport);
  await upstream.connect(clientTransport);
  const active = new Set();
  const app = express();
  app.disable('x-powered-by');
  // The local tunnel process is the only ingress. Never trust forwarded headers
  // to choose the issuer, build URLs, bypass Host checks, or identify an operator.
  app.use((req, res, next) => {
    // no-referrer makes native form POSTs send Origin: null. Keep the origin
    // on our pairing form while withholding referrers from external callbacks.
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'same-origin',
      'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" });
    if (![url.host, `127.0.0.1:${req.socket.localPort}`].includes(req.headers.host)) return res.status(403).send('Invalid host.');
    if (req.headers.origin && req.headers.origin !== url.origin) return res.status(403).send('Invalid origin.');
    delete req.headers['x-forwarded-for']; delete req.headers.forwarded;
    next();
  });
  app.use(express.json({ limit: '4mb' }));
  app.use(express.urlencoded({ extended: false, limit: '16kb' }));
  app.post('/connect', auth.connect);
  app.use(mcpAuthRouter({ provider: auth.provider, issuerUrl: url, resourceServerUrl: new URL(auth.resource),
    scopesSupported: ['saam'], resourceName: 'SAAM local development' }));
  app.get('/.well-known/oauth-protected-resource', (_req, res) => res.json({ resource: auth.resource,
    authorization_servers: [url.origin + '/'], scopes_supported: ['saam'], resource_name: 'SAAM local development' }));
  app.get('/', (_req, res) => res.type('html').send(page('SAAM web-chat connection',
    '<p>This endpoint connects a chat client to local SAAM. Add its <code>/mcp</code> URL in your client and authenticate with the pairing code shown on the SAAM computer.</p><p>Studio and job approvals remain local.</p>')));
  app.get('/health', (_req, res) => res.json({ service: 'saam-mcp-bridge', status: 'ready' }));
  app.all('/mcp', requireBearerAuth({ verifier: auth.provider, requiredScopes: ['saam'],
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(new URL(auth.resource)) }), async (req, res) => {
    // Quick tunnels cannot carry SSE. Stateless JSON responses work with
    // Streamable HTTP and avoid coupling a Studio lifetime to an HTTP session.
    if (req.method !== 'POST') return res.status(405).set('Allow', 'POST').end();
    if (active.size >= 16) return res.status(503).set('Retry-After', '2').json({ error: 'Bridge busy. Retry later.' });
    const server = new Server(upstream.getServerVersion(), { capabilities: { tools: {} }, instructions: upstream.getInstructions() });
    server.setRequestHandler(ListToolsRequestSchema, request => upstream.listTools(request.params));
    // The existing adapter serializes mutations across every connected client.
    // Do not retry a write automatically when an HTTP connection disappears.
    server.setRequestHandler(CallToolRequestSchema, request => upstream.callTool(request.params, undefined, { timeout: 30 * 60 * 1000 }));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    active.add(server);
    const close = () => { active.delete(server); void server.close(); };
    res.once('close', close);
    try { await server.connect(transport); await transport.handleRequest(req, res, req.body); }
    catch { if (!res.headersSent) res.status(500).json({ error: 'MCP request failed. Reconnect and read the current print state before retrying changes.' }); }
  });
  app.use((_req, res) => res.status(404).send('Not found.'));
  app.use((error, _req, res, _next) => {
    if (!res.headersSent) res.status(error.status === 413 ? 413 : 400).json({ error: 'Invalid request.' });
  });
  const http = createServer(app);
  http.requestTimeout = 60_000;
  return { http, pairingCode: auth.pairingCode, mcpUrl: auth.resource, async close() {
    http.close(); http.closeAllConnections();
    await Promise.all([...active].map(server => server.close()));
    await adapter.close(); await upstream.close();
  } };
}
