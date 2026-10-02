// Experimental support for one bed-facing, round counterbore in a planar part.
// Geometry and Toolpath operations are supplied by the host; this package does
// not import engine implementation or depend on an installed SAAM checkout.
const check=(condition,message)=>{if(!condition)throw Error(message);};
const finite=v=>Number.isFinite(v);
const area=loop=>loop.reduce((sum,[x,y],i)=>{const [u,v]=loop[(i+1)%loop.length];return sum+x*v-u*y;},0)/2;
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const circle=(x,y,r)=>{
  const count=Math.max(48,Math.ceil(2*Math.PI*r/.25));
  return Array.from({length:count},(_,i)=>{
    const angle=i*2*Math.PI/count;
    return [x+r*Math.cos(angle),y+r*Math.sin(angle)];
  });
};

function roundHole(loop,toleranceMm){
  if(loop.length<3||area(loop)>=0)return null;
  // Polygon centroid avoids vertex-density bias on tessellated CAD circles.
  let crossSum=0,xSum=0,ySum=0;
  for(let i=0;i<loop.length;i++){
    const [x,y]=loop[i],[u,v]=loop[(i+1)%loop.length],cross=x*v-u*y;
    crossSum+=cross;xSum+=(x+u)*cross;ySum+=(y+v)*cross;
  }
  if(Math.abs(crossSum)<1e-8)return null;
  const center=[xSum/(3*crossSum),ySum/(3*crossSum)];
  const radii=loop.map(point=>distance(point,center)),radius=radii.reduce((a,b)=>a+b,0)/radii.length;
  const deviation=loop.reduce((max,point,i)=>{
    const next=loop[(i+1)%loop.length],mid=[(point[0]+next[0])/2,(point[1]+next[1])/2];
    return Math.max(max,Math.abs(distance(point,center)-radius),Math.abs(distance(mid,center)-radius));
  },0);
  if(radius<=toleranceMm*4||deviation>Math.max(toleranceMm,radius*.025))return null;
  return {centerMm:center,radiusMm:radius};
}

export function findBedCounterbores(shell,createSectionQuery,{layerMm,lineWidthMm,toleranceMm=.08}={}){
  check(typeof createSectionQuery==='function','Hole detection needs Geometry.createSectionQuery.');
  check(finite(layerMm)&&layerMm>0&&finite(lineWidthMm)&&lineWidthMm>0,'Hole detection needs positive layer and bead widths.');
  check(Math.abs(shell.bounds.min[2])<=Math.max(layerMm/4,.05),'Hole supports require a component standing on the bed at Z=0.');
  const sectionAt=createSectionQuery(shell),height=shell.bounds.max[2]-shell.bounds.min[2];
  const step=Math.min(.5,Math.max(layerMm,.15));
  const firstZ=Math.min(height-step*.25,step*.5);
  check(firstZ>0&&height>step,'Hole detection needs at least two horizontal sections.');
  const holesAt=z=>{
    const cut=sectionAt(z);
    check(cut.nudgedByMm<=toleranceMm,'A horizontal section needed excessive geometric nudging; repair the part before hole support.');
    return cut.loops.map(loop=>roundHole(loop,toleranceMm)).filter(Boolean);
  };
  const tracks=holesAt(firstZ).map(lower=>({lower,previous:lower,last:firstZ,done:false}));
  const candidates=[];
  // The large bore must open at the bed. Match a smaller circular bore above it.
  for(let i=1;step*(i+.5)<height-step*.25+1e-8&&tracks.some(track=>!track.done);i++){
    const z=step*(i+.5),holes=holesAt(z);
    for(const track of tracks){
      if(track.done)continue;
      const {lower,previous,last}=track;
      const current=holes.filter(h=>distance(h.centerMm,lower.centerMm)<=Math.max(toleranceMm*2,lineWidthMm/2))
        .sort((a,b)=>Math.abs(a.radiusMm-previous.radiusMm)-Math.abs(b.radiusMm-previous.radiusMm))[0];
      if(!current){track.done=true;continue;}
      if(previous.radiusMm-current.radiusMm>=Math.max(lineWidthMm*.75,toleranceMm*3)
        &&current.radiusMm>=lineWidthMm*1.5){
        // Resolve the shoulder well inside the section tolerance; deposition
        // separately selects complete courses in the open lower cavity.
        let low=last,high=z;
        while(high-low>toleranceMm/16){
          const mid=(low+high)/2,at=sectionAt(mid).loops.map(loop=>roundHole(loop,toleranceMm)).filter(Boolean)
            .find(h=>distance(h.centerMm,lower.centerMm)<=Math.max(toleranceMm*2,lineWidthMm/2));
          check(mid>low&&mid<high,'Counterbore shoulder refinement cannot progress at this coordinate precision.');
          if(at&&at.radiusMm>(previous.radiusMm+current.radiusMm)/2)low=mid;else high=mid;
        }
        const shoulderZMm=(low+high)/2;
        candidates.push({centerMm:lower.centerMm,lowerRadiusMm:previous.radiusMm,upperRadiusMm:current.radiusMm,shoulderZMm,
          detectedFromMm:[firstZ,z]});
        track.done=true;continue;
      }
      track.previous=current;track.last=z;
    }
  }
  return candidates.filter((candidate,i)=>candidates.findIndex(other=>distance(other.centerMm,candidate.centerMm)<toleranceMm*2)===i);
}

