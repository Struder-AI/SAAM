// Rational chart coincidence. Cheap matching nets cover the usual construction;
// different bases and cropped charts are proved on their common Bezier cells.
import {ROUNDING_MM,ROUNDING_RELATIVE} from '../dimensions.mjs';
import {bezierPieces,projectToSurface} from './surface-intersection.mjs';
import {bezierSpans} from './curve-ops.mjs';
import {evaluate,evaluateCurve,nurbsCurveRecord} from './nurbs.mjs';
import {prepareNumericalCurve,numericalCurveClosestParameter} from './curve-query.mjs';
import {projectSurfacePoint} from './surface-intersection.mjs';
import {surfaceIsoCurve} from './surface-curves.mjs';
import {intersect,union,difference} from '../region/intersection.mjs';
import {distance,dot} from './tolerance.mjs';
import {restrictBezierNet,bernsteinProductWeights} from './bezier-net.mjs';

const correspondences=new WeakMap();

function correspondenceCache(a,b){
  if(!correspondences.has(a))correspondences.set(a,new WeakMap());
  const targets=correspondences.get(a);
  if(!targets.has(b))targets.set(b,new Map());
  return targets.get(b);
}
export function surfaceCorrespondence(a,b,{toleranceMm=ROUNDING_MM}={}){
  const cache=correspondenceCache(a,b);
  if(cache.has(toleranceMm))return cache.get(toleranceMm);
  const exact=findCorrespondence(a,b,toleranceMm);
  const result=exact??(toleranceMm>ROUNDING_MM?fuzzyCorrespondence(a,b,toleranceMm):null);cache.set(toleranceMm,result);
  if(result){
    const images=(result.images??[result]).map(inverseMapping);
    correspondenceCache(b,a).set(toleranceMm,result.reverse??{...images[0],images,complete:result.complete});
  }
  return result;
}

function domainMapping(a,b,axes,directions){
  const source=[a.domainU,a.domainV],target=[b.domainU,b.domainV];
  const scale=source.map(([lo,hi],k)=>directions[k]*(target[axes[k]][1]-target[axes[k]][0])/(hi-lo));
  const offset=source.map(([lo],k)=>target[axes[k]][directions[k]>0?0:1]-lo*scale[k]);
  return {axes,scale,offset,orientation:(axes[0]===0?1:-1)*Math.sign(scale[0]*scale[1])};
}

function inverseMapping(mapping){
  const axes=[],scale=[],offset=[];
  for(let k=0;k<2;k++){
    const axis=mapping.axes[k];axes[axis]=k;scale[axis]=1/mapping.scale[k];offset[axis]=-mapping.offset[k]/mapping.scale[k];
  }
  const sourceDomains=mapping.sourceDomains?axes.map((axis,k)=>mapping.sourceDomains[axis].map(value=>mapping.offset[axis]+mapping.scale[axis]*value).sort((x,y)=>x-y)):undefined;
  return {axes,scale,offset,orientation:mapping.orientation,...(sourceDomains?{sourceDomains}:{})};
}

function mappedUv(uv,mapping){
  const result=[];
  for(let k=0;k<2;k++)result[mapping.axes[k]]=mapping.offset[k]+mapping.scale[k]*uv[k];
  return result;
}

const planeCache=new WeakMap();
export function surfacePlane(patch){
  if(planeCache.has(patch))return planeCache.get(patch);
  const e=evaluate(patch,(patch.domainU[0]+patch.domainU[1])/2,(patch.domainV[0]+patch.domainV[1])/2);
  if(!e.normal){planeCache.set(patch,null);return null;}
  for(let i=0;i<patch.cp.length;i+=4){
    const point=[0,1,2].map(k=>patch.cp[i+k]/patch.cp[i+3]);
    if(Math.abs(dot(e.normal,point.map((v,k)=>v-e.point[k])))>ROUNDING_MM){planeCache.set(patch,null);return null;}
  }
  const plane={normal:e.normal,point:e.point};planeCache.set(patch,plane);return plane;
}


