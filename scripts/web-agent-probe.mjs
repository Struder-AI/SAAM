// Standalone transport experiment. No SAAM dependencies, print data or approvals.
import http from 'node:http';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function createProbe() {
  const token = randomBytes(24).toString('hex');
  const controlToken = randomBytes(24).toString('hex');
  const basePath = '/' + token + '/';
  const instanceId = randomUUID();
  const startedAt = new Date().toISOString();
  const fixture = Buffer.from(`SAAM web-agent transport probe\nInstance: ${instanceId}\nStarted: ${startedAt}\nThis is a text fixture, not a machine program.\n`);
  const fixtureSha256 = sha256(fixture);
  let message = 'Waiting for an update from the agent.';
  let revision = 0;
  let browserSubmissions = 0;
  const events = [];
  const event = (source, text) => {
    events.push({ sequence: ++revision, time: new Date().toISOString(), source, text });
    if (events.length > 100) events.shift();
  };
  const snapshot = () => ({
    schema: 'saam-web-agent-probe/1', instanceId, startedAt,
    serverTime: new Date().toISOString(), uptimeSeconds: Math.floor((Date.now() - Date.parse(startedAt)) / 1000),
    message, revision, browserSubmissions, events: [...events], fixtureSha256,
    evidenceBoundary: 'Event sources identify endpoints, not authenticated humans. Maker interaction and download success require user confirmation.'
  });

  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    // Intentionally allow host-provided preview frames. The random path gates access.
    const send = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    try {
      const pathname = new URL(req.url, 'http://probe.invalid').pathname;
      if (pathname === basePath.slice(0, -1)) {
        res.writeHead(307, { Location: basePath }); res.end(); return;
      }
      if (!pathname.startsWith(basePath)) { send(404, { error: 'Use the session URL printed by the server.' }); return; }
      const route = pathname.slice(basePath.length);
      if (req.method === 'GET' && route === '') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(page); return;
      }
      if (req.method === 'GET' && route === 'state') { send(200, snapshot()); return; }
      if (req.method === 'GET' && route === 'fixture.txt') {
        event('download-request', 'Fixture requested; this does not prove it was saved on the maker device.');
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': 'attachment; filename="saam-probe-receipt.txt"', 'X-Fixture-SHA256': fixtureSha256 });
        res.end(fixture); return;
      }
      if (req.method !== 'POST' || !['input', 'message'].includes(route)) { send(404, { error: 'Unknown route.' }); return; }
      if (route === 'message' && req.headers['x-probe-control'] !== controlToken) {
        send(403, { error: 'Agent control token required.' }); return;
      }
      if (req.headers['content-type']?.split(';')[0] !== 'application/json') {
        send(415, { error: 'JSON required.' }); return;
      }
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 4096) { send(413, { error: 'Request too large.' }); return; } }
      const data = JSON.parse(body);
      if (data.instanceId !== instanceId) { send(409, { error: 'Different server instance. Reload and inspect its ID.' }); return; }
      if (typeof data.text !== 'string' || !data.text.trim() || data.text.length > 500) {
        send(400, { error: 'Enter 1–500 characters.' }); return;
      }
      if (route === 'message') { message = data.text; event('agent-api', data.text); }
      else { browserSubmissions++; event('browser-input-endpoint', data.text); }
      send(200, snapshot());
    } catch (error) { if (!res.headersSent) send(400, { error: error.message }); else res.end(); }
  });
  return { server, basePath, controlToken, snapshot, fixture };
}

