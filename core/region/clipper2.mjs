// One compiled kernel and one native-memory boundary for offsets and booleans.
// Skills use the mm/UV adapters, never native handles or a second kernel.
import createClipper from 'clipper2-wasm';
import {requireThat} from '../geom/tolerance.mjs';
const clipper=await createClipper();

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
export function booleanPaths(subject,clip,operation,{open=false}={}){
  const owned=[],own=object=>(owned.push(object),object);
  try{
    const a=own(encode(subject)),b=own(encode(clip)),engine=own(new clipper.Clipper64()),result=own(new clipper.Paths64());
    engine.SetPreserveCollinear(false);
    if(open)engine.AddOpenSubject(a);else engine.AddSubject(a);
    engine.AddClip(b);
    const closed=open?own(new clipper.Paths64()):null;
    requireThat(open?engine.ExecutePath(clipper.ClipType[operation],clipper.FillRule.NonZero,closed,result):
      engine.ExecutePath(clipper.ClipType[operation],clipper.FillRule.NonZero,result),'Clipper2 region operation failed.');
    return decode(result);
  }finally{for(const object of owned.reverse())object.delete();}
}
export function inflatePaths(paths,delta,{join,miterLimit,arcTolerance}){
  const input=encode(paths);let result;
  try{
    result=clipper.InflatePaths64(input,delta,clipper.JoinType[{round:'Round',square:'Square',miter:'Miter'}[join]],
      clipper.EndType.Polygon,miterLimit,arcTolerance);
    return decode(result);
  }finally{result?.delete();input.delete();}
}

export function simplifyPaths(paths,epsilon,closed=true){
  const input=encode(paths);let result;
  try{result=clipper.SimplifyPaths64(input,epsilon,closed);return decode(result);}
  finally{result?.delete();input.delete();}
}

// Offsets require normalized input. Keep that union's exact native result in
// native memory for inflation instead of decoding it into JS and immediately
// encoding the same coordinates again. Both kernel operations still run.
export function normalizeAndInflatePaths(paths,delta,{join,miterLimit,arcTolerance}){
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
