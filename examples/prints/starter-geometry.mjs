// The starter recipe: a 40 × 30 mm block whose cubic top is a gentle dome, its
// slope inside the S5's non-planar limit. The walls are ruled down from the
// top's boundary rows, sharing their control points, as GEOMETRY.md describes.
export function starterGeometry() {
  const x = [0, 20/3, 20, 100/3, 40], y = [0, 5, 15, 25, 30];
  const top = [[6, 6, 6, 6, 6], [6, 6.6, 6.8485, 6.6, 6], [6, 6.8485, 7.2, 6.8485, 6], [6, 6.6, 6.8485, 6.6, 6], [6, 6, 6, 6, 6]];
  const wall = points => ({ degreeU: 3, degreeV: 1, controlPoints: points.map(([px, py, h]) => [[px, py, 0], [px, py, h]]) });
  return { shape: 'spline', patches: [
    { name: 'top', degreeU: 3, degreeV: 3, controlPoints: x.map((px, i) => y.map((py, j) => [px, py, top[i][j]])) },
    { name: 'bottom', degreeU: 1, degreeV: 1, controlPoints: [[[0, 0, 0], [0, 30, 0]], [[40, 0, 0], [40, 30, 0]]] },
    { name: 'front', ...wall(x.map((px, i) => [px, 0, top[i][0]])) },
    { name: 'right', ...wall(y.map((py, j) => [40, py, top[4][j]])) },
    { name: 'back', ...wall(x.map((px, i) => [px, 30, top[i][4]])) },
    { name: 'left', ...wall(y.map((py, j) => [0, py, top[0][j]])) }
  ] };
}

