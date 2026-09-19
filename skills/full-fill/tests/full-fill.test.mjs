import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import rhino3dm from 'rhino3dm';
import { defaults } from '../../../core/print/plan.mjs';
import { buildShell, translateShell } from '../../../core/print/generate.mjs';
import {createPlanningState,planningPath} from '../../../core/path/planning.mjs';
import {planComposition} from '../../../core/path/compose.mjs';
import { fullFillResult,layerHeights } from '../scripts/fill.mjs';
import { sectionShell } from '../../../core/geom/shell.mjs';
import { regionArea } from '../../../core/region/region2d.mjs';

test('machine wall precision changes deposition only and rebuilds variable-gap metadata on retained chords',()=>{
  const plan=defaults();plan.skills['full-fill'].perimeters=2;
  const circle=Array.from({length:360},(_,i)=>[20+10*Math.cos(i*Math.PI/180),20+10*Math.sin(i*Math.PI/180)]);
  const shell={bounds:{min:[10,10,0],max:[30,30,.4]}},sectionAt=()=>({loops:[circle]});
  const lowerSurface={footprint:[[[0,0],[40,0],[40,40],[0,40]]],field:{xs:[0,40],ys:[0,40],values:[[.05,.05],[.13,.13]]},topAt:(x,y)=>.05+.002*x};
  const options={shell,plan,sectionAt};
  const exact=fullFillResult({...options,machine:{planarWallToleranceMm:0}});
  const reduced=fullFillResult({...options,machine:{planarWallToleranceMm:.01}});
  const count=result=>result.operations.flatMap(op=>op.strokes.filter(s=>s.closed)).reduce((n,s)=>n+s.points.length,0);
  assert.ok(count(reduced)<count(exact)/2);
  assert.deepEqual(reduced.operations.map(op=>op.materialRegion),exact.operations.map(op=>op.materialRegion));
  assert.deepEqual(reduced.operations.filter(op=>op.id.endsWith(':fill')).map(op=>op.strokes),exact.operations.filter(op=>op.id.endsWith(':fill')).map(op=>op.strokes));
  assert.deepEqual(fullFillResult(options).operations.map(op=>op.strokes),reduced.operations.map(op=>op.strokes),'old snapshots and standalone callers use the approved default');
  const surfaced=fullFillResult({...options,machine:{planarWallToleranceMm:.01},lowerSurface});
  for(const op of surfaced.operations)for(const stroke of op.strokes)for(let i=1;i<stroke.points.length;i++){
    const a=stroke.points[i-1],b=stroke.points[i],height=op.layer===0?plan.process.firstLayerMm:plan.process.layerMm;
    const ga=Math.min(height,a[2]-lowerSurface.topAt(a[0],a[1])),gb=Math.min(height,b[2]-lowerSurface.topAt(b[0],b[1]));
    const expected=Math.hypot(...b.map((v,k)=>v-a[k]))*plan.process.lineWidthMm*(ga+gb)/2;
    assert.ok(Math.abs(stroke.volumesMm3[i-1]-expected)<1e-10);
    assert.ok(Math.abs(stroke.segmentMetadata[i-1].gapMm-(ga+gb)/2)<1e-10);
  }
});

test('layer heights follow the part and the layer height, with no supported layer limit',()=>{
  const process={firstLayerMm:0.2,layerMm:0.06};
  // 1800 mm at the finest layer height: far past the retired 20,000-layer cap.
  const heights=layerHeights(process,0,1800);
  assert.equal(heights.length,29997);
  assert.ok(Math.abs(heights.at(-1)-1799.96)<1e-9);
  assert.throws(()=>layerHeights({firstLayerMm:0.2,layerMm:0},0,10),/never advance/);
});

const rhino = await rhino3dm();
const machine = JSON.parse(readFileSync('machines/ultimaker-s5.json', 'utf8'));