function hasPlanarPiece(patch,plane,toleranceMm){
  return bezierPieces(patch).some(piece=>piece.net.flat().every(h=>
    Math.abs(dot(plane.normal,h.slice(0,3).map((value,k)=>value/h[3]-plane.point[k])))<=toleranceMm));
}

function findCorrespondence(a,b,toleranceMm){
  const planeA=surfacePlane(a),planeB=surfacePlane(b);
  if(planeA&&planeB){
    if(Math.abs(Math.abs(dot(planeA.normal,planeB.normal))-1)>ROUNDING_RELATIVE||
      Math.abs(dot(planeA.normal,planeB.point.map((value,k)=>value-planeA.point[k])))>toleranceMm)return null;
  }else{
    // A polynomial surface can share an open planar region only if at least
    // one of its Bezier pieces lies entirely in that plane.
    if(planeA&&!hasPlanarPiece(b,planeA,toleranceMm)||planeB&&!hasPlanarPiece(a,planeB,toleranceMm))return null;
  }
  const source=[{n:a.nu,order:a.orderU,knots:a.knotsU,domain:a.domainU},{n:a.nv,order:a.orderV,knots:a.knotsV,domain:a.domainV}];
  const target=[{n:b.nu,order:b.orderU,knots:b.knotsU,domain:b.domainU},{n:b.nv,order:b.orderV,knots:b.knotsV,domain:b.domainV}];
  for(const axes of [[0,1],[1,0]])for(const directions of [[1,1],[-1,1],[1,-1],[-1,-1]]){
    const mapping=domainMapping(a,b,axes,directions);
    if(source.every((axis,k)=>sameBasis(axis,target[axes[k]],directions[k]))){
      const mapped=(i,j)=>{
        const indices=[];
        for(const [k,value] of [i,j].entries())indices[axes[k]]=directions[k]>0?value:target[axes[k]].n-1-value;
        return (indices[0]*b.nv+indices[1])*4;
      };
      const weightA=a.cp[3],weightB=b.cp[mapped(0,0)+3],state={matches:true};
      for(let i=0;i<a.nu&&state.matches;i++)for(let j=0;j<a.nv&&state.matches;j++){
        const ai=(i*a.nv+j)*4,bi=mapped(i,j),wa=a.cp[ai+3],wb=b.cp[bi+3];
        state.matches=Math.abs(wa/weightA-wb/weightB)<=ROUNDING_RELATIVE*Math.max(wa/weightA,wb/weightB)&&
          Math.hypot(...[0,1,2].map(k=>a.cp[ai+k]/wa-b.cp[bi+k]/wb))<=toleranceMm;
      }
      if(state.matches)return mapping;
    }else if(matchingChartSamples(a,b,mapping,toleranceMm)&&matchingSurfaceRegion(a,b,mapping,toleranceMm))return mapping;
  }
  // Closest-point solves propose axis-aligned affine chart maps. No sampled
  // match is accepted: each proposal must satisfy the rational identity below.
  const images=[];
  const consider=(source,target,reverse)=>{
    const sourceDomains=[source.domainU,source.domainV],targetDomains=[target.domainU,target.domainV];
    const samples=[0,.5,1].flatMap(u=>[0,.5,1].map(v=>[u,v].map((fraction,k)=>sourceDomains[k][0]+fraction*(sourceDomains[k][1]-sourceDomains[k][0]))));
    const guesses=[0,.5,1].flatMap(u=>[0,.5,1].map(v=>[u,v].map((fraction,k)=>targetDomains[k][0]+fraction*(targetDomains[k][1]-targetDomains[k][0]))));
    for(const uv of samples){
      const point=evaluate(source,...uv);
      if(!point.normal)continue;
      for(const guess of guesses){
        const projection=projectToSurface(target,point.point,guess);
        if(projection.distance>toleranceMm)continue;
        const candidate=affineChartMapping(uv,point,projection.uv,evaluate(target,...projection.uv));
        if(!candidate)continue;
        const mapping=reverse?inverseMapping(candidate):candidate;
        if(images.some(image=>sameMapping(image,mapping,a)))continue;
        if(!matchingSurfaceRegion(a,b,mapping,toleranceMm))continue;
        if(images.length&&images[0].orientation!==mapping.orientation)return;
        images.push(mapping);
      }
    }
  };
  consider(a,b,false);consider(b,a,true);
  return images.length?{...images[0],images}:null;
}

