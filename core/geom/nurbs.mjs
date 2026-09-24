// Bivariate NURBS patch evaluation.
//
// rhino3dm is a geometry/file library: it evaluates surfaces but computes no
// intersections. This module extracts the control net so we can do our own
// sectioning with the convex-hull property, and evaluates points, derivatives
// and normals for toolpath generation.
//
// Two openNURBS conventions matter here:
//   * NurbsSurfacePointList.get() returns HOMOGENEOUS coordinates [xw, yw, zw, w].
//   * Knot vectors omit the first and last superfluous knot, so their length is
//     cpCount + order - 2. We restore the full vector on extraction.

import { requireThat, cross, length } from './tolerance.mjs';

export function patchFromSurface(surface, name = 'patch') {
  const ns = surface.toNurbsSurface();
  requireThat(ns, `Surface "${name}" has no NURBS form.`);
  const points = ns.points(), nu = points.countU, nv = points.countV;
  const orderU = ns.orderU, orderV = ns.orderV;
  const cp = new Float64Array(nu * nv * 4);
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const [x, y, z, w] = points.get(i, j);
      requireThat(Number.isFinite(w) && w > 0, `Surface "${name}" has a non-positive weight; the convex-hull test needs positive weights.`);
      cp.set([x, y, z, w], (i * nv + j) * 4);
    }
  }
  const patch = {
    name, nu, nv, orderU, orderV,
    knotsU: fullKnots(ns.knotsU().toList(), nu, orderU, name),
    knotsV: fullKnots(ns.knotsV().toList(), nv, orderV, name),
    cp
  };
  patch.domainU = [patch.knotsU[orderU - 1], patch.knotsU[nu]];
  patch.domainV = [patch.knotsV[orderV - 1], patch.knotsV[nv]];
  return patch;
}

// Restore the leading/trailing knot openNURBS leaves implicit.
function fullKnots(list, count, order, name) {
  requireThat(list.length === count + order - 2, `Surface "${name}" has an unexpected knot count.`);
  return Float64Array.from([list[0], ...list, list[list.length - 1]]);
}

export function findSpan(knots, count, order, t) {
  const degree = order - 1, low = degree, high = count;
  if (t >= knots[high]) return high - 1;
  if (t <= knots[low]) return low;
  let a = low, b = high;
  while (b - a > 1) {
    const mid = (a + b) >> 1;
    if (t < knots[mid]) b = mid; else a = mid;
  }
  return a;
}

// Basis functions and their derivatives (The NURBS Book, algorithm A2.3).
export function basisDerivatives(knots, span, t, order, count) {
  const degree = order - 1;
  const ndu = [], a = [[], []], left = [], right = [], ders = [];
  for (let i = 0; i <= degree; i++) ndu.push(new Float64Array(degree + 1));
  ndu[0][0] = 1;
  for (let j = 1; j <= degree; j++) {
    left[j] = t - knots[span + 1 - j];
    right[j] = knots[span + j] - t;
    let saved = 0;
    for (let k = 0; k < j; k++) {
      ndu[j][k] = right[k + 1] + left[j - k];
      const temp = ndu[k][j - 1] / ndu[j][k];
      ndu[k][j] = saved + right[k + 1] * temp;
      saved = left[j - k] * temp;
    }
    ndu[j][j] = saved;
  }
  for (let i = 0; i <= count; i++) ders.push(new Float64Array(degree + 1));
  for (let j = 0; j <= degree; j++) ders[0][j] = ndu[j][degree];
  for (let r = 0; r <= degree; r++) {
    let s1 = 0, s2 = 1;
    a[0] = new Float64Array(degree + 1); a[1] = new Float64Array(degree + 1);
    a[0][0] = 1;
    for (let k = 1; k <= count; k++) {
      let d = 0;
      const rk = r - k, pk = degree - k;
      if (r >= k) { a[s2][0] = a[s1][0] / ndu[pk + 1][rk]; d = a[s2][0] * ndu[rk][pk]; }
      const j1 = rk >= -1 ? 1 : -rk, j2 = r - 1 <= pk ? k - 1 : degree - r;
      for (let j = j1; j <= j2; j++) {
        a[s2][j] = (a[s1][j] - a[s1][j - 1]) / ndu[pk + 1][rk + j];
        d += a[s2][j] * ndu[rk + j][pk];
      }
      if (r <= pk) { a[s2][k] = -a[s1][k - 1] / ndu[pk + 1][r]; d += a[s2][k] * ndu[r][pk]; }
      ders[k][r] = d;
      const t2 = s1; s1 = s2; s2 = t2;
    }
  }
  let factor = degree;
  for (let k = 1; k <= count; k++) {
    for (let j = 0; j <= degree; j++) ders[k][j] *= factor;
    factor *= degree - k;
  }
  return ders;
}

