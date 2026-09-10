import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { unpackZip } from '../export/zip.mjs';
import { writeClaudePlugin } from '../../adapters/claude/package.mjs';

test('Claude upload package includes the active HTTP connector and skill without local credentials', async t => {
  const dir = await mkdtemp(resolve(tmpdir(), 'saam-synthetic-plugin-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const connection = resolve(dir, 'connection.json'), output = resolve(dir, 'plugin.zip');
  const mcpUrl = 'https://synthetic.example/mcp';
  await writeFile(connection, JSON.stringify({ status: 'running', mcpUrl, pairingCode: 'SYNTHETIC-SECRET-NEVER-PACKAGED', printsRoot: '/private/prints' }));
  await promisify(execFile)(process.execPath, ['adapters/claude/package.mjs', '--connection', connection, '--out', output]);
  const bytes = await readFile(output), entries = unpackZip(bytes);
  assert.deepEqual([...entries.keys()].sort(), ['.claude-plugin/plugin.json', '.mcp.json', 'skills/saam/SKILL.md']);
  assert.equal(JSON.parse(entries.get('.claude-plugin/plugin.json')).name, 'saam');
  assert.deepEqual(JSON.parse(entries.get('.mcp.json')), { mcpServers: { saam: { type: 'http', url: mcpUrl } } });
  assert.ok(![...entries.values()].some(value => value.includes(Buffer.from('SYNTHETIC-SECRET-NEVER-PACKAGED'))));
  for (const invalid of ['http://localhost:4322/mcp', 'https://token@example.com/mcp', mcpUrl + '?token=secret'])
    await assert.rejects(writeClaudePlugin({ mcpUrl: invalid, output }), /HTTPS/);
});
