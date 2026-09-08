// Order existing raster segments; never move their endpoints or add coverage.
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Split the scan into cells at every interval split/merge around a hole.
 * A cell contains exactly one span on each of a run of adjacent scan rows.
 * Finish its entire zigzag before visiting another cell.
 */
export function rasterRegions(lines, layer) {
  const across = layer % 2 === 0 ? "y" : "x";
  const along = layer % 2 === 0 ? "x" : "y";
  const rows = [];
  for (const points of lines) {
    const coordinate = points[0][across];
    if (!rows.length || rows.at(-1).coordinate !== coordinate) rows.push({ coordinate, spans: [] });
    const sorted = [...points].sort((a, b) => a[along] - b[along]);
    rows.at(-1).spans.push({ points: sorted, lo: sorted[0][along], hi: sorted[1][along] });
  }
  const regions = [];
  let previous = [];
  for (const { spans } of rows) {
    const parents = spans.map((span) => previous.filter((p) => Math.min(p.hi, span.hi) - Math.max(p.lo, span.lo) > 1e-6));
    const children = new Map(previous.map((p) => [p, parents.filter((list) => list.includes(p)).length]));
    spans.forEach((span, i) => {
      const parent = parents[i].length === 1 ? parents[i][0] : null;
      if (parent && children.get(parent) === 1) span.region = parent.region;
      else { span.region = []; regions.push(span.region); }
      span.region.push(span.points);
    });
    previous = spans;
  }
  return regions;
}

function sweep(region, backwards, flip) {
  const rows = backwards ? [...region].reverse() : region;
  return rows.map((points, i) => (i % 2 === 0) === flip ? [...points].reverse() : points);
}

function cost(lines, from) {
  let total = from ? distance(from, lines[0][0]) : 0;
  for (let i = 1; i < lines.length; i++) total += distance(lines[i - 1].at(-1), lines[i][0]);
  return total;
}

/** Deterministic cell ordering minimizing entry plus internal travel,
 * considering all four serpentine entries.
 * Optimize whole cells, never individual lines (which would undo grouping).
 */
export function orderRasterRegions(lines, layer, from) {
  const remaining = rasterRegions(lines, layer);
  const ordered = [];
  while (remaining.length) {
    let best = null;
    remaining.forEach((region, index) => {
      for (const backwards of [false, true]) {
        for (const flip of [false, true]) {
          const candidate = sweep(region, backwards, flip);
          const score = cost(candidate, from);
          if (!best || score < best.score - 1e-9) best = { index, candidate, score };
        }
      }
    });
    ordered.push(best.candidate);
    from = best.candidate.at(-1).at(-1);
    remaining.splice(best.index, 1);
  }
  return ordered;
}

export function orderRaster(lines, layer, from) {
  return orderRasterRegions(lines, layer, from).flat();
}

function rotateContour(path, from, to = null) {
  const points = path.points;
  if (!from && !to || points.length < 3 || distance(points[0], points.at(-1)) > 1e-6) return path;
  let bestIndex = 0, bestCost = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const score = (from ? distance(from, points[i]) : 0) + (to ? distance(points[i], to) : 0);
    if (score < bestCost - 1e-9) { bestIndex = i; bestCost = score; }
  }
  const body = points.slice(0, -1);
  const rotated = [...body.slice(bestIndex), ...body.slice(0, bestIndex)];
  return { ...path, points: [...rotated, rotated[0]] };
}

/** Keep perimeters before fill and preserve contour edges/direction. Move
 * seams to existing vertices; visit hole contours by nearest entry. */
export function orderLayer(paths, start, lines, layer) {
  let previous = paths[start - 1]?.points.at(-1);
  for (let i = start; i < paths.length; i++) {
    if (paths[i].family === "Hole perimeter" && previous) {
      let best = i, bestCost = Infinity;
      for (let j = i; j < paths.length && paths[j].family === "Hole perimeter"; j++) {
        const candidate = rotateContour(paths[j], previous);
        const score = distance(previous, candidate.points[0]);
        if (score < bestCost - 1e-9) { best = j; bestCost = score; }
      }
      [paths[i], paths[best]] = [paths[best], paths[i]];
    }
    paths[i] = rotateContour(paths[i], previous);
    previous = paths[i].points.at(-1);
  }
  const regions = orderRasterRegions(lines, layer, previous);
  const ordered = regions.flatMap((lines, region) => lines.map(points => ({ points, region })));
  if (ordered.length && paths.length > start) {
    const last = paths.length - 1;
    paths[last] = rotateContour(paths[last], paths[last - 1]?.points.at(-1), ordered[0].points[0]);
  }
  return ordered;
}