// A nonlinear reparameterization is locally affine to bounded accuracy. Each
// accepted image is proved on its whole rational Bezier cell, not at samples.
// A shared geometric region may therefore have many bounded chart images.
function fuzzyCorrespondence(a,b,toleranceMm){
  if(surfacePlane(a)||surfacePlane(b))return null;
  const forward=fuzzyChartImages(a,b,toleranceMm);
  if(!forward?.images.length)return null;
  // Approximate forward images do not form a gap-free inverse partition.
  // Prove each direction on its own source cells to cover the common region.
  const reverse=fuzzyChartImages(b,a,toleranceMm);
  if(!reverse?.images.length)return null;
  const complete=!!(forward.complete&&reverse.complete);
  return {...forward.images[0],images:forward.images,complete,
    reverse:{...reverse.images[0],images:reverse.images,complete}};
}
const periodicCharts=new WeakMap();
function periodicChartAxes(patch){
  if(!periodicCharts.has(patch))periodicCharts.set(patch,[patch.domainU,patch.domainV].map((domain,axis)=>
    curveCorrespondence(surfaceIsoCurve(patch,axis,domain[0]),surfaceIsoCurve(patch,axis,domain[1]))===1));
  return periodicCharts.get(patch);
}
function imageDomains(mapping,source,target){
  return source.map(([low,high],k)=>{
    const ends=target[mapping.axes[k]].map(value=>(value-mapping.offset[k])/mapping.scale[k]).sort((x,y)=>x-y);
    return [Math.max(low,ends[0]),Math.min(high,ends[1])];
  });
}
function domainLoop(domains){const [[a,b],[c,d]]=domains;return [[[a,c],[b,c],[b,d],[a,d]]];}
function domainsCovered(domains,images){
  const coverage=images.reduce((loops,image)=>union(loops,domainLoop(image.sourceDomains)),[]);
  return !difference(domainLoop(domains),coverage).length;
}
function localChartProposal(a,b,uv){
  const point=evaluate(a,...uv);if(!point.normal)return null;
  const projected=projectSurfacePoint(b,point.point,{toleranceMm:ROUNDING_MM});
  if(projected.distance>ROUNDING_MM)return null;
  return affineChartMapping(uv,point,projected.uv,evaluate(b,...projected.uv));
}
function fuzzyChartImages(a,b,toleranceMm){
  const domains=[a.domainU,a.domainV],target=[b.domainU,b.domainV],periodic=periodicChartAxes(b),anchors=[];
  for(const u of [.5,.25,.75])for(const v of [.5,.25,.75]){
    const uv=[u,v].map((fraction,k)=>domains[k][0]+fraction*(domains[k][1]-domains[k][0]));
    const mapping=localChartProposal(a,b,uv);if(mapping)anchors.push(mapping);
  }
  if(!anchors.length)return null;
  const pending=bezierPieces(a).map(piece=>[piece.u,piece.v]),images=[],status={complete:true};
  while(pending.length){
    const cell=pending.pop(),middle=cell.map(([low,high])=>(low+high)/2),local=localChartProposal(a,b,middle),proposal=local??anchors[0];
    const accepted=[],candidate={count:0};
    const shifts=periodic.map((active,k)=>active?[-1,0,1].map(value=>value*(target[k][1]-target[k][0])):[0]);
    for(const u of shifts[0])for(const v of shifts[1]){
      const offset=proposal.offset.map((value,k)=>value+[u,v][proposal.axes[k]]),mapping={...proposal,offset};
      const common=imageDomains(mapping,cell,target);
      if(common.some(([low,high])=>!(high>low)))continue;
      candidate.count++;
      if(matchingSurfaceRegion(a,b,mapping,toleranceMm,common))accepted.push({...mapping,sourceDomains:common});
    }
    if(accepted.length&&accepted.length===candidate.count){
      images.push(...accepted);if(!domainsCovered(cell,accepted))status.complete=false;continue;
    }
    // Outside the bounded target, retain only the proved common region. A
    // different support at a real crossing is not fuzzy surface coincidence.
    if(!local){if(accepted.length)images.push(...accepted);status.complete=false;continue;}
    const error=cell.map(([low,high],axis)=>[low,high].reduce((largest,value)=>{
      const uv=middle.map((coordinate,k)=>k===axis?value:coordinate),mapped=mappedUv(uv,proposal);
      if(mapped.some((coordinate,k)=>coordinate<target[k][0]||coordinate>target[k][1]))return largest;
      return Math.max(largest,distance(evaluate(a,...uv,false).point,evaluate(b,...mapped,false).point));
    },0));
    const axis=error[0]>=error[1]?0:1,[low,high]=cell[axis],mid=(low+high)/2;
    if(!(mid>low&&mid<high))return null;
    pending.push(cell.map((range,k)=>k===axis?[low,mid]:range),cell.map((range,k)=>k===axis?[mid,high]:range));
  }
  return {images,complete:status.complete&&domainsCovered(domains,images)};
}