test('repeated contour reuse preserves changed coordinates, holes, settings and independent layer output',()=>{
  const outer=[[0,0],[12,0],[12,12],[0,12]],hole=[[2,2],[2,10],[10,10],[10,2]];
  const regions=Array.from({length:20},(_,i)=>[outer,hole].map(loop=>loop.map(([x,y])=>[x+i*0.00001,y])));
  // Revisit an evicted entry, then repeat it; use one mutable section container
  // so object identity cannot stand in for the content of each queried layer.
  const sequence=[...regions,regions[0],regions[0],regions[7]],active=[];
  for(const [width,perimeters] of [[0.4,2],[0.42,3]]){
    const plan=defaults();plan.process.lineWidthMm=width;plan.skills['full-fill'].perimeters=perimeters;
    const heights=sequence.map((_,i)=>plan.process.firstLayerMm+i*plan.process.layerMm);
    const shell={bounds:{min:[0,0,0],max:[13,13,heights.at(-1)]}};
    const sectionAt=z=>{const i=Math.round((z-plan.process.firstLayerMm)/plan.process.layerMm);active.splice(0,active.length,...structuredClone(sequence[i]));return {loops:active};};
    const together=fullFillResult({shell,plan,sectionAt});
    for(const [i,z] of heights.entries()){
      const alone=fullFillResult({shell,plan,sectionAt:()=>({loops:structuredClone(sequence[i])}),zStartMm:z-plan.process.layerMm/2,zEndMm:z});
      assert.deepEqual(together.operations.filter(op=>op.layer===i).map(op=>op.strokes),alone.operations.map(op=>op.strokes));
    }
    const first=together.operations[0].strokes[0].points;
    const last=together.operations.filter(op=>op.layer===heights.length-1)[0].strokes[0].points;
    assert.notDeepEqual(first,last,'micrometre changes do not reuse a different contour');
  }
});

function planFor(geometry, overrides = {}) {
  const plan = defaults();
  // Each shape has its own parameter set; replace rather than merge.
  plan.geometry = { ...geometry };
  plan.skills['draped-skin'] = { ...plan.skills['draped-skin'], enabled: false };
  plan.skills['full-fill'] = { ...plan.skills['full-fill'], ...overrides };
  return plan;
}

function run(plan) {
  const shell = translateShell(buildShell(rhino, plan.geometry), plan.placement.xMm, plan.placement.yMm);
  const initial = createPlanningState({
    start: [...machine.tools[plan.setup.tool].startupXY, machine.startup.zAfterStartupMm],
    process: plan.process, machine, generatorVersion: 'test'
  });
  const result = fullFillResult({ shell, plan, reserve: null });
  const composed=planComposition(initial,[result]);
  return { shell, state:composed.state, report:result.report, path:planningPath(composed.state,[composed.actions]) };
}

test('the pattern follows each shape, not a fixed outline', () => {
  const wedge = run(planFor({ shape: 'wedge', runMm: 20, widthMm: 12, baseMm: 2, angleDeg: 15 }));
  assert.ok(wedge.report.layers > 10);
  // A wedge narrows with height, so later layers carry fewer fill rows.
  const rows = new Map();
  for (const action of wedge.path.actions)
    if (action.kind === 'move' && action.role === 'fill') rows.set(action.layer, (rows.get(action.layer) ?? 0) + 1);
  const layers = [...rows.keys()].sort((a, b) => a - b);
  assert.ok(rows.get(layers[layers.length - 1]) < rows.get(layers[0]), 'the top of a wedge holds less fill than the base');

  const dome = run(planFor({ shape: 'spline-top', runMm: 18, widthMm: 14, cpU: 4, cpV: 4, heightsMm: [[4, 4, 4, 4], [4, 5.5, 5.5, 4], [4, 5.5, 5.5, 4], [4, 4, 4, 4]] }));
  assert.ok(dome.report.layers > 10);
  assert.ok(dome.report.fillRows > 100);
});

test('each layer is filled solid within a bead of its own cross section', () => {
  const plan = planFor({ shape: 'box', runMm: 20, widthMm: 15, heightMm: 3 });
  const { shell, path } = run(plan);
  const width = plan.process.lineWidthMm;
  const deposited = new Map();
  for (const action of path.actions)
    if (action.kind === 'move' && action.volumeMm3 > 0)
      deposited.set(action.layer, (deposited.get(action.layer) ?? 0) + action.volumeMm3);
  const section = sectionShell(shell, 1.0);
  const expected = Math.abs(regionArea(section.loops)) * plan.process.layerMm;
  const middle = deposited.get(4);
  // Solid fill deposits the layer's own volume, allowing for the perimeter
  // overlap and the half bead the outline stands in from the wall.
  assert.ok(middle > expected * 0.85 && middle < expected * 1.05, `layer volume ${middle} against ${expected}`);
});

