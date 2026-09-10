#!/usr/bin/env node
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { packZip } from '../../core/export/zip.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

export async function writeClaudePlugin({ mcpUrl, output = resolve(root, '.local/web-chat/saam-claude.zip') }) {
  const url = new URL(mcpUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/mcp')
    throw new Error('The Claude web plugin requires an HTTPS /mcp URL without credentials, query or fragment.');
  // Explicit allowlist: never archive a connection file, credentials, or prints.
  const entries = new Map();
  for (const name of ['.claude-plugin/plugin.json', 'skills/saam/SKILL.md'])
    entries.set(name, await readFile(resolve(here, 'plugin', name), 'utf8'));
  entries.set('.mcp.json', JSON.stringify({ mcpServers: { saam: { type: 'http', url: url.href } } }, null, 2) + '\n');
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, packZip(entries));
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), options = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!['--connection', '--out'].includes(args[index]) || !args[index + 1])
      throw new Error('Usage: node adapters/claude/package.mjs [--connection FILE] [--out ZIP]');
    options[args[index]] = args[index + 1];
  }
  const info = JSON.parse(await readFile(resolve(options['--connection'] ?? resolve(root, '.local/web-chat/connection-4322.json')), 'utf8'));
  if (info.status !== 'running') throw new Error('Start the SAAM web-chat connection before building the plugin.');
  const output = await writeClaudePlugin({ mcpUrl: info.mcpUrl, output: options['--out'] && resolve(options['--out']) });
  console.log(`Claude plugin: ${output}\nUpload this ZIP under Customize > Plugins > Upload a plugin, then connect SAAM.`);
}
