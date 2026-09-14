import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createProbe } from '../../scripts/web-agent-probe.mjs';

test('ephemeral probe connects UI inputs, agent updates and exact fixture bytes without claiming human approval', async () => {
  const probe = createProbe();
  await new Promise(resolve => probe.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + probe.server.address().port + probe.basePath;
  const post = (route, data, control) => fetch(base + route, { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(control ? { 'X-Probe-Control': control } : {}) }, body: JSON.stringify(data) });
  try {
    const html = await (await fetch(base)).text();
    assert.ok(!html.includes(probe.controlToken));
    const initial = await (await fetch(base + 'state')).json();
    const data = { instanceId: initial.instanceId, text: 'Synthetic test input, not a human action.' };
    assert.equal((await post('message', data)).status, 403);
    assert.equal((await post('input', { ...data, instanceId: 'old-session' })).status, 409);
    assert.equal((await post('input', { ...data, text: '' })).status, 400);
    assert.equal((await post('input', data)).status, 200);
    const updated = await (await post('message', { ...data, text: 'Agent changed the message.' }, probe.controlToken)).json();
    assert.equal(updated.browserSubmissions, 1);
    assert.equal(updated.instanceId, initial.instanceId);
    assert.equal(updated.message, 'Agent changed the message.');
    assert.deepEqual(updated.events.map(e => e.source), ['browser-input-endpoint', 'agent-api']);
    assert.equal(updated.approvals, undefined);
    const receipt = await fetch(base + 'fixture.txt');
    const bytes = Buffer.from(await receipt.arrayBuffer());
    assert.match(receipt.headers.get('content-disposition'), /attachment/);
    assert.deepEqual(bytes, probe.fixture);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), initial.fixtureSha256);
    const final = await (await fetch(base + 'state')).json();
    assert.equal(final.fixtureSha256, initial.fixtureSha256);
    const root = new URL('/', base);
    assert.equal((await fetch(root)).status, 404);
    const fresh = createProbe();
    assert.notEqual(fresh.snapshot().instanceId, initial.instanceId);
    assert.equal(fresh.snapshot().browserSubmissions, 0);
  } finally {
    await new Promise(resolve => { probe.server.close(resolve); probe.server.closeAllConnections(); });
  }
});
