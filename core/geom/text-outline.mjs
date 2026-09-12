import {create} from 'fontkit';
import {createHash} from 'node:crypto';
import {requireThat} from './tolerance.mjs';
import {union} from '../region/intersection.mjs';
import {offsetRegion} from '../region/offset.mjs';

const midpoint=(a,b)=>a.map((v,i)=>(v+b[i])/2);
const distanceToSegment=(p,a,b)=>{
  const d=b.map((v,i)=>v-a[i]),q=p.map((v,i)=>v-a[i]),length=d.reduce((s,v)=>s+v*v,0);
  const t=length?Math.max(0,Math.min(1,q.reduce((s,v,i)=>s+v*d[i],0)/length)):0;
  return Math.hypot(...p.map((v,i)=>v-a[i]-t*d[i]));
};
export function flattenBezier(points,toleranceMm,output,depth=0,parameters=null,t0=0,t1=1){
  if(points.slice(1,-1).every(p=>distanceToSegment(p,points[0],points.at(-1))<=toleranceMm)){output.push(points.at(-1));parameters?.push(t1);return;}
  requireThat(depth<24,'Text curve subdivision exceeded its depth budget.');
  const left=[points[0]],right=[points.at(-1)];let row=points;
  while(row.length>1){row=row.slice(1).map((p,i)=>midpoint(row[i],p));left.push(row[0]);right.unshift(row.at(-1));}
  const tm=(t0+t1)/2;
  flattenBezier(left,toleranceMm,output,depth+1,parameters,t0,tm);flattenBezier(right,toleranceMm,output,depth+1,parameters,tm,t1);
}
export function textOutlines(feature,toleranceMm){
  const bytes=Buffer.from(feature.font.data,'base64');
  requireThat(bytes.length>0&&bytes.length<=32*1024*1024&&createHash('sha256').update(bytes).digest('hex')===feature.font.sha256,'Text font bytes or hash are invalid.');
  let font=create(bytes,feature.font.postscriptName??undefined);
  requireThat(font?.layout,'Choose postscriptName for a font collection.');
  if(Object.keys(feature.variation).length){
    for(const [axis,value] of Object.entries(feature.variation)){
      const range=font.variationAxes[axis];requireThat(range&&Number.isFinite(value)&&value>=range.min&&value<=range.max,'Invalid font variation axis: '+axis);
    }
    font=font.getVariation(feature.variation);
  }
  const scale=feature.sizeMm/font.unitsPerEm,glyphs=[];
  const lines=feature.text.split('\n');
  lines.forEach((line,lineIndex)=>{
    const run=font.layout(line,feature.features,feature.script??undefined,feature.language??undefined,feature.direction??undefined);
    requireThat(run.glyphs.every(g=>g.id!==0),'Selected font is missing a requested glyph. Choose a font with those characters.');
    const width=run.positions.reduce((s,p)=>s+p.xAdvance*scale,0)+Math.max(0,run.glyphs.length-1)*feature.letterSpacingMm;
    let x=feature.align==='center'?-width/2:feature.align==='right'?-width:0,y=-lineIndex*feature.lineHeightMm;
    run.glyphs.forEach((glyph,index)=>{
      const position=run.positions[index],loops=[];let loop=[],point;
      const xy=(a,b)=>[(a+position.xOffset)*scale+x,(b+position.yOffset)*scale+y];
      const finish=()=>{if(loop.length>1&&Math.hypot(...loop[0].map((v,i)=>v-loop.at(-1)[i]))<1e-10)loop.pop();if(loop.length>=3)loops.push(loop);loop=[];};
      for(const {command,args} of glyph.path.commands){
        if(command==='moveTo'){finish();point=xy(...args);loop.push(point);}
        else if(command==='lineTo'){point=xy(...args);loop.push(point);}
        else if(command==='quadraticCurveTo'||command==='bezierCurveTo'){
          const points=[point];for(let i=0;i<args.length;i+=2)points.push(xy(args[i],args[i+1]));
          flattenBezier(points,toleranceMm,loop);point=points.at(-1);
        }else if(command==='closePath')finish();
        else throw new Error('Unsupported font outline command: '+command);
      }
      finish();
      // Empty outlines for whitespace are expected. Bitmap/color-only glyphs
      // with visible characters must not silently become missing geometry.
      if(!loops.length)requireThat(glyph.codePoints?.every(cp=>/\s|\p{Default_Ignorable_Code_Point}/u.test(String.fromCodePoint(cp))),'Glyph has no supported vector outline.');
      if(loops.length){
        let normalized=union(loops,[]);
        if(feature.outlineOffsetMm)normalized=offsetRegion(normalized,feature.outlineOffsetMm,{arcToleranceMm:toleranceMm});
        requireThat(normalized.length>0,'outlineOffsetMm removed a glyph completely; reduce its magnitude.');
        glyphs.push({loops:normalized,anchor:[x+position.xAdvance*scale/2,y]});
      }
      x+=position.xAdvance*scale+feature.letterSpacingMm;y+=position.yAdvance*scale;
    });
  });
  requireThat(glyphs.length>0,'Text needs at least one visible outline glyph.');
  return {glyphs,loops:union(glyphs.flatMap(g=>g.loops),[]),fontName:font.postscriptName};
}
