import fs from 'node:fs';
const [input, output] = process.argv.slice(2);
if (!input) throw new Error('Usage: node scripts/bench/profile-summary.mjs input.cpuprofile [summary.json]');
const profile = JSON.parse(fs.readFileSync(input, 'utf8'));
const nodes = new Map(profile.nodes.map(n => [n.id, n])), parent = new Map(), self = new Map(), inclusiveFiles = new Map();
for (const n of nodes.values()) for (const c of n.children ?? []) parent.set(c, n.id);
let totalUs = 0;
for (let i = 0; i < profile.samples.length; i++) {
  const id = profile.samples[i], dt = profile.timeDeltas[i]; totalUs += dt; self.set(id, (self.get(id) ?? 0) + dt);
  const files = new Set();
  for (let current = id; current; current = parent.get(current)) { const url = nodes.get(current).callFrame.url; if (url) files.add(url); }
  for (const file of files) inclusiveFiles.set(file, (inclusiveFiles.get(file) ?? 0) + dt);
}
const frames = new Map();
for (const [id, us] of self) {
  const frame = nodes.get(id).callFrame, key = JSON.stringify([frame.functionName, frame.url, frame.lineNumber, frame.columnNumber]);
  const entry = frames.get(key) ?? { ...frame, selfUs: 0 }; entry.selfUs += us; frames.set(key, entry);
}
const summary = { sampledSeconds: totalUs / 1e6,
  qualification: 'Separate instrumented run; sample percentages are diagnostic and are not benchmark speed measurements. Inclusive file percentages overlap.',
  self: [...frames.values()].sort((a, b) => b.selfUs - a.selfUs).slice(0, 25).map(({ selfUs, ...frame }) => ({ ...frame, percent: selfUs / totalUs * 100 })),
  inclusiveFiles: [...inclusiveFiles].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([file, us]) => ({ file, percent: us / totalUs * 100 })) };
if (output) fs.writeFileSync(output, JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
