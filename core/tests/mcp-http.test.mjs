import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createServer, request as httpRequest } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHttpBridge } from '../../adapters/mcp/src/http.mjs';
import { bundleFor } from '../../studio/server.mjs';

async function fixture(t) {
  const printsRoot = await mkdtemp(resolve(tmpdir(), 'saam-synthetic-http-'));
  const http = createServer((req, res) => bridge.http.emit('request', req, res));
  await new Promise(done => http.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${http.address().port}`;
  let time = Date.now();
  const bridge = await createHttpBridge({ publicUrl: origin, printsRoot, autoOpen: false, now: () => time });
  t.after(async () => { http.close(); http.closeAllConnections(); await bridge.close(); await rm(printsRoot, { recursive: true, force: true }); });
  const json = (path, body, headers = {}) => fetch(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), redirect: 'manual' });
  const form = (path, body, headers = {}) => fetch(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(body), redirect: 'manual' });
  async function register(name = 'Synthetic SDK client') {
    const response = await json('/register', { client_name: name, redirect_uris: ['https://client.example/callback'],
      token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] });
    assert.equal(response.status, 201); return response.json();
  }
  async function authorization(client, overrides = {}) {
    const verifier = randomBytes(32).toString('base64url');
    const query = new URLSearchParams({ client_id: client.client_id, response_type: 'code', redirect_uri: client.redirect_uris[0],
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', resource: origin + '/mcp', scope: 'saam', state: 'synthetic-state', ...overrides });
    const response = await fetch(origin + '/authorize?' + query, { redirect: 'manual' });
    return { response, verifier, html: await response.text() };
  }
  async function codeFor(client) {
    const { response, verifier, html } = await authorization(client);
    assert.equal(response.status, 200);
    const request = html.match(/name="request" value="([^"]+)"/)[1];
    const result = await form('/connect', { request, code: bridge.pairingCode }, { Origin: origin });
    assert.equal(result.status, 303);
    const redirect = new URL(result.headers.get('location'));
    assert.equal(redirect.searchParams.get('state'), 'synthetic-state');
    return { grant_type: 'authorization_code', client_id: client.client_id, code: redirect.searchParams.get('code'),
      code_verifier: verifier, redirect_uri: client.redirect_uris[0], resource: origin + '/mcp' };
  }
  async function connect(token) {
    const client = new Client({ name: 'synthetic-web-chat', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(origin + '/mcp'), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    t.after(() => client.close());
    return client;
  }
  return { bridge, origin, printsRoot, json, form, register, authorization, codeFor, connect, advance: ms => { time += ms; } };
}

test('web-chat bridge requires OAuth, validates origins and redirects, binds PKCE grants, rotates and revokes tokens', async t => {
  const f = await fixture(t);
  const denied = await f.json('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.equal(denied.status, 401);
  assert.match(denied.headers.get('www-authenticate'), /oauth-protected-resource\/mcp/);
  assert.equal((await f.json('/mcp', {}, { Origin: 'https://hostile.example' })).status, 403);
  const badHostStatus = await new Promise((done, reject) => {
    const req = httpRequest(f.origin + '/mcp', { method: 'POST', headers: { Host: 'hostile.example' } }, res => { res.resume(); done(res.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(badHostStatus, 403);
  assert.equal((await fetch(f.origin + '/api/approve')).status, 404);
  assert.equal((await fetch(f.origin + '/Prints/plan.json')).status, 404);
  const metadata = await (await fetch(f.origin + '/.well-known/oauth-authorization-server')).json();
  assert.equal(metadata.token_endpoint, f.origin + '/token');
  assert.deepEqual(metadata.code_challenge_methods_supported, ['S256']);
  const client = await f.register('<script>bad()</script>'), other = await f.register();
  let auth = await f.authorization(client);
  // Browser form POSTs suppress Origin under no-referrer, unlike fetch().
  assert.equal(auth.response.headers.get('referrer-policy'), 'same-origin');
  assert.match(auth.response.headers.get('content-security-policy'), /form-action 'self' https:\/\/client\.example;/);
  assert.ok(!auth.html.includes('<script>bad()'));
  assert.ok(!auth.html.includes(f.bridge.pairingCode));
  let request = auth.html.match(/name="request" value="([^"]+)"/)[1];
  assert.equal((await f.form('/connect', { request, code: 'wrong' }, { Origin: f.origin })).status, 403);
  assert.equal((await f.form('/connect', { request, code: f.bridge.pairingCode }, { Origin: 'https://hostile.example' })).status, 403);
  assert.equal((await f.form('/connect', { request, code: f.bridge.pairingCode }, { Origin: 'null' })).status, 403);
  assert.equal((await f.form('/connect', { request, code: f.bridge.pairingCode })).status, 403);
  auth = await f.authorization(client, { redirect_uri: 'https://hostile.example/callback' });
  assert.equal(auth.response.status, 400);
  auth = await f.authorization(client, { resource: 'https://hostile.example/mcp' });
  assert.match(auth.response.headers.get('location'), /error=invalid_request/);
  const grant = await f.codeFor(client);
  assert.equal((await f.form('/token', { ...grant, client_id: other.client_id })).status, 400);
  assert.equal((await f.form('/token', { ...grant, code_verifier: randomBytes(32).toString('base64url') })).status, 400);
  assert.equal((await f.form('/token', { ...grant, redirect_uri: 'https://hostile.example/callback' })).status, 400);
  assert.equal((await f.form('/token', { ...grant, resource: 'https://hostile.example/mcp' })).status, 400);
  const tokens = await (await f.form('/token', grant)).json();
  assert.ok(tokens.access_token);
  assert.equal((await f.form('/token', grant)).status, 400);
  const sdk = await f.connect(tokens.access_token);
  assert.ok((await sdk.listTools()).tools.length > 10);
  const refresh = { grant_type: 'refresh_token', client_id: client.client_id, refresh_token: tokens.refresh_token, resource: f.origin + '/mcp' };
  assert.equal((await f.form('/token', { ...refresh, client_id: other.client_id })).status, 400);
  const rotated = await (await f.form('/token', refresh)).json();
  assert.ok(rotated.access_token); assert.notEqual(rotated.refresh_token, tokens.refresh_token);
  assert.equal((await f.form('/token', refresh)).status, 400);
  assert.equal((await f.form('/revoke', { client_id: client.client_id, token: rotated.refresh_token })).status, 200);
  assert.equal((await f.json('/mcp', {}, { Authorization: `Bearer ${tokens.access_token}` })).status, 401);
  assert.equal((await f.json('/mcp', {}, { Authorization: `Bearer ${rotated.access_token}` })).status, 401);
  const expires = await (await f.form('/token', await f.codeFor(client))).json();
  f.advance(61 * 60 * 1000);
  assert.equal((await f.json('/mcp', {}, { Authorization: `Bearer ${expires.access_token}` })).status, 401);
});

test('two web-chat clients share local prints and Studio, retain approval gates and deliver the exact reviewed export', async t => {
  const f = await fixture(t);
  const clients = [];
  for (let i = 0; i < 2; i++) {
    const registered = await f.register();
    const token = await (await f.form('/token', await f.codeFor(registered))).json();
    clients.push(await f.connect(token.access_token));
  }
  async function call(client, name, args = {}, pattern) {
    const result = await client.callTool({ name, arguments: args });
    const text = result.content.filter(item => item.type === 'text').map(item => item.text).join('\n');
    if (pattern) { assert.equal(result.isError, true); assert.match(text, pattern); return; }
    assert.ok(!result.isError, text); return JSON.parse(text);
  }
  const names = (await clients[0].listTools()).tools.map(tool => tool.name);
  assert.ok(!names.some(name => /approve/.test(name)));
  assert.match(clients[0].getInstructions(), /Only the human approves/);
  const { plan } = await call(clients[0], 'get_plan_template', { kind: 'shell', machineId: 'ultimaker-s5' });
  plan.geometry = { shape: 'box', runMm: 12, widthMm: 10, heightMm: 1 };
  plan.skills['draped-skin'].enabled = false; plan.process.minimumLayerSeconds = 0;
  const printId = 'Synthetic web chat', dir = resolve(f.printsRoot, printId);
  const first = await call(clients[0], 'create_print', { printId, kind: 'shell', machineId: 'ultimaker-s5', plan });
  await call(clients[0], 'generate_print', { printId }, /Approve/);
  await call(clients[0], 'adjust_print', { printId, expectedRevision: first.revision, patch: { approvals: {} } }, /not an agent-editable/);
  const opened = await call(clients[0], 'request_review', { printId });
  assert.match(opened.url, /^http:\/\/127\.0\.0\.1:/);
  await clients[0].close();
  assert.equal((await fetch(opened.url)).status, 200);
  const changed = await call(clients[1], 'adjust_print', { printId, expectedRevision: first.revision, patch: { process: { planarSpeedMmS: 21 } } });
  assert.notEqual(changed.revision, first.revision);
  await call(clients[1], 'adjust_print', { printId, expectedRevision: first.revision, patch: { process: { planarSpeedMmS: 22 } } }, /stale/);
  const bundle = await bundleFor(dir);
  async function approve(stage) {
    const state = await bundle.loadBundle(dir);
    await bundle.approve(dir, { stage, revision: state.revision, actor: 'SYNTHETIC TEST HTTP FIXTURE — never a real approval' });
  }
  await approve('geometry'); await approve('plan');
  await call(clients[1], 'generate_print', { printId });
  await call(clients[1], 'deliver_print', { printId }, /approval/);
  await approve('toolpath');
  const delivered = await call(clients[1], 'deliver_print', { printId });
  assert.equal(createHash('sha256').update(await readFile(delivered.file)).digest('hex'), delivered.exportHash);
});
