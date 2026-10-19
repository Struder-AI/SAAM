// Construction-local traversal fixes depositing connections before publication.
import {distance} from '../private/toolpath/numeric.mjs';
import {strokeRange} from './deposition.mjs';

// Order strokes nearest-first from the current point. Closed loops are also
// rotated to start at their closest point, which is where most of the saved
// travel comes from on perimeters.
export function orderStrokes(strokes, from) {
  const remaining = [...strokes];
  const ordered = [];
  let cursor = from;
  while (remaining.length) {
    let best = 0, bestDistance = Infinity, bestRotation = 0;
    for (let i = 0; i < remaining.length; i++) {
      const stroke = remaining[i];
      if (stroke.closed) {
        for (let k = 0; k < stroke.points.length; k++) {
          const d = distance(cursor, stroke.points[k]);
          if (d < bestDistance) { bestDistance = d; best = i; bestRotation = k; }
        }
      } else {
        const head = distance(cursor, stroke.points[0]);
        const tail = stroke.directionRequired===true?Infinity:distance(cursor, stroke.points[stroke.points.length - 1]);
        const d = Math.min(head, tail);
        if (d < bestDistance) { bestDistance = d; best = i; bestRotation = tail < head ? -1 : 0; }
      }
    }
    const stroke = remaining.splice(best, 1)[0];
    const selected=stroke.closed?strokeRange(stroke,bestRotation)
      :bestRotation===-1?strokeRange(stroke,stroke.points.length-1,0):stroke;
    ordered.push(selected);
    cursor = selected.points.at(-1);
  }
  return ordered;
}

// Preserve each uninterrupted zigzag, selecting either endpoint of either end
// row from the construction cursor. Row order and stroke direction can change
// independently. Stable ties retain producer order; segment data stays attached.
export function orderScanlineCells(strokes, from) {
  const cells = new Map();
  for (const input of strokes) {
    const stroke=input.closed?strokeRange(input):input;
    const cell = cells.get(stroke.scanlineCell) ?? [];
    cell.push(stroke);
    cells.set(stroke.scanlineCell, cell);
  }
  const remaining = [...cells.values()], ordered = [];
  let cursor = from;
  while (remaining.length) {
    let best = 0, reverseRows = false, reverseStrokes = false, bestDistance = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const cell = remaining[i];
      const entries = [
        {point:cell[0].points[0],rows:false,strokes:false},
        {point:cell.at(-1).points.at(-1),rows:true,strokes:true},
        {point:cell[0].points.at(-1),rows:false,strokes:true},
        {point:cell.at(-1).points[0],rows:true,strokes:false}
      ];
      for (const entry of entries) {
        if(entry.strokes&&cell.some(stroke=>stroke.directionRequired===true))continue;
        const gap = distance(cursor, entry.point);
        if (gap < bestDistance) {
          best = i; reverseRows = entry.rows; reverseStrokes = entry.strokes; bestDistance = gap;
        }
      }
    }
    let cell = remaining.splice(best, 1)[0];
    if (reverseRows) cell = [...cell].reverse();
    if (reverseStrokes) cell = cell.map(stroke => strokeRange(stroke,stroke.points.length-1,0));
    ordered.push(...cell);
    cursor = cell.at(-1).points.at(-1);
  }
  return ordered;
}