function sameMapping(a,b,patch){
  return a.axes.every((axis,k)=>axis===b.axes[k])&&[patch.domainU,patch.domainV].every((domain,k)=>
    domain.every(value=>Math.abs(a.offset[k]+a.scale[k]*value-b.offset[k]-b.scale[k]*value)<=ROUNDING_RELATIVE*Math.max(1,Math.abs(a.scale[k])*(domain[1]-domain[0]))));
}

function affineChartMapping(uv,a,targetUv,b){
  if(!b.normal||Math.abs(dot(a.normal,b.normal))<1-ROUNDING_RELATIVE)return null;
  const aa=dot(b.du,b.du),ab=dot(b.du,b.dv),bb=dot(b.dv,b.dv),det=aa*bb-ab*ab;
  if(!(det>0))return null;
  const jacobian=[a.du,a.dv].map(direction=>[(dot(direction,b.du)*bb-dot(direction,b.dv)*ab)/det,(dot(direction,b.dv)*aa-dot(direction,b.du)*ab)/det]);
  const axes=jacobian.map(row=>Math.abs(row[0])>=Math.abs(row[1])?0:1);
  if(axes[0]===axes[1])return null;
  const scale=axes.map((axis,k)=>jacobian[k][axis]);
  if(scale.some(value=>!Number.isFinite(value)||!value)||jacobian.some((row,k)=>Math.abs(row[1-axes[k]])>ROUNDING_RELATIVE*Math.abs(scale[k])))return null;
  const offset=axes.map((axis,k)=>targetUv[axis]-scale[k]*uv[k]);
  return {axes,scale,offset,orientation:(axes[0]===0?1:-1)*Math.sign(scale[0]*scale[1])};
}

function matchingChartSamples(a,b,mapping,toleranceMm){
  return [[0,0],[0,1],[1,0],[1,1],[.5,.5]].every(fractions=>{
    const uv=fractions.map((f,k)=>(k?a.domainV:a.domainU)[0]+f*((k?a.domainV:a.domainU)[1]-(k?a.domainV:a.domainU)[0]));
    return distance(evaluate(a,...uv,false).point,evaluate(b,...mappedUv(uv,mapping),false).point)<=toleranceMm;
  });
}

function matchingSurfaceRegion(a,b,mapping,toleranceMm,domains=[a.domainU,a.domainV]){
  const target=[b.domainU,b.domainV],common=domains.map((domain,k)=>{
    const ends=target[mapping.axes[k]].map(value=>(value-mapping.offset[k])/mapping.scale[k]).sort((x,y)=>x-y);
    return [Math.max(domain[0],ends[0]),Math.min(domain[1],ends[1])];
  });
  if(common.some(([lo,hi])=>!(hi>lo)))return false;
  const first=bezierPieces(a).map(piece=>({net:piece.net,ranges:[piece.u,piece.v]}));
  const second=bezierPieces(b).map(piece=>mappedPiece(piece,mapping));
  return matchingBezierRegions(first,second,common,toleranceMm);
}

