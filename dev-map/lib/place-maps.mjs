// Internal renderer transport: one process places every untouched map in free space.
import {solvePlacement} from './placement-solver.mjs';

async function placeMaps() {
  const chunks=[];
  for await(const chunk of process.stdin)chunks.push(chunk);
  const maps=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const placed=Object.fromEntries(Object.entries(maps).map(([id,map])=>[id,solvePlacement(map)]));
  process.stdout.write(JSON.stringify(placed));
}
await placeMaps();