function chooseCandidate(candidates,request,toleranceMm){
  check(candidates.length,'No bed-facing circular counterbore with a smaller bore above air was detected.');
  if(request.centerMm===undefined){check(candidates.length===1,'Multiple counterbores found; supply centerMm to select one.');return candidates[0];}
  check(Array.isArray(request.centerMm)&&request.centerMm.length===2&&request.centerMm.every(finite),'centerMm must be [x,y].');
  const found=candidates.filter(c=>distance(c.centerMm,request.centerMm)<=Math.max(toleranceMm*2,.25));
  check(found.length===1,'centerMm must select exactly one detected counterbore.');
  return found[0];
}

function trace(id,curves,after=[]){
  return {id,construction:'curves',curves,after,sequence:true};
}
function path(role,points,process){return {role,closed:false,points,speedMmS:process.planarSpeedMmS};}

function materialAt(loops,[x,y]){
  let inside=false;
  for(const loop of loops){
    let hit=false;
    for(let i=0,j=loop.length-1;i<loop.length;j=i++){
      const [ax,ay]=loop[i],[bx,by]=loop[j];
      if((ay>y)!==(by>y)&&x<(bx-ax)*(y-ay)/(by-ay)+ax)hit=!hit;
    }
    if(hit)inside=!inside;
  }
  return inside;
}

function cavityAt(sectionAt,z,candidate,toleranceMm){
  const cut=sectionAt(z),hole=cut.loops.map(loop=>roundHole(loop,toleranceMm)).filter(Boolean)
    .find(h=>distance(h.centerMm,candidate.centerMm)<=Math.max(toleranceMm*2,.2));
  check(hole&&hole.radiusMm+1e-4>=candidate.lowerRadiusMm-toleranceMm,
    `The counterbore cavity narrows near Z ${z.toFixed(3)} mm; this support course would collide with the model.`);
  check(!cut.loops.some(loop=>area(loop)>0&&loop.every(point=>distance(point,hole.centerMm)<hole.radiusMm-toleranceMm)),
    `Material lies inside the counterbore cavity near Z ${z.toFixed(3)} mm.`);
  return {hole,loops:cut.loops};
}

function lastOpenCourse(candidate,process,sectionAt,toleranceMm){
  const {firstLayerMm,layerMm}=process;
  check([firstLayerMm,layerMm].every(v=>finite(v)&&v>0),'Hole supports need planar firstLayerMm and layerMm.');
  for(let n=Math.floor((candidate.shoulderZMm-firstLayerMm+1e-8)/layerMm);n>=0;n--){
    const z=firstLayerMm+n*layerMm,cut=sectionAt(z),hole=cut.loops.map(loop=>roundHole(loop,toleranceMm)).filter(Boolean)
      .find(h=>distance(h.centerMm,candidate.centerMm)<=Math.max(toleranceMm*2,.2));
    if(hole&&hole.radiusMm+1e-4>=candidate.lowerRadiusMm-toleranceMm)return z;
  }
  throw Error('No complete planar course lies inside the lower counterbore cavity.');
}

function anchoredSpan(role,a,b,anchor,loops,process,course){
  const d=distance(a,b),u=[(b[0]-a[0])/d,(b[1]-a[1])/d],before=[a[0]-anchor*u[0],a[1]-anchor*u[1],a[2]],after=[b[0]+anchor*u[0],b[1]+anchor*u[1],b[2]];
  check(materialAt(loops,before)&&materialAt(loops,after),
    `A ${role} attachment leaves the counterbore rim; shorten anchorMm or choose another hole.`);
  const samples=Math.ceil(d/Math.max(process.lineWidthMm/2,.1));
  for(let i=0;i<=samples;i++){
    const p=[a[0]+(b[0]-a[0])*i/samples,a[1]+(b[1]-a[1])*i/samples];
    check(!materialAt(loops,p),`A ${role} free span crosses model material; choose another hole.`);
  }
  return [path(`${role}-attach`,[before,a],process),path(role,[a,b],process),path(`${role}-attach`,[b,after],process)]
    .map(curve=>course===undefined?curve:{...curve,courses:[course]});
}