function relativeRanges(piece,ranges){
  return ranges.map(([low,high],k)=>{
    const [start,end]=piece.ranges[k];
    return [(low-start)/(end-start),(high-start)/(end-start)];
  });
}

// Compare every cell in the common chart partition, regardless of the source
// knot subdivision or degree. This also serves curves as degree-zero V nets.
function matchingBezierRegions(firstPieces,secondPieces,common,toleranceMm=ROUNDING_MM){
  const checked={cells:0};
  for(const first of firstPieces)for(const second of secondPieces){
    const ranges=common.map(([low,high],k)=>[
      Math.max(low,first.ranges[k][0],second.ranges[k][0]),
      Math.min(high,first.ranges[k][1],second.ranges[k][1])
    ]);
    if(ranges.some(([low,high])=>!(high>low)))continue;
    const left=restrictBezierNet(first.net,relativeRanges(first,ranges));
    const right=restrictBezierNet(second.net,relativeRanges(second,ranges));
    if(!sameRationalNets(left,right,toleranceMm))return false;
    checked.cells++;
  }
  return checked.cells>0;
}

function mappedPiece(piece,mapping){
  const ranges=[piece.u,piece.v],degrees=[piece.p,piece.q];
  const source=mapping.axes.map((axis,k)=>ranges[axis].map(value=>(value-mapping.offset[k])/mapping.scale[k]).sort((x,y)=>x-y));
  const p=degrees[mapping.axes[0]],q=degrees[mapping.axes[1]];
  const net=Array.from({length:p+1},(_,i)=>Array.from({length:q+1},(_,j)=>{
    const indices=[];
    for(const [k,value] of [i,j].entries())indices[mapping.axes[k]]=mapping.scale[k]>0?value:degrees[mapping.axes[k]]-value;
    return piece.net[indices[0]][indices[1]];
  }));
  return {ranges:source,net};
}

// X/W == Y/V iff XV-YW is zero. Bernstein coefficients bound the whole
// polynomial cell, so equal samples never substitute for rational identity.
// Positive weights give the denominator a nonzero lower bound throughout it.
function sameRationalNets(first,second,toleranceMm){
  const origin=first[0][0].slice(0,3).map(value=>value/first[0][0][3]);
  const prepare=net=>{
    const maximum=net.flat().reduce((value,point)=>Math.max(value,point[3]),0);
    return net.map(row=>row.map(point=>[...point.slice(0,3).map((value,k)=>(value-origin[k]*point[3])/maximum),point[3]/maximum]));
  };
  const a=prepare(first),b=prepare(second),p=a.length-1,q=a[0].length-1,r=b.length-1,s=b[0].length-1;
  const u=bernsteinProductWeights(p,r),v=bernsteinProductWeights(q,s),coefficients=Array.from({length:p+r+1},()=>Array.from({length:q+s+1},()=>[0,0,0]));
  for(let i=0;i<=p;i++)for(let j=0;j<=q;j++)for(let k=0;k<=r;k++)for(let l=0;l<=s;l++){
    const weight=u[i][k]*v[j][l];
    for(let axis=0;axis<3;axis++)coefficients[i+k][j+l][axis]+=weight*(a[i][j][axis]*b[k][l][3]-b[k][l][axis]*a[i][j][3]);
  }
  const minimum=net=>net.flat().reduce((value,point)=>Math.min(value,point[3]),Infinity);
  const limit=toleranceMm*minimum(a)*minimum(b);
  return coefficients.flat().every(point=>Math.hypot(...point)<=limit);
}

function sameBasis(a,b,direction){
  if(a.n!==b.n||a.order!==b.order||a.knots.length!==b.knots.length)return false;
  const unit=(value,domain)=>(value-domain[0])/(domain[1]-domain[0]);
  return a.knots.every((value,i)=>{
    const other=direction>0?unit(b.knots[i],b.domain):1-unit(b.knots[b.knots.length-1-i],b.domain);
    return unit(value,a.domain)===other;
  });
}

