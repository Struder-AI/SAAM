// Shared pattern names and scalar-contour clipping. All surface pattern
// construction is owned by surface-patterns.mjs.
import {clipLineToRegion} from '../geom/curve-region.mjs';
import {requireThat} from '../geom/tolerance.mjs';
import {ROUNDING_RELATIVE} from '../dimensions.mjs';
import {extractLevelSet} from '../geom/level-set.mjs';
import {interpolateDirection,interpolateDirectionPair,cross} from '../geom/frame.mjs';
import {keyed,profileAt} from '../path/curve-profiles.mjs';
export const FILL_PATTERNS=['rectilinear','grid','triangles','concentric','gyroid'];

// Contours retain chart coordinates; callers may evaluate the scalar in XYZ.
export function sampledFieldStrokes({xs,ys,values},region) {
  const curves=extractLevelSet({xs,ys,values},0,{output:'curves'});
  return clipPatternCurves(curves,region);
}

// Clip in source traversal order. Segment parameters accompany every retained
// vertex, so a crossing or retrace never has to be matched by nearest position.
// Vertex laws interpolate at new endpoints; segment values retain their source.
export function clipPatternCurves(curves,region,{precisionUv=ROUNDING_RELATIVE}={}){
  requireThat(Number.isFinite(precisionUv)&&precisionUv>0,'Pattern clipping needs a positive chart precision.');
  if(!region.length)return [];
  const near=(a,b)=>Math.hypot(...a.map((v,k)=>v-b[k]))<=precisionUv;
  const pointFields=['cellWidthsMm','curveParameters','normals','chartPoints','referenceAlong','frameSamples'];
  const segmentFields=['widthsMm','heightsMm','flowMultipliers','segmentMetadata'];
  const interpolate=(a,b,t)=>{
    if(t===0)return a;if(t===1)return b;
    if(typeof a==='number'&&typeof b==='number')return a+(b-a)*t;
    if(Array.isArray(a)&&Array.isArray(b)&&a.length===b.length)return a.map((v,k)=>interpolate(v,b[k],t));
    if(a&&b&&typeof a==='object'&&typeof b==='object')return Object.fromEntries(Object.entries(a).map(([k,v])=>[k,interpolate(v,b[k],t)]));
    return a;
  };
  return curves.flatMap(curve=>{
    requireThat(typeof curve.closed==='boolean'&&curve.points?.length>=(curve.closed?3:2),'Pattern clipping needs an open or closed chart curve.');
    const repeated=curve.closed&&near(curve.points[0],curve.points.at(-1));
    const count=curve.points.length-(repeated?1:0),segments=count-(curve.closed?0:1),pieces=[];
    const lengths=[0];
    for(let i=0;i<segments;i++)lengths.push(lengths.at(-1)+Math.hypot(...curve.points[(i+1)%count].map((v,k)=>v-curve.points[i][k])));
    const ownParameters=curve.parameters??lengths.map(length=>length/lengths.at(-1));
    const address=t=>{
      let cycle=curve.closed?Math.floor(t/segments):0,local=t-cycle*segments;
      if(local===0&&t>0){cycle--;local=segments;}
      const i=Math.min(Math.floor(local),segments-1);
      return {cycle,i,fraction:local-i};
    };
    const sample=(values,t,field)=>{
      const {cycle,i,fraction}=address(t),last=i+1===count,j=last?values.length>count?count:0:i+1;
      const a=values[i],b=values[j];
      if(field==='sourceParameters'||field==='curveParameters'||field==='parameters'){
        const period=field==='parameters'?1:(curve.sourceParameterPeriod??1)*(values.at(-1)>=values[0]?1:-1);
        return interpolate(a,last&&j===0?b+period:b,fraction)+cycle*period;
      }
      if(field==='normals')return interpolateDirection(a,b,fraction);
      if(field==='frameSamples'&&fraction>0&&fraction<1){
        const frame=interpolate(a,b,fraction);
        if(a.normal&&a.u&&b.normal&&b.u){
          [frame.normal,frame.u]=interpolateDirectionPair([a.normal,a.u],[b.normal,b.u],fraction);frame.v=cross(frame.normal,frame.u);
        }else if(a.toolAxis&&a.toolUp&&b.toolAxis&&b.toolUp)
          [frame.toolAxis,frame.toolUp]=interpolateDirectionPair([a.toolAxis,a.toolUp],[b.toolAxis,b.toolUp],fraction);
        else for(const name of ['normal','u','v','toolAxis','toolUp'])if(a[name]&&b[name])frame[name]=interpolateDirection(a[name],b[name],fraction);
        return frame;
      }
      return interpolate(a,b,fraction);
    };
    const profiles=Object.values(curve.profiles??{}).filter(keyed);
    const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
    // A directional jump cannot be encoded as paired slerp/frame keys. Keep
    // the source seam as two endpoints in that case, with both laws intact.
    const seamJoinable=profiles.every(profile=>!['slerp','frame'].includes(profile.interpolation)||same(profileAt(profile,0),profileAt(profile,1)))&&
      pointFields.every(field=>field==='curveParameters'||!repeated||!curve[field]||same(curve[field][0],curve[field].at(-1)));
    let current=null;
    for(let i=0;i<segments;i++){
      const a=curve.points[i],b=curve.points[(i+1)%count],direction=b.map((v,k)=>v-a[k]);
      if(Math.hypot(...direction)<=precisionUv)continue;
      const clipped=clipLineToRegion(a,direction,region,{range:[0,1]}),spans=[];
      for(const span of [...clipped.spans,...clipped.contacts].filter(([lo,hi])=>hi>lo).sort((a,b)=>a[0]-b[0])){
        const last=spans.at(-1);
        if(last&&span[0]<=last[1])last[1]=Math.max(last[1],span[1]);else spans.push([...span]);
      }
      for(const [lo,hi] of spans){
        const first=a.map((v,k)=>v+lo*direction[k]),last=a.map((v,k)=>v+hi*direction[k]);
        if(near(first,last))continue;
        if(current&&Math.abs(current.parameters.at(-1)-(i+lo))<=precisionUv&&near(current.points.at(-1),first)){
          current.points.push(last);current.parameters.push(i+hi);current.segments.push(i);
        }else{current={points:[first,last],parameters:[i+lo,i+hi],segments:[i]};pieces.push(current);}
      }
    }
    // Join only the retained ends of a closed source, across its actual seam.
    if(curve.closed&&seamJoinable&&pieces.length>1&&pieces[0].parameters[0]<=precisionUv&&segments-pieces.at(-1).parameters.at(-1)<=precisionUv){
      const tail=pieces.pop(),head=pieces[0];
      pieces[0]={points:[...tail.points,...head.points.slice(1)],parameters:[...tail.parameters,...head.parameters.slice(1).map(t=>t+segments)],segments:[...tail.segments,...head.segments]};
    }
    return pieces.map(piece=>{
      const closed=curve.closed&&piece.points.length>3&&near(piece.points[0],piece.points.at(-1)),parameters=closed?piece.parameters.slice(0,-1):piece.parameters;
      const result={...curve,closed,points:closed?piece.points.slice(0,-1):piece.points};
      for(const field of pointFields)if(curve[field])result[field]=parameters.map(t=>sample(curve[field],t,field));
      for(const field of segmentFields)if(curve[field])result[field]=piece.segments.map(i=>curve[field][i]);
      result.sourceParameters=parameters.map(t=>sample(curve.sourceParameters??ownParameters,t,curve.sourceParameters?'sourceParameters':'parameters'));
      const localLengths=[0];
      for(let i=1;i<piece.points.length;i++)localLengths.push(localLengths.at(-1)+Math.hypot(...piece.points[i].map((v,k)=>v-piece.points[i-1][k])));
      const localParameters=localLengths.map(length=>length/localLengths.at(-1)),source=piece.parameters.map(t=>sample(ownParameters,t,'parameters'));
      if(curve.parameters)result.parameters=closed?localParameters.slice(0,-1):localParameters;
      if(curve.profiles)result.profiles=Object.fromEntries(Object.entries(curve.profiles).map(([name,profile])=>{
        if(!keyed(profile)||source[0]===0&&source.at(-1)===1)return [name,profile];
        requireThat(['linear','step','slerp','frame'].includes(profile.interpolation),'Clipping cannot restrict profile interpolation '+profile.interpolation+'.');
        const cuts=new Map(localParameters.map((u,i)=>[u,source[i]]));
        for(let i=1;i<source.length;i++)for(let cycle=curve.closed?Math.floor(source[i-1]):0;cycle<=(curve.closed?Math.floor(source[i]):0);cycle++)
          for(const [key] of profile.knots){
            const value=key+cycle;
            if(value>source[i-1]&&value<source[i])cuts.set(localParameters[i-1]+(value-source[i-1])/(source[i]-source[i-1])*(localParameters[i]-localParameters[i-1]),value);
          }
        const at=(value,side,interior)=>{
          let u=value;
          if(curve.closed){u=value-Math.floor(value);if(u===0&&value>0&&(side==='left'||value===1&&!interior))u=1;}
          return profileAt(profile,u,side);
        };
        const knots=[];
        for(const [u,value] of [...cuts].sort((a,b)=>a[0]-b[0])){
          const interior=u>0&&u<1,left=at(value,'left',interior),right=at(value,'right',interior);
          if(profile.interpolation==='linear'&&interior&&!same(left,right))knots.push([u,left]);
          knots.push([u,u===1&&value!==1?left:right]);
        }
        return [name,{...profile,knots}];
      }));
      return result;
    });
  });
}