const page = `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SAAM · Web agent probe</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#eef1e9;color:#24342d;font:16px system-ui,sans-serif}
main{max-width:820px;margin:36px auto;padding:24px}h1{font-size:32px;margin:8px 0}h2{font-size:19px}
.card{background:white;border:1px solid #ced8ca;border-radius:14px;padding:22px;margin:18px 0}
.eyebrow{font-size:12px;letter-spacing:.13em}#connection{font-weight:650}dl{display:grid;grid-template-columns:140px 1fr;gap:10px}
dt{color:#56665b}dd{margin:0;overflow-wrap:anywhere}input{width:100%;padding:12px;font:inherit;margin:8px 0 12px;border:1px solid #718374;border-radius:6px}
button,.download{display:inline-block;border:0;border-radius:7px;background:#254f3b;color:white;font:inherit;padding:11px 16px;cursor:pointer;text-decoration:none}
button:disabled{opacity:.5}#message{font-size:23px}small{display:block;line-height:1.5;color:#56665b;margin-top:12px}
pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}#error{color:#a42525;min-height:24px}
@media(max-width:600px){main{margin:0;padding:16px}dl{grid-template-columns:1fr;gap:5px}dd{margin-bottom:12px}}
</style>
<main><div class="eyebrow">SAAM / TRANSPORT EXPERIMENT</div><h1>Can we share a live session?</h1>
<p>This page must talk to the agent's running server. It does not create a print or grant approval.</p>
<div class="card"><div id="connection" role="status">Connecting to server…</div><dl>
<dt>Server instance</dt><dd id="instance">—</dd><dt>Server clock</dt><dd id="clock">—</dd>
<dt>Uptime</dt><dd id="uptime">—</dd><dt>Input count</dt><dd id="count">—</dd></dl></div>
<div class="card"><h2>Agent → maker</h2><p id="message">Waiting for server…</p>
<small>Ask the agent to change this message. It should update here without reopening the page.</small></div>
<div class="card"><h2>Maker → agent</h2><form id="form"><label for="phrase">Invent a short phrase here. Do not put it in chat first.</label>
<input id="phrase" maxlength="500" required autocomplete="off" placeholder="A phrase only you have chosen">
<button id="submit" disabled>Send to the running server</button></form><p id="error" role="alert"></p>
<small>Then ask the agent to read the phrase from its server. Endpoint records alone do not prove who entered it.</small></div>
<div class="card"><h2>Download</h2><a class="download" href="fixture.txt" download="saam-probe-receipt.txt">Download test receipt</a>
<small>Confirm the file actually reaches your device. Its instance ID must match the page.</small>
<p>Expected SHA-256</p><pre id="hash">—</pre></div>
<details><summary>Recent server events</summary><pre id="events"></pre></details>
</main><script>
let state, polling=false, sending=false;
const $=id=>document.getElementById(id);
function show(next){state=next;$('instance').textContent=next.instanceId;$('clock').textContent=next.serverTime;
$('uptime').textContent=next.uptimeSeconds+' seconds';$('count').textContent=next.browserSubmissions;
$('message').textContent=next.message;$('hash').textContent=next.fixtureSha256;
$('events').textContent=JSON.stringify(next.events,null,2);$('connection').textContent='Live connection';$('submit').disabled=sending;}
async function refresh(){if(polling)return;polling=true;try{const r=await fetch('state',{cache:'no-store'});
if(!r.ok)throw Error('Server unavailable');show(await r.json());}
catch(e){$('connection').textContent='Disconnected — last received values shown';$('submit').disabled=true;}
finally{polling=false;}}
$('form').addEventListener('submit',async e=>{e.preventDefault();if(!state||sending)return;
sending=true;$('submit').disabled=true;$('error').textContent='';try{const r=await fetch('input',{method:'POST',
headers:{'Content-Type':'application/json'},body:JSON.stringify({instanceId:state.instanceId,text:$('phrase').value})});
const data=await r.json();if(!r.ok)throw Error(data.error);show(data);$('phrase').value='';}
catch(e){$('error').textContent=e.message;}finally{sending=false;await refresh();}});
refresh();setInterval(refresh,1000);
</script></html>`;

async function main() {
  const [command = 'help', ...args] = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i].startsWith('--') || args[i + 1] === undefined) throw Error('Use --name value options.');
    options[args[i].slice(2)] = args[i + 1];
  }
  if (command === 'serve') {
    const port = Number(options.port ?? process.env.PORT ?? 4321), host = options.host ?? '127.0.0.1';
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Invalid port.');
    const probe = createProbe();
    probe.server.on('error', error => { console.error(error.message); process.exitCode = 1; });
    probe.server.listen(port, host, () => {
      const localHost = ['0.0.0.0', '::'].includes(host) ? '127.0.0.1' : host;
      const baseUrl = 'http://' + localHost + ':' + probe.server.address().port + probe.basePath;
      console.log(JSON.stringify({ baseUrl, listeningHost: host, instanceId: probe.snapshot().instanceId,
        controlToken: probe.controlToken, fixtureSha256: probe.snapshot().fixtureSha256,
        note: 'Agent-local URL. Maker reachability is NOT established. Keep the session path when using a native forwarded URL.' }, null, 2));
    });
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
      probe.server.close(); probe.server.closeAllConnections();
    });
  } else if (command === 'status' || command === 'update') {
    if (!options.url) throw Error('Supply --url with the complete session URL.');
    const base = options.url.endsWith('/') ? options.url : options.url + '/';
    const response = await fetch(new URL('state', base), { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw Error('State request failed: ' + response.status);
    let state = await response.json();
    if (command === 'update') {
      if (!options.control || !options.message) throw Error('Supply --control and --message.');
      const updated = await fetch(new URL('message', base), { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Probe-Control': options.control },
        body: JSON.stringify({ instanceId: state.instanceId, text: options.message }), signal: AbortSignal.timeout(10000) });
      state = await updated.json(); if (!updated.ok) throw Error(state.error);
    }
    console.log(JSON.stringify(state, null, 2));
  } else {
    console.log('Node 22+; no dependencies.\nserve [--host 127.0.0.1] [--port 4321]\nstatus --url SESSION_URL\nupdate --url SESSION_URL --control CONTROL_TOKEN --message "New message"\nSee web-agent-probe-prompt.txt for the cross-vendor experiment.');
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