// The planes are already proved coincident. Projection supplies another UV
// chart for the same world samples; null retains where this bounded chart ends.
export function projectCoincidentChart(points,target,{toleranceMm=ROUNDING_MM}={}){
  const domains=[target.domainU,target.domainV];
  const guesses=[0,.25,.5,.75,1].flatMap(u=>[.5,1].map(v=>[u,v].map((fraction,k)=>domains[k][0]+fraction*(domains[k][1]-domains[k][0]))));
  const state={guess:domains.map(([low,high])=>(low+high)/2)};
  return points.map(point=>{
    const first=projectToSurface(target,point,state.guess);
    if(first.distance<=toleranceMm){state.guess=first.uv;return first.uv;}
    for(const guess of guesses){
      const projected=projectToSurface(target,point,guess);
      if(projected.distance<=toleranceMm){state.guess=projected.uv;return projected.uv;}
    }
    return null;
  });
}

export function correspondingSurfaceCharts(parameters,mapping){
  return (mapping.images??[mapping]).map(image=>parameters.map(uv=>image.sourceDomains&&uv.some((value,k)=>value<image.sourceDomains[k][0]-ROUNDING_RELATIVE||value>image.sourceDomains[k][1]+ROUNDING_RELATIVE)?null:mappedUv(uv,image)));
}

// Pull a target region back onto the source partition. Fuzzy forward images
// may overlap or leave gaps in target UV, while their source cells are exact.
export function correspondingSourceLoops(loops,mapping){
  const regions=(mapping.images??[mapping]).map(image=>{
    const inverse=inverseMapping(image);
    const pulled=loops.map(loop=>{
      const points=loop.map(uv=>mappedUv(uv,inverse));
      return image.orientation>0?points:points.reverse();
    });
    return image.sourceDomains?intersect(pulled,domainLoop(image.sourceDomains)):pulled;
  });
  return regions.reduce((merged,region)=>union(merged,region),[]);
}

function curvePieces(curve,direction){
  const [low,high]=curve.domain;
  return bezierSpans(curve).map(piece=>{
    const ends=[piece.a,piece.b].map(value=>(value-low)/(high-low));
    const points=Array.from({length:piece.cp.length/4},(_,i)=>Array.from(piece.cp.slice(i*4,i*4+4)));
    const along=direction>0?ends:[1-ends[1],1-ends[0]];
    const ordered=direction>0?points:points.reverse();
    return {ranges:[along,[0,1]],net:ordered.map(point=>[point])};
  });
}

export function curveCorrespondence(a,b){
  const start=evaluateCurve(a,a.domain[0]).point;
  for(const direction of [1,-1]){
    const targetStart=evaluateCurve(b,b.domain[direction>0?0:1]).point;
    if(distance(start,targetStart)>ROUNDING_MM)continue;
    if(matchingBezierRegions(curvePieces(a,1),curvePieces(b,direction),[[0,1],[0,1]]))return direction;
  }
  return null;
}

