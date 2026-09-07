// Shared machine-neutral transition geometry. Operations use this before
// review; post-processors must follow these points without inventing hops.
export function withTravel(paths, hopHeight, { previous = null, printedTop = -Infinity } = {}) {
  if (hopHeight === undefined) return paths;
  if (!Number.isFinite(hopHeight) || hopHeight < 0) throw new Error("travelHopHeight must be a finite non-negative number in mm.");
  const output = [];
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const atZ = (p, z) => ({ ...p, z: Number(z.toFixed(4)) });
  for (const path of paths) {
    if (!path.points.length) { output.push(path); continue; }
    const first = path.points[0];
    if (previous && distance(previous, first) > 1e-6) {
      const points = [previous];
      if (hopHeight > 0) {
        const top = Math.max(printedTop, previous.z, first.z) + hopHeight;
        points.push(atZ(previous, top), atZ(first, top));
      }
      points.push(first);
      output.push({ family: "Travel", layer: path.layer, intent: "travel", points: points.filter((p, i) => i === 0 || distance(points[i - 1], p) > 1e-6) });
    }
    output.push(path);
    previous = path.points.at(-1);
    if (path.intent === "print") for (const p of path.points) printedTop = Math.max(printedTop, p.z);
  }
  return output;
}
