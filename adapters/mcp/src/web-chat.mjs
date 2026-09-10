#!/usr/bin/env node
// Start a temporary HTTPS tunnel plus the local OAuth/MCP bridge. No Studio routes
// are forwarded. Credentials stay in the ignored local connection file.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHttpBridge } from './http.mjs';
import { writeClaudePlugin } from '../../claude/package.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('node adapters/mcp/src/web-chat.mjs [--cloudflared PATH] [--port 4322] [--prints-root PATH] [--public-url HTTPS_ORIGIN]\nWithout --public-url, starts a temporary Cloudflare tunnel. Credentials and logs are saved under .local/web-chat/.');
  process.exit(0);
}
const options = {};
for (let index = 0; index < args.length; index += 2) {
  if (!['--cloudflared', '--port', '--prints-root', '--public-url'].includes(args[index]) || !args[index + 1])
    throw new Error('Unknown or incomplete option. Use --help.');
  options[args[index]] = args[index + 1];
}
const port = Number(options['--port'] ?? 4322);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Port must be between 1024 and 65535.');
const localDir = resolve(root, '.local/web-chat');
await mkdir(localDir, { recursive: true });
const infoFile = resolve(localDir, `connection-${port}.json`), logFile = resolve(localDir, `tunnel-${port}.log`);
let bridge, tunnel, closing = false;
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
  tunnel?.kill();
  await bridge?.close();
  await writeFile(infoFile, JSON.stringify({ status: 'stopped', stoppedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
}
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());
try {
  let publicUrl = options['--public-url'];
  if (!publicUrl) {
    const binary = options['--cloudflared'] ?? process.env.SAAM_CLOUDFLARED ?? 'cloudflared';
    await writeFile(logFile, '', { mode: 0o600 });
    publicUrl = await new Promise((done, reject) => {
      tunnel = spawn(binary, ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate', '--protocol', 'http2'],
        { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      const timeout = setTimeout(() => reject(new Error(`Tunnel did not return a URL. Inspect ${logFile}.`)), 60_000);
      let tail = '';
      const output = chunk => {
        void appendFile(logFile, chunk);
        tail = (tail + chunk.toString()).slice(-8000);
        const match = tail.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (match) { clearTimeout(timeout); done(match[0]); }
      };
      tunnel.stdout.on('data', output); tunnel.stderr.on('data', output);
      tunnel.once('error', error => { clearTimeout(timeout); reject(error); });
      tunnel.once('exit', code => {
        clearTimeout(timeout);
        if (!closing) { reject(new Error(`Tunnel exited (${code}). Inspect ${logFile}.`)); void close(); }
      });
    });
  }
  if (closing) throw new Error('Tunnel closed during startup.');
  bridge = await createHttpBridge({ publicUrl, printsRoot: resolve(options['--prints-root'] ?? process.env.SAAM_PRINTS_ROOT ?? resolve(root, 'Prints')),
    autoOpen: process.env.SAAM_NO_AUTO_OPEN !== '1' });
  const claudePlugin = await writeClaudePlugin({ mcpUrl: bridge.mcpUrl, output: resolve(localDir, `saam-claude-${port}.zip`) });
  await writeFile(infoFile, JSON.stringify({ status: 'running', mcpUrl: bridge.mcpUrl, pairingCode: bridge.pairingCode,
    claudePlugin,
    pid: process.pid, tunnelPid: tunnel?.pid, startedAt: new Date().toISOString(),
    instructions: 'Add mcpUrl as a custom MCP connection in ChatGPT or Claude. Choose OAuth. On the SAAM authorization page, enter pairingCode. Never paste the pairing code into a chat. Keep this process running. Restarting invalidates all connections; temporary URLs change.' }, null, 2), { mode: 0o600 });
  console.log(`SAAM web-chat MCP: ${bridge.mcpUrl}\nClaude plugin: ${claudePlugin}\nPairing code and connection instructions: ${infoFile}\nStudio opens locally when the agent requests review. Stop this process to disconnect all clients.`);
} catch (error) {
  console.error(error.message);
  await close();
  process.exitCode = 1;
}
