import assert from "node:assert/strict";
import test from "node:test";
import { generate } from "../../operations/additive/planar/layer-filling/generator.mjs";
import { rasterRegions, orderRaster } from "../../operations/additive/planar/layer-filling/ordering.mjs";
import { withTravel } from "../../operations/travel.mjs";
import { isTravelMove } from "../../interfaces/trace-player/player.mjs";
import { translate } from "../../machines/dobot-stop/postprocessor/generator.mjs";

test("fill ordering preserves all strokes and visits each side of a hole once", () => {
  const lines = [];
  for (let y = -6; y <= 6; y++) {
    const spans = Math.abs(y) < 4 ? [[-10, -4], [4, 10]] : [[-10, 10]];
    for (const [a, b] of spans) lines.push([{ x: a, y, z: 1 }, { x: b, y, z: 1 }]);
  }
  assert.equal(rasterRegions(lines, 0).length, 4);
  const sorted = orderRaster(lines, 0, { x: 10, y: 0, z: 1 });
  const normalize = paths => paths.map(points => JSON.stringify([...points].sort((a,b) => a.x-b.x))).sort();
  assert.deepEqual(normalize(sorted), normalize(lines));
  const sides = sorted.filter(p => Math.abs(p[0].y) < 4).map(p => Math.sign(p[0].x));
  assert.equal(sides.filter((s,i) => i && s !== sides[i-1]).length, 1);
});

test("circle and bore loops honor wallCount and fill clears the innermost loop by spacing", () => {
  for (const wallCount of [1, 2, 4]) {
    const beadWidth = 0.8, spacing = 0.78;
    const { paths } = generate({ parameters: { outerDiameter: 50, innerDiameter: 12, wallCount, layers: 2 }, settings: { beadWidth, spacing } });
    assert.equal(paths.filter(p => p.family === "Outer perimeter").length, wallCount * 2);
    assert.equal(paths.filter(p => p.family === "Inner perimeter").length, wallCount * 2);
    const outer = 25 - beadWidth/2 - wallCount*spacing;
    const inner = 6 + beadWidth/2 + wallCount*spacing;
    for (const path of paths.filter(p => p.family === "Region-first raster")) {
      for (const p of path.points) assert.ok(Math.hypot(p.x,p.y) <= outer+1e-4);
      const [a,b] = path.points;
      const dx=b.x-a.x,dy=b.y-a.y;
      const t=Math.max(0,Math.min(1,-(a.x*dx+a.y*dy)/(dx*dx+dy*dy)));
      assert.ok(Math.hypot(a.x+t*dx,a.y+t*dy) >= inner-1e-4, "whole stroke must clear the bore, not just its endpoints");
    }
  }
});

test("travel lifts vertically above prior printed height, crosses, and descends without changing print strokes", () => {
  const paths=[{family:'A',layer:0,intent:'print',points:[{x:0,y:0,z:8},{x:4,y:0,z:2}]},{family:'B',layer:1,intent:'print',points:[{x:10,y:0,z:1},{x:12,y:0,z:1}]}];
  const result=withTravel(paths,2);
  assert.deepEqual(result.filter(p=>p.intent==='print'),paths);
  assert.deepEqual(result[1].points,[{x:4,y:0,z:2},{x:4,y:0,z:10},{x:10,y:0,z:10},{x:10,y:0,z:1}]);
  assert.throws(()=>withTravel(paths,-1),/non-negative/);
});

test("travel classification ignores speed and retains continuous-extrusion travel intent", () => {
  assert.equal(isTravelMove({intent:'travel',extruding:true,speedMmS:10}),true);
  assert.equal(isTravelMove({intent:'print',extruding:true,speedMmS:10}),false);
  assert.equal(isTravelMove({extruding:false,speedMmS:10}),true);
});

test("a curved region prints its adjacent connections, including long front-edge connections", () => {
  const { paths } = generate({ parameters: { outerDiameter: 40, innerDiameter: 16, layers: 1, wallCount: 2 }, settings: { travelHopHeight: 1.5 } });
  const connections = paths.filter(p => p.family === "Raster connection");
  assert.ok(connections.length > 20);
  assert.ok(connections.some(p => Math.hypot(p.points[1].x-p.points[0].x,p.points[1].y-p.points[0].y) > 2), "long front-edge links must also print");
  for (let i = 0; i < paths.length; i++) {
    if (paths[i].family !== "Raster connection") continue;
    assert.equal(paths[i].intent,"print");
    assert.equal(paths[i-1].family,"Region-first raster");
    assert.equal(paths[i+1].family,"Region-first raster");
    assert.deepEqual(paths[i-1].points.at(-1),paths[i].points[0]);
    assert.deepEqual(paths[i].points.at(-1),paths[i+1].points[0]);
  }
});

test("dobot_stop refuses unapproved plans and plans belonging to another machine", () => {
  assert.throws(()=>translate({plan:{machine:{id:'dobot-stop'}}}),/no approval/);
  assert.throws(()=>translate({plan:{machine:{id:'reference-dobot-mg400-struderbot'}}}),/only accepts/);
});