test('fill direction alternates between layers', () => {
  const plan = planFor({ shape: 'box', runMm: 20, widthMm: 15, heightMm: 2 }, { fillAnglesDeg: [0, 90] });
  const { path } = run(plan);
  const spread = layer => {
    const strokes = path.actions.filter(action => action.kind === 'move' && action.role === 'fill' && action.layer === layer);
    assert.ok(strokes.length > 4, `layer ${layer} has fill`);
    return {
      x: new Set(strokes.map(action => action.to[0].toFixed(3))).size,
      y: new Set(strokes.map(action => action.to[1].toFixed(3))).size
    };
  };
  // Rows run along X at 0 degrees, so they end at many distinct Y values and
  // only two distinct X values. At 90 degrees that is the other way round.
  const flat = spread(2), upright = spread(3);
  assert.ok(flat.y > flat.x, `0 degree layer: ${flat.y} distinct Y against ${flat.x} distinct X`);
  assert.ok(upright.x > upright.y, `90 degree layer: ${upright.x} distinct X against ${upright.y} distinct Y`);
});

test('travel between fill strokes stays down instead of lifting over the part', () => {
  const plan = planFor({ shape: 'box', runMm: 25, widthMm: 20, heightMm: 2 });
  const { state } = run(plan);
  const stats = state.stats;
  assert.ok(stats.connected > 20 * (stats.hopped+stats.combed), `connected ${stats.connected} against combed ${stats.combed}, hopped ${stats.hopped}`);
  // Neighboring rows and walls continue as deposition, so retraction is rare.
  assert.ok(stats.retractions < stats.connected / 20, `retractions ${stats.retractions}`);
  assert.ok(stats.travelMm < stats.printMm / 5, `travel ${stats.travelMm} against print ${stats.printMm}`);
});

test('lifted traverses clear deposited material without anticipating the finished part', () => {
  const plan = planFor({ shape: 'wedge', runMm: 20, widthMm: 12, baseMm: 2, angleDeg: 15 });
  plan.process.maxCombMm=0;
  const { shell, path } = run(plan);
  let lifted=0,early=0,nearby=0,connected=0,high=0,previous=path.initialPosition;
  for(const action of path.actions) {
    if(action.kind!=='move')continue;
    if(action.volumeMm3>0){high=Math.max(high,previous[2],action.to[2]);if(action.connector){connected++;assert.ok(Math.hypot(...action.to.map((v,i)=>v-previous[i]))<=2+1e-7);}}
    else if(action.travel==='combed') {
      assert.ok(Math.hypot(...action.to.map((v,i)=>v-previous[i]))<=1+1e-7,'only nearby moves override a zero long-combing budget');
      assert.ok(Math.abs(action.to[2]-previous[2])<1e-7);nearby++;
    } else if(action.travel==='layer-step') {
      assert.ok(Math.hypot(...action.to.map((v,i)=>v-previous[i]))<=2+1e-7&&action.to[2]>previous[2]&&previous[2]>=high-1e-7,'a nearby next layer is one rising move from the top of the deposit');
    } else if(Math.hypot(action.to[0]-previous[0],action.to[1]-previous[1])>1e-6) {
      assert.ok(Math.abs(action.to[2]-previous[2])<1e-7);
      assert.ok(action.to[2]>=high+plan.process.liftMm-1e-7);lifted++;
      if(action.to[2]<shell.bounds.max[2])early++;
    }
    previous=action.to;
  }
  // Nearby row and wall starts now continue as deposition rather than travel.
  assert.ok(lifted>0&&early>0&&connected>0&&nearby===0);
});

test('an unsupported layer height or missing setting is rejected before generation', async () => {
  const { validatePlan } = await import('../../../core/print/plan.mjs');
  const plan = planFor({ shape: 'box', runMm: 20, widthMm: 15, heightMm: 3 });
  plan.skills['full-fill'].perimeters = 2.5;
  assert.throws(() => validatePlan(plan, machine), /perimeters must be an integer/);
  const spelling = planFor({ shape: 'box', runMm: 20, widthMm: 15, heightMm: 3 });
  spelling.skills['full-fill'].perimiters = 2;
  assert.throws(() => validatePlan(spelling, machine), /Unexpected or missing fields/);
});

test('a wall count above the rarely-useful advice is accepted and printed', async () => {
  const { validatePlan } = await import('../../../core/print/plan.mjs');
  const geometry = { shape: 'box', runMm: 20, widthMm: 15, heightMm: 1 };
  const plan = planFor(geometry, { perimeters: 10 });
  validatePlan(plan, machine);
  const closedOn = result => result.path.actions.filter(a => a.volumeMm3 > 0 && a.role?.startsWith('perimeter') && a.to[2] < plan.process.firstLayerMm + 1e-9).length;
  assert.ok(closedOn(run(plan)) > closedOn(run(planFor(geometry, { perimeters: 2 }))), 'ten loops deposit more wall than two');
  const negative = planFor(geometry, { perimeters: -1 });
  assert.throws(() => validatePlan(negative, machine), /perimeters must be zero or more/);
});