// Basis functions without derivatives (The NURBS Book, algorithm A2.2). The
// sectioner evaluates g millions of times per part and needs no derivatives, so
// this path avoids the derivative table entirely.
export function basisFunctions(knots, span, t, order) {
  const out = new Float64Array(order);
  out[0] = 1;
  for (let j = 1; j < order; j++) {
    let saved = 0;
    for (let k = 0; k < j; k++) {
      // These are the same knot differences as the recurrence's left/right
      // tables; computing them here leaves only the returned basis allocated.
      const right = knots[span + k + 1] - t, left = t - knots[span + 1 - j + k];
      const temp = out[k] / (right + left);
      out[k] = saved + right * temp;
      saved = left * temp;
    }
    out[j] = saved;
  }
  return out;
}

// Point, first derivatives and unit normal at (u, v). Rational surfaces use the
// quotient rule on the homogeneous form.
export function evaluate(patch, u, v, wantDerivatives = true) {
  const { nu, nv, orderU, orderV, knotsU, knotsV, cp } = patch;
  const du = clamp(u, patch.domainU), dv = clamp(v, patch.domainV);
  const spanU = findSpan(knotsU, nu, orderU, du), spanV = findSpan(knotsV, nv, orderV, dv);
  const sw = [0, 0, 0, 0], swu = [0, 0, 0, 0], swv = [0, 0, 0, 0];
  if (!wantDerivatives) {
    const bu = basisFunctions(knotsU, spanU, du, orderU);
    const bv = basisFunctions(knotsV, spanV, dv, orderV);
    for (let i = 0; i < orderU; i++) {
      const iu = spanU - orderU + 1 + i;
      for (let j = 0; j < orderV; j++) {
        const base = ((iu * nv) + spanV - orderV + 1 + j) * 4, n = bu[i] * bv[j];
        sw[0] += n * cp[base]; sw[1] += n * cp[base + 1]; sw[2] += n * cp[base + 2]; sw[3] += n * cp[base + 3];
      }
    }
    return { point: [sw[0] / sw[3], sw[1] / sw[3], sw[2] / sw[3]] };
  }
  const bu = basisDerivatives(knotsU, spanU, du, orderU, 1);
  const bv = basisDerivatives(knotsV, spanV, dv, orderV, 1);
  for (let i = 0; i < orderU; i++) {
    const iu = spanU - orderU + 1 + i;
    for (let j = 0; j < orderV; j++) {
      const iv = spanV - orderV + 1 + j, base = (iu * nv + iv) * 4;
      const n = bu[0][i] * bv[0][j];
      for (let k = 0; k < 4; k++) sw[k] += n * cp[base + k];
      const nud = bu[1][i] * bv[0][j], nvd = bu[0][i] * bv[1][j];
      for (let k = 0; k < 4; k++) { swu[k] += nud * cp[base + k]; swv[k] += nvd * cp[base + k]; }
    }
  }
  const w = sw[3], point = [sw[0] / w, sw[1] / w, sw[2] / w];
  const dU = [0, 0, 0], dV = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    dU[k] = (swu[k] - point[k] * swu[3]) / w;
    dV[k] = (swv[k] - point[k] * swv[3]) / w;
  }
  const normalVector = cross(dU, dV);
  const normalLength = length(normalVector);
  // A pole (a degenerate patch edge, as at a cap centre) has no unique normal.
  const normal = normalLength > 1e-12 ? normalVector.map(c => c / normalLength) : null;
  return { point, du: dU, dv: dV, normal, degenerate: normal === null };
}

export const clamp = (t, [a, b]) => t < a ? a : t > b ? b : t;

