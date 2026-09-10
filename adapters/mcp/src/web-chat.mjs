#!/usr/bin/env node
// Start an HTTPS tunnel plus the local OAuth/MCP bridge. No Studio routes are
// forwarded. Credentials stay in the ignored local connection file and on a
// loopback-only pairing page that the tunnel never reaches.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, appendFile, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHttpBridge } from './http.mjs';
import { page, escape } from './dev-oauth.mjs';
import { openBrowser } from './server.mjs';
import { writeClaudePlugin } from '../../claude/package.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('node adapters/mcp/src/web-chat.mjs [--cloudflared PATH] [--port 4322] [--prints-root PATH] [--public-url HTTPS_ORIGIN] [--tunnel-token-file PATH]\nWithout --public-url, starts a temporary Cloudflare quick tunnel whose URL changes on every restart.\nWith --public-url and a named-tunnel token (--tunnel-token-file or SAAM_TUNNEL_TOKEN), runs that named\ntunnel instead, so the address stays the same across restarts. With --public-url alone, expects an\nalready-running reverse proxy. Credentials and logs are saved under .local/web-chat/.');
  process.exit(0);
}
const options = {};
for (let index = 0; index < args.length; index += 2) {
  if (!['--cloudflared', '--port', '--prints-root', '--public-url', '--tunnel-token-file'].includes(args[index]) || !args[index + 1])
    throw new Error('Unknown or incomplete option. Use --help.');
  options[args[index]] = args[index + 1];
}
const port = Number(options['--port'] ?? 4322);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Port must be between 1024 and 65535.');
// Read the named-tunnel token from a file or the environment, never from argv:
// process arguments are readable by other local accounts.
const tunnelToken = (options['--tunnel-token-file']
  ? await readFile(resolve(options['--tunnel-token-file']), 'utf8')
  : process.env.SAAM_TUNNEL_TOKEN ?? '').trim();
if (tunnelToken && !options['--public-url'])
  throw new Error('A named tunnel also needs --public-url: its hostname is configured in Cloudflare, not discovered here.');
const localDir = resolve(root, '.local/web-chat');
await mkdir(localDir, { recursive: true });
const infoFile = resolve(localDir, `connection-${port}.json`), logFile = resolve(localDir, `tunnel-${port}.log`);
let bridge, tunnel, pairingPage, closing = false;
// Reserve the port while obtaining the public origin; reject every request until
// OAuth is configured. No transient unauthenticated MCP endpoint is served.
const http = createServer((req, res) => {
  if (bridge) bridge.http.emit('request', req, res);
  else { res.writeHead(503); res.end('Starting SAAM connection.'); }
});
await new Promise((done, reject) => { http.once('error', reject); http.listen(port, '127.0.0.1', done); });
async function close() {
  if (closing) return;
  closing = true;
  http.close(); http.closeAllConnections();
  pairingPage?.close(); pairingPage?.closeAllConnections();
  tunnel?.kill();
  await bridge?.close();
  await writeFile(infoFile, JSON.stringify({ status: 'stopped', stoppedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
}
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());

// One spawn path for both tunnel kinds. `ready` reads the accumulated log tail
// and returns the public origin once that tunnel is actually carrying traffic.
async function startTunnel({ binary, argv, env, ready }) {
  await writeFile(logFile, '', { mode: 0o600 });
  return await new Promise((done, reject) => {
    tunnel = spawn(binary, argv, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, ...env } });
    const timeout = setTimeout(() => reject(new Error(`Tunnel did not become ready. Inspect ${logFile}.`)), 60_000);
    let tail = '';
    const output = chunk => {
      void appendFile(logFile, chunk);
      tail = (tail + chunk.toString()).slice(-8000);
      const found = ready(tail);
      if (found) { clearTimeout(timeout); done(found); }
    };
    tunnel.stdout.on('data', output); tunnel.stderr.on('data', output);
    tunnel.once('error', error => { clearTimeout(timeout); reject(error); });
    tunnel.once('exit', code => {
      clearTimeout(timeout);
      if (!closing) { reject(new Error(`Tunnel exited (${code}). Inspect ${logFile}.`)); void close(); }
    });
  });
}