function membrane(candidate,request,process,id,shell,createSectionQuery,toleranceMm){
  const [x,y]=candidate.centerMm,w=process.lineWidthMm,sectionAt=createSectionQuery(shell);
  const pitch=request.pitchMm??w,overlap=request.anchorMm??w*1.5;
  check(finite(pitch)&&pitch>=w*.75&&pitch<=w*1.5,'Membrane pitchMm must be 0.75–1.5 bead widths.');
  check(finite(overlap)&&overlap>=w,'Membrane anchorMm must cover at least one bead width of the cavity rim.');
  const z=lastOpenCourse(candidate,process,sectionAt,toleranceMm),{hole,loops}=cavityAt(sectionAt,z,candidate,toleranceMm),r=hole.radiusMm-w/2;
  const count=Math.max(1,Math.ceil(2*r/pitch)),curves=[];
  for(let i=0;i<count;i++){
    const dy=(i+.5-count/2)*pitch;
    if(Math.abs(dy)>=r)continue;
    const half=Math.sqrt(Math.max(0,r**2-dy**2));
    const anchorLength=Math.sqrt(Math.max(0,hole.radiusMm**2-dy**2))+overlap-half;
    curves.push(...anchoredSpan('hole-drill-membrane',[x-half,y+dy,z],[x+half,y+dy,z],anchorLength,loops,process));
  }
  check(curves.length,'The selected bore is too small for a membrane stroke.');
  return trace(id,curves,request.after??[]);
}

function tangentBridge(candidate,request,process,id,shell,createSectionQuery,toleranceMm){
  const [x,y]=candidate.centerMm,large=candidate.lowerRadiusMm,small=candidate.upperRadiusMm,w=process.lineWidthMm;
  const anchor=request.anchorMm??w*1.5,offset=request.tangentOffsetMm??small+w/2;
  check(finite(anchor)&&anchor>=w,'Tangent anchorMm must cover at least one bead width of the cavity rim.');
  check(finite(offset)&&offset>=small-w/2&&offset<large-w,'Tangent offset must skirt the smaller bore and fit inside the outer bore.');
  const sectionAt=createSectionQuery(shell),top=lastOpenCourse(candidate,process,sectionAt,toleranceMm);
  const topIndex=Math.round((top-process.firstLayerMm)/process.layerMm);
  const atStage=stage=>process.firstLayerMm+(topIndex-2+stage)*process.layerMm;
  const z=atStage(0);
  check(z>=process.firstLayerMm-1e-8,'A three-stage tangent bridge needs three complete lower-cavity layers.');
  const curves=[];
  for(let stage=0;stage<2;stage++){
    const atZ=atStage(stage),{hole,loops}=cavityAt(sectionAt,atZ,candidate,toleranceMm);
    const half=Math.sqrt((hole.radiusMm-w/2)**2-offset**2);
    check(finite(half)&&half>0,'Tangent bridge has no free span inside the detected cavity.');
    for(const sign of [-1,1]){
      const a=stage===0?[x-half,y+sign*offset,atZ]:[x+sign*offset,y-half,atZ];
      const b=stage===0?[x+half,y+sign*offset,atZ]:[x+sign*offset,y+half,atZ];
      const anchorLength=Math.sqrt(hole.radiusMm**2-offset**2)+anchor-half;
      curves.push(...anchoredSpan(`hole-tangent-stage-${stage+1}`,a,b,anchorLength,loops,process,stage));
    }
  }
  // Third course marks the intended bore perimeter in four separate arcs.
  const radius=small+w/2,segments=Math.max(2,Math.ceil(Math.PI*radius/(2*.25)));
  const thirdZ=atStage(2),{hole:thirdHole}=cavityAt(sectionAt,thirdZ,candidate,toleranceMm);
  check(radius+w/2< thirdHole.radiusMm-toleranceMm,'The third-stage bore rim does not fit inside the counterbore void.');
  for(let quadrant=0;quadrant<4;quadrant++){
    const points=Array.from({length:segments+1},(_,i)=>{
      const a=(quadrant+i/segments)*Math.PI/2;return [x+radius*Math.cos(a),y+radius*Math.sin(a),thirdZ];
    });
    curves.push({...path('hole-tangent-stage-three',points,process),courses:[2]});
  }
  return {...trace(id,curves,request.after??[]),repeat:{count:3,translation:[0,0,0]},courseIds:['tangents-a','tangents-b','bore-rim']};
}