// Signed plane distance of the control net, scaled by weight. The rational
// numerator shares the sign of n.S - d because all weights are positive, so the
// convex-hull property makes a same-sign net a conservative "no section" test.
export function planeCoefficients(patch, normal, offset) {
  const { nu, nv, cp } = patch, c = new Float64Array(nu * nv);
  for (let i = 0; i < nu * nv; i++) {
    const b = i * 4;
    c[i] = normal[0] * cp[b] + normal[1] * cp[b + 1] + normal[2] * cp[b + 2] - offset * cp[b + 3];
  }
  return c;
}

// The section's zero set is exactly the zero set of the NUMERATOR spline
//   h(u,v) = sum N_i(u) N_j(v) c_ij,   c_ij = w_ij (n . P_ij - d)
// because the rational denominator is strictly positive. h is an ordinary
// polynomial B-spline, so it can be evaluated cheaply and, more importantly,
// its gradient can be bounded rigorously - which is what lets a cell be culled
// with a guarantee rather than a sampling heuristic.
export function evaluateScalar(patch, coefficients, u, v) {
  const { nu, nv, orderU, orderV, knotsU, knotsV } = patch;
  const du = clamp(u, patch.domainU), dv = clamp(v, patch.domainV);
  const spanU = findSpan(knotsU, nu, orderU, du), spanV = findSpan(knotsV, nv, orderV, dv);
  const bu = basisFunctions(knotsU, spanU, du, orderU);
  const bv = basisFunctions(knotsV, spanV, dv, orderV);
  let sum = 0;
  for (let i = 0; i < orderU; i++) {
    const iu = spanU - orderU + 1 + i;
    for (let j = 0; j < orderV; j++) sum += bu[i] * bv[j] * coefficients[iu * nv + spanV - orderV + 1 + j];
  }
  return sum;
}

// Bound |dh/du| and |dh/dv| over one knot span from the control coefficients.
// For a B-spline the derivative is itself a B-spline whose coefficients are
// degree * delta(c) / knot span, and the convex hull property bounds it by the
// largest such coefficient. The bound is conservative, never optimistic.
export function gradientBound(patch, coefficients, span) {
  const { nu, nv, orderU, orderV, knotsU, knotsV } = patch;
  const iu = findSpan(knotsU, nu, orderU, span.u[0]), iv = findSpan(knotsV, nv, orderV, span.v[0]);
  const u0 = Math.max(0, iu - orderU + 1), v0 = Math.max(0, iv - orderV + 1);
  const u1 = Math.min(nu - 1, iu), v1 = Math.min(nv - 1, iv);
  const degreeU = orderU - 1, degreeV = orderV - 1;
  let boundU = 0, boundV = 0;
  for (let i = u0; i <= u1; i++)
    for (let j = v0; j <= v1; j++) {
      if (i < u1) {
        const width = knotsU[i + orderU] - knotsU[i + 1];
        if (width > 1e-12) boundU = Math.max(boundU, degreeU * Math.abs(coefficients[(i + 1) * nv + j] - coefficients[i * nv + j]) / width);
      }
      if (j < v1) {
        const width = knotsV[j + orderV] - knotsV[j + 1];
        if (width > 1e-12) boundV = Math.max(boundV, degreeV * Math.abs(coefficients[i * nv + j + 1] - coefficients[i * nv + j]) / width);
      }
    }
  return { u: boundU, v: boundV };
}

// Knot spans that the plane can cross, by the convex hull of each span's
// contributing control points. Same-sign spans are culled exactly.
export function candidateSpans(patch, coefficients) {
  const { nu, nv, orderU, orderV, knotsU, knotsV } = patch, spans = [];
  for (let su = orderU - 1; su < nu; su++) {
    if (knotsU[su + 1] - knotsU[su] < 1e-12) continue;
    for (let sv = orderV - 1; sv < nv; sv++) {
      if (knotsV[sv + 1] - knotsV[sv] < 1e-12) continue;
      let min = Infinity, max = -Infinity;
      for (let i = su - orderU + 1; i <= su; i++) {
        for (let j = sv - orderV + 1; j <= sv; j++) {
          const value = coefficients[i * nv + j];
          if (value < min) min = value;
          if (value > max) max = value;
        }
      }
      if (min <= 0 && max >= 0) spans.push({ u: [knotsU[su], knotsU[su + 1]], v: [knotsV[sv], knotsV[sv + 1]] });
    }
  }
  return spans;
}