// Proved common intervals of two bounded native curves. Parameters and the
// affine map are normalized to each curve's full domain. A map is authoritative
// only on its returned intervals: matching one span never certifies its rest.
export function boundedCurveCorrespondence(a,rangeA,b,rangeB,{toleranceMm=ROUNDING_MM}={}){
  const proposals=[],matches=[];
  const propose=(scale,offset)=>{if(Number.isFinite(scale)&&scale&&Number.isFinite(offset)&&!proposals.some(p=>p.scale===scale&&p.offset===offset))proposals.push({scale,offset});};
  const whole=curveCorrespondence(a,b);
  if(whole)propose(whole,whole>0?0:1);
  const spanA=a.domain[1]-a.domain[0],spanB=b.domain[1]-b.domain[0];
  propose(spanA/spanB,(a.domain[0]-b.domain[0])/spanB);
  propose(-spanA/spanB,(b.domain[1]-a.domain[0])/spanB);
  for(const direction of [1,-1]){
    const scale=direction*(rangeB[1]-rangeB[0])/(rangeA[1]-rangeA[0]);
    propose(scale,(direction>0?rangeB[0]:rangeB[1])-scale*rangeA[0]);
  }
  const first=curvePieces(a,1),second=curvePieces(b,1);
  const prove=()=>{
    for(const {scale,offset} of proposals){
      const mapped=second.map(piece=>({ranges:[piece.ranges[0].map(v=>(v-offset)/scale).sort((x,y)=>x-y),[0,1]],net:scale>0?piece.net:[...piece.net].reverse()}));
      const target=rangeB.map(v=>(v-offset)/scale).sort((x,y)=>x-y);
      const common=[Math.max(rangeA[0],target[0]),Math.min(rangeA[1],target[1])];
      if(!(common[1]>common[0]))continue;
      for(const p of first)for(const q of mapped){
        const range=[Math.max(common[0],p.ranges[0][0],q.ranges[0][0]),Math.min(common[1],p.ranges[0][1],q.ranges[0][1])];
        if(!(range[1]>range[0]))continue;
        const cell=[range,[0,1]];
        if(!sameRationalNets(restrictBezierNet(p.net,relativeRanges(p,cell)),restrictBezierNet(q.net,relativeRanges(q,cell)),toleranceMm))continue;
        matches.push({sourceRange:range,targetRange:range.map(v=>offset+scale*v),scale,offset});
      }
    }
  };
  prove();
  if(matches.length)return matches;
  // Positions propose a parameter relation; only the whole rational cell proof
  // above can accept it. Local positive-weight hulls reject disjoint candidates.
  const hull=(pieces,range)=>{
    const rows=pieces.filter(p=>p.ranges[0][1]>range[0]&&p.ranges[0][0]<range[1]).flatMap(p=>{
      const cell=[[Math.max(p.ranges[0][0],range[0]),Math.min(p.ranges[0][1],range[1])],[0,1]];
      return restrictBezierNet(p.net,relativeRanges(p,cell)).flat();
    });
    return {min:[0,1,2].map(k=>Math.min(...rows.map(p=>p[k]/p[3]))),max:[0,1,2].map(k=>Math.max(...rows.map(p=>p[k]/p[3])))};
  };
  const ha=hull(first,rangeA),hb=hull(second,rangeB);
  if(ha.min.some((v,k)=>v>hb.max[k]+toleranceMm||hb.min[k]>ha.max[k]+toleranceMm))return [];
  const pairs=[];
  const project=(source,range,target,targetRange,reverse)=>{
    const record=nurbsCurveRecord(target);
    if(record.controlPoints.every(point=>point.every((v,k)=>v===record.controlPoints[0][k])))return;
    const query=prepareNumericalCurve({kind:'nurbs',...record}),domain=target.domain,span=domain[1]-domain[0];
    for(const u of [range[0],(range[0]+range[1])/2,range[1]]){
      const point=evaluateCurve(source,source.domain[0]+u*(source.domain[1]-source.domain[0])).point;
      let t=numericalCurveClosestParameter(query,...targetRange,point,{toleranceMm:ROUNDING_MM,maxDistanceMm:toleranceMm});
      if(t===null)continue;
      let error=Infinity,best=t;
      for(;;){
        const e=evaluateCurve(target,domain[0]+t*span),delta=e.point.map((v,k)=>v-point[k]),squared=dot(e.derivative,e.derivative),residual=Math.hypot(...delta);
        if(residual>=error||!squared){t=best;break;}error=residual;best=t;
        const next=Math.max(targetRange[0],Math.min(targetRange[1],t-dot(delta,e.derivative)/(squared*span)));
        if(next===t)break;t=next;
      }
      pairs.push(reverse?[t,u]:[u,t]);
    }
  };
  project(a,rangeA,b,rangeB,false);project(b,rangeB,a,rangeA,true);
  proposals.length=0;
  for(const [i,p] of pairs.entries())for(const q of pairs.slice(i+1))if(Math.abs(q[0]-p[0])>ROUNDING_RELATIVE){const scale=(q[1]-p[1])/(q[0]-p[0]);propose(scale,p[1]-scale*p[0]);}
  prove();return matches;
}
