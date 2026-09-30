// Coordinate conversion and one native-memory boundary for planar offsets,
// booleans and surface-offset cleanup. Native handles never leave this module.
import createClipper from 'clipper2-wasm';
import { requireThat } from '../geom/tolerance.mjs';
const clipper=await createClipper();

export const CLIPPER_PRECISION = 1e-9;
const LIMIT = 2 ** 50; // headroom within exactly representable JS integer coordinates
const round=value=>value<0?-Math.round(-value):Math.round(value);

export function clipperContext(regions, precision = CLIPPER_PRECISION, margin = 0, originOverride = null) {
  requireThat(Number.isFinite(precision) && precision > 0, 'Region precision must be positive and finite.');
  const points = regions.flat(2);
  requireThat(points.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)), 'Region coordinates must be finite 2D points.');
  requireThat(originOverride===null||(Array.isArray(originOverride)&&originOverride.length===2&&originOverride.every(Number.isFinite)),'Region origin must be a finite 2D point.');
  const origin = originOverride??(points.length ? points.reduce((a,p)=>[Math.min(a[0],p[0]),Math.min(a[1],p[1])],[Infinity,Infinity]) : [0,0]);
  requireThat(points.every(p => p.every((v, k) => (Math.abs(v - origin[k]) + margin) / precision < LIMIT)),
    'Region coordinate range exceeds Clipper precision; increase precisionMm or use a smaller coordinate span.');
  const encode = loops => loops.map(loop => loop.map(p => ({
    X: round((p[0] - origin[0]) / precision),
    Y: round((p[1] - origin[1]) / precision)
  })));
  const decode = paths => canonicalLoops(paths.map(loop => loop.map(p => [origin[0] + p.X * precision, origin[1] + p.Y * precision])));
  const decodeOpen = paths => paths.map(path => path.map(p => [origin[0] + p.X * precision, origin[1] + p.Y * precision]));
  return { encode, decode, decodeOpen, precision };
}

// Stable seams and component order make output independent of Clipper's scan
// order without changing winding, topology, or deleting small material regions.
export function canonicalLoops(loops) {
  const compare = (a, b) => a[0] - b[0] || a[1] - b[1];
  return loops.filter(loop => loop.length >= 3).map(loop => {
    let first = 0;
    for (let i = 1; i < loop.length; i++) if (compare(loop[i], loop[first]) < 0) first = i;
    return [...loop.slice(first), ...loop.slice(0, first)];
  }).sort((a, b) => compare(a[0], b[0]) || a.length - b.length);
}

function encode(loops){
  const paths=new clipper.Paths64();
  try{
    for(const loop of loops){
      const coordinates=new BigInt64Array(loop.length*3);
      for(let i=0;i<loop.length;i++){coordinates[3*i]=BigInt(loop[i].X);coordinates[3*i+1]=BigInt(loop[i].Y);}
      const path=new clipper.Path64();
      try{path.assign(coordinates);paths.push_back(path);}finally{path.delete();}
    }
    return paths;
  }catch(error){paths.delete();throw error;}
}
function decode(paths){
  const result=[];
  for(let i=0;i<paths.size();i++){
    const path=paths.get(i);
    try{
      const coordinates=path.view(),loop=[];
      for(let j=0;j<coordinates.length;j+=3)loop.push({X:Number(coordinates[j]),Y:Number(coordinates[j+1])});
      result.push(loop);
    }finally{path.delete();}
  }
  return result;
}
export function clipPaths(subject, clip = [], operation = 'union', {open=false} = {}) {
  requireThat(['union','difference','intersection'].includes(operation), 'Unsupported offset cleanup operation.');
  requireThat(typeof open==='boolean','Clipper open option must be boolean.');
  const owned=[],own=object=>(owned.push(object),object);
  try{
    const a=own(encode(subject)),b=own(encode(clip)),engine=own(new clipper.Clipper64()),result=own(new clipper.Paths64());
    engine.SetPreserveCollinear(false);
    if(open)engine.AddOpenSubject(a);else engine.AddSubject(a);
    engine.AddClip(b);
    const closed=open?own(new clipper.Paths64()):null;
    const kind={union:'Union',difference:'Difference',intersection:'Intersection'}[operation];
    requireThat(open?engine.ExecutePath(clipper.ClipType[kind],clipper.FillRule.NonZero,closed,result):
      engine.ExecutePath(clipper.ClipType[kind],clipper.FillRule.NonZero,result),'Clipper2 region operation failed.');
    return decode(result);
  }finally{for(const object of owned.reverse())object.delete();}
}

export function offsetPaths(paths, delta, { join, miterLimit, arcTolerance, end='Polygon' }) {
  const input=encode(paths);let result;
  try{
    result=clipper.InflatePaths64(input,delta,clipper.JoinType[{round:'Round',square:'Square',miter:'Miter'}[join]],
      clipper.EndType[end],miterLimit,arcTolerance);
    return decode(result);
  }finally{result?.delete();input.delete();}
}

// Offsets require normalized input. Keep that union's exact native result in
// native memory for inflation instead of decoding it into JS and immediately
// encoding the same coordinates again. Both kernel operations still run.
export function normalizedOffsetPaths(paths,delta,{join,miterLimit,arcTolerance}){
  const owned=[],own=object=>(owned.push(object),object);
  try{
    const input=own(encode(paths)),engine=own(new clipper.Clipper64()),normalized=own(new clipper.Paths64());
    engine.SetPreserveCollinear(false);engine.AddSubject(input);
    requireThat(engine.ExecutePath(clipper.ClipType.Union,clipper.FillRule.NonZero,normalized),'Clipper2 region operation failed.');
    if(!normalized.size()||delta===0)return decode(normalized);
    const result=own(clipper.InflatePaths64(normalized,delta,clipper.JoinType[{round:'Round',square:'Square',miter:'Miter'}[join]],
      clipper.EndType.Polygon,miterLimit,arcTolerance));
    return decode(result);
  }finally{for(const object of owned.reverse())object.delete();}
}

export function simplifyPaths(paths,epsilon,closed=true){
  const input=encode(paths);let result;
  try{result=clipper.SimplifyPaths64(input,epsilon,closed);return decode(result);}
  finally{result?.delete();input.delete();}
}