function sleeve(candidate,request,process,id,shell,createSectionQuery,toleranceMm){
  const [x,y]=candidate.centerMm,w=process.lineWidthMm,xyGapMm=request.xyGapMm??.3,topGapMm=request.topGapMm??.2;
  check(finite(xyGapMm)&&xyGapMm>=0&&finite(topGapMm)&&topGapMm>=0,'Sleeve gaps must be nonnegative.');
  const outer=candidate.lowerRadiusMm-xyGapMm,inner=request.sleeveInnerRadiusMm??Math.max(w,candidate.upperRadiusMm-w);
  check(finite(inner)&&inner>=w&&outer-inner>=2*w,'The removable sleeve needs at least two beads of wall between its bore and cleared outer edge.');
  const top=candidate.shoulderZMm-topGapMm,count=Math.floor((top-process.firstLayerMm+1e-8)/process.layerMm)+1;
  check(count>=1,'The removable sleeve has no complete planar layer below its top gap.');
  // Trace does not participate in Slice's region-ownership proof. Check every
  // commanded bead envelope against the actual circular void section instead.
  const sectionAt=createSectionQuery(shell);
  for(let layer=0;layer<count;layer++){
    const z=process.firstLayerMm+layer*process.layerMm;
    for(const probe of [Math.max(.001,z-(layer?process.layerMm:process.firstLayerMm)),z]){
      const {hole}=cavityAt(sectionAt,probe,candidate,toleranceMm);
      check(hole.radiusMm+1e-4>=outer+xyGapMm,
        `Sleeve envelope meets model material near Z ${probe.toFixed(3)} mm; revise the sleeve or use another support mode.`);
    }
  }
  const outerCenter=outer-w/2,innerCenter=inner+w/2,ringCount=Math.max(2,Math.ceil((outerCenter-innerCenter)/w)+1);
  const curves=Array.from({length:ringCount},(_,i)=>{
    const radius=outerCenter-(outerCenter-innerCenter)*i/(ringCount-1);
    return {role:'hole-removable-sleeve',closed:true,points:circle(x,y,radius).map(([a,b])=>[a,b,process.firstLayerMm]),
      speedMmS:process.planarSpeedMmS};
  });
  return {id,construction:'curves',curves,sequence:true,repeat:{count,translation:[0,0,process.layerMm]},after:request.after??[]};
}

export async function editHoleSupports(source,request,operations){
  check(request&&typeof request==='object'&&!Array.isArray(request),'Hole support request must be an object.');
  check(['discover','membrane','tangent-bridge','sleeve'].includes(request.mode),'Choose discover, membrane, tangent-bridge or sleeve.');
  check(source.geometry&&source.geometry.shape!=='assembly','Hole supports currently require one whole planar component.');
  check((source.slices?.assignments??[]).every(a=>a.construction==='curves'||!a.construction&&a.part==null&&a.surface?.kind==='horizontal'),
    'Hole supports require whole-component planar Slice construction; existing Trace assignments are retained.');
  check(typeof operations.buildGeometry==='function','Hole supports need Geometry.buildGeometry.');
  const process=source.process??{},shell=operations.buildGeometry(source.geometry),toleranceMm=request.toleranceMm??.08;
  check(finite(toleranceMm)&&toleranceMm>0&&toleranceMm<=.25,'toleranceMm must be positive and at most 0.25 mm.');
  const candidates=findBedCounterbores(shell,operations.createSectionQuery,{...process,toleranceMm});
  if(request.mode==='discover')return {report:{candidates,scope:'Circular counterbores open to the bed in one upright planar component; section-based candidates require maker review.'}};
  const candidate=chooseCandidate(candidates,request,toleranceMm),id=request.id??`hole-${request.mode}`;
  check(typeof id==='string'&&/^[a-z][a-z0-9-]*$/.test(id),'Hole support id must be lowercase hyphenated.');
  const prior=source.slices?.assignments??[];
  check(!prior.some(a=>a.id===id),'An assignment already has this hole-support id; choose a new id or remove the old assignment first.');
  const assignment=request.mode==='membrane'?membrane(candidate,request,process,id,shell,operations.createSectionQuery,toleranceMm)
    :request.mode==='tangent-bridge'?tangentBridge(candidate,request,process,id,shell,operations.createSectionQuery,toleranceMm)
    :sleeve(candidate,request,process,id,shell,operations.createSectionQuery,toleranceMm);
  return {assignmentRequests:[...prior,assignment],report:{candidate,mode:request.mode,assignmentId:id,
    limits:'Experimental authored support only. Inspect exact deposition, removal access, material contact and drilling before export; no physical success is inferred.'}};
}