// Loopback-only, on its own random port that no tunnel points at, so the code
// is copied with one click instead of being read out of the connection file.
async function startPairingPage({ mcpUrl, pairingCode }) {
  const html = page('SAAM connection code', `
  <p>Your chat client will open a SAAM authorization page. Copy this code and paste it there.</p>
  <input id="code" readonly value="${escape(pairingCode)}" aria-label="Pairing code">
  <button id="copy" type="button">Copy code</button>
  <p><small>Connection address: <code>${escape(mcpUrl)}</code></small></p>
  <p><small>This code lets a chat client use SAAM on this computer. Never paste it into a chat.
  It is shown only on this computer and changes every time SAAM restarts.</small></p>
  <script>document.getElementById('copy').addEventListener('click', async event => {
    await navigator.clipboard.writeText(document.getElementById('code').value);
    event.target.textContent = 'Copied';
  });</script>`);
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'" });
    res.end(html);
  });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}

try {
  let publicUrl = options['--public-url'];
  const binary = options['--cloudflared'] ?? process.env.SAAM_CLOUDFLARED ?? 'cloudflared';
  if (tunnelToken) {
    // Routes for a named tunnel live in Cloudflare, so the origin is the
    // configured hostname and only readiness has to be awaited here.
    await startTunnel({ binary, argv: ['tunnel', '--no-autoupdate', 'run'], env: { TUNNEL_TOKEN: tunnelToken },
      ready: tail => /Registered tunnel connection/i.test(tail) ? publicUrl : null });
  } else if (!publicUrl) {
    publicUrl = await startTunnel({ binary, argv: ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate', '--protocol', 'http2'],
      ready: tail => tail.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0] ?? null });
  }
  if (closing) throw new Error('Tunnel closed during startup.');
  bridge = await createHttpBridge({ publicUrl, printsRoot: resolve(options['--prints-root'] ?? process.env.SAAM_PRINTS_ROOT ?? resolve(root, 'Prints')),
    autoOpen: process.env.SAAM_NO_AUTO_OPEN !== '1' });
  // The plugin package needs a public HTTPS address. A loopback origin is a
  // local test of the bridge itself, so package nothing rather than aborting.
  const claudePlugin = bridge.mcpUrl.startsWith('https://')
    ? await writeClaudePlugin({ mcpUrl: bridge.mcpUrl, output: resolve(localDir, `saam-claude-${port}.zip`) })
    : null;
  const pairing = await startPairingPage({ mcpUrl: bridge.mcpUrl, pairingCode: bridge.pairingCode });
  pairingPage = pairing.server;
  await writeFile(infoFile, JSON.stringify({ status: 'running', mcpUrl: bridge.mcpUrl, pairingCode: bridge.pairingCode,
    pairingPageUrl: pairing.url, tunnel: tunnelToken ? 'named' : publicUrl === options['--public-url'] ? 'external-proxy' : 'quick',
    claudePlugin,
    pid: process.pid, tunnelPid: tunnel?.pid, startedAt: new Date().toISOString(),
    instructions: 'Add mcpUrl as a custom MCP connection in ChatGPT or Claude. Choose OAuth. On the SAAM authorization page, enter the pairing code shown on pairingPageUrl. Never paste the pairing code into a chat. Keep this process running. Restarting invalidates all connections; a quick tunnel also changes the URL.' }, null, 2), { mode: 0o600 });
  if (process.env.SAAM_NO_AUTO_OPEN !== '1') await openBrowser(pairing.url);
  console.log(`SAAM web-chat MCP: ${bridge.mcpUrl}\nPairing code page (this computer only): ${pairing.url}\n${claudePlugin ? `Claude plugin: ${claudePlugin}` : 'Claude plugin: not packaged for a loopback test address.'}\nConnection file: ${infoFile}\nStudio opens locally when the agent requests review. Stop this process to disconnect all clients.`);
} catch (error) {
  console.error(error.message);
  await close();
  process.exitCode = 1;
}
