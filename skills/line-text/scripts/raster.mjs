import {crc32, deflateSync} from 'node:zlib';

// A small anti-aliased stroke rasterizer and PNG encoder, so a preview is a real
// image any chat client can show without an SVG renderer or a graphics library.
// Coordinates are pixels, y down. A shape is an open or closed polyline drawn with
// round caps and joins at a width; shapes of one group union rather than darken.

export function rasterize({widthPx, heightPx, groups, background = [255, 255, 255]}) {
  const rgb = Buffer.alloc(widthPx * heightPx * 3);
  for (let i = 0; i < rgb.length; i += 3) { rgb[i] = background[0]; rgb[i + 1] = background[1]; rgb[i + 2] = background[2]; }
  for (const {shapes, color} of groups) {
    const coverage = new Float32Array(widthPx * heightPx);
    for (const {points, closed = false, widthPx: w} of shapes) {
      const r = Math.max(w, 0.6) / 2, pts = closed ? [...points, points[0]] : points.length === 1 ? [points[0], points[0]] : points;
      for (let i = 1; i < pts.length; i++) {
        const [a, b] = [pts[i - 1], pts[i]];
        const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0]) - r - 1)), x1 = Math.min(widthPx - 1, Math.ceil(Math.max(a[0], b[0]) + r + 1));
        const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1]) - r - 1)), y1 = Math.min(heightPx - 1, Math.ceil(Math.max(a[1], b[1]) + r + 1));
        const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const px = x + 0.5, py = y + 0.5, t = len2 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / len2)) : 0;
          const d = Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy), alpha = Math.max(0, Math.min(1, r + 0.5 - d));
          const k = y * widthPx + x;
          if (alpha > coverage[k]) coverage[k] = alpha;
        }
      }
    }
    for (let k = 0; k < coverage.length; k++) {
      const a = coverage[k];
      if (a <= 0) continue;
      for (let c = 0; c < 3; c++) rgb[k * 3 + c] = Math.round(rgb[k * 3 + c] * (1 - a) + color[c] * a);
    }
  }
  return rgb;
}

const chunk = (type, data) => {
  const head = Buffer.alloc(4), tail = Buffer.alloc(4), name = Buffer.from(type);
  head.writeUInt32BE(data.length);
  tail.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([head, name, data, tail]);
};

export function encodePng(widthPx, heightPx, rgb) {
  const stride = widthPx * 3, raw = Buffer.alloc(heightPx * (stride + 1));
  for (let y = 0; y < heightPx; y++) rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride); // filter byte 0 per row
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(widthPx); ihdr.writeUInt32BE(heightPx, 4); ihdr[8] = 8; ihdr[9] = 2; // 8-bit truecolor
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, {level: 9})), chunk('IEND', Buffer.alloc(0))]);
}
