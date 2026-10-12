// Experimental support for one bed-facing, round counterbore in a planar part.
// Geometry and Toolpath operations are supplied by the host; this package does
// not import engine implementation or depend on an installed SAAM checkout.
const check=(condition,message)=>{if(!condition)throw Error(message);};
// copies core/dimensions.mjs PRINT_RESOLUTION_MM; this runtime has no release-relative imports
const PRINT_RESOLUTION_MM=1e-3;
// copies core/dimensions.mjs ROUNDING_MM; this runtime has no release-relative imports
const ROUNDING_MM=PRINT_RESOLUTION_MM/1000;
// Cavity radii, layer heights and probe offsets are judged at print resolution.
const finite=v=>Number.isFinite(v);
const area=loop=>loop.reduce((sum,[x,y],i)=>{const [u,v]=loop[(i+1)%loop.length];return sum+x*v-u*y;},0)/2;
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const circle=(x,y,r)=>{
  const count=Math.max(48,Math.ceil(2*Math.PI*r/.25));// process scale: 0.25 mm chords
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
  if(Math.abs(crossSum)<ROUNDING_MM**2)return null;// rounding: twice an area, guards the centroid division
  const center=[xSum/(3*crossSum),ySum/(3*crossSum)];
  const radii=loop.map(point=>distance(point,center)),radius=radii.reduce((a,b)=>a+b,0)/radii.length;
  const deviation=loop.reduce((max,point,i)=>{
    const next=loop[(i+1)%loop.length],mid=[(point[0]+next[0])/2,(point[1]+next[1])/2];
    return Math.max(max,Math.abs(distance(point,center)-radius),Math.abs(distance(mid,center)-radius));
  },0);
  if(radius<=toleranceMm*4||deviation>Math.max(toleranceMm,radius*.025))return null;
  return {centerMm:center,radiusMm:radius};
}

// toleranceMm is process scale: the deviation a tessellated CAD circle may show.
// Returns {candidates, notes}; sections start at the component's lowest point.
export function findBedCounterbores(shell,createSectionQuery,{layerMm,lineWidthMm,toleranceMm=.08}={}){
  check(typeof createSectionQuery==='function','Hole detection needs Geometry.createSectionQuery.');
  check(finite(layerMm)&&layerMm>0&&finite(lineWidthMm)&&lineWidthMm>0,'Hole detection needs positive layer and bead widths.');
  const base=shell.bounds.min[2],notes=[],sectionAt=createSectionQuery(shell),height=shell.bounds.max[2]-base;
  if(Math.abs(base)>Math.max(layerMm/4,.05))notes.push(`The component's lowest point is ${base.toFixed(3)} mm above the bed.`);
  const step=Math.min(.5,Math.max(layerMm,.15));
  const firstZ=Math.min(height-step*.25,step*.5);
  if(!(firstZ>0&&height>step))return {candidates:[],notes:[...notes,'The component is too short for two horizontal sections.']};
  const nudges=[];
  const holesAt=z=>{
    const cut=sectionAt(base+z);nudges.push(cut.nudgedByMm);
    return cut.loops.map(loop=>roundHole(loop,toleranceMm)).filter(Boolean);
  };
  const tracks=holesAt(firstZ).map(lower=>({lower,previous:lower,last:firstZ,done:false}));
  const candidates=[];
  // The large bore must open at the bed. Match a smaller circular bore above it.
  for(let i=1;step*(i+.5)<height-step*.25+ROUNDING_MM&&tracks.some(track=>!track.done);i++){
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
        // separately selects complete repetitions in the open lower cavity.
        let low=last,high=z;
        while(high-low>toleranceMm/16){
          const mid=(low+high)/2,at=sectionAt(base+mid).loops.map(loop=>roundHole(loop,toleranceMm)).filter(Boolean)
            .find(h=>distance(h.centerMm,lower.centerMm)<=Math.max(toleranceMm*2,lineWidthMm/2));
          check(mid>low&&mid<high,'Counterbore shoulder refinement cannot progress at this coordinate precision.');
          if(at&&at.radiusMm>(previous.radiusMm+current.radiusMm)/2)low=mid;else high=mid;
        }
        const shoulderZMm=base+(low+high)/2;
        candidates.push({centerMm:lower.centerMm,lowerRadiusMm:previous.radiusMm,upperRadiusMm:current.radiusMm,shoulderZMm,
          detectedFromMm:[base+firstZ,base+z]});
        track.done=true;continue;
      }
      track.previous=current;track.last=z;
    }
  }
  const nudged=Math.max(...nudges);
  if(nudged>toleranceMm)notes.push(`Sections were nudged up to ${nudged.toFixed(3)} mm past coincident geometry; check the detected radii.`);
  return {candidates:candidates.filter((candidate,i)=>candidates.findIndex(other=>distance(other.centerMm,candidate.centerMm)<toleranceMm*2)===i),notes};
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

const sectionHole=(cut,candidate,toleranceMm)=>cut.loops.map(loop=>roundHole(loop,toleranceMm)).filter(Boolean)
  .find(h=>distance(h.centerMm,candidate.centerMm)<=Math.max(toleranceMm*2,.2));
// The measured cavity at z; where it narrows or holds material, the detected
// lower bore stands in and the notes say where.
function cavityAt(sectionAt,z,candidate,toleranceMm,notes){
  const cut=sectionAt(z),found=sectionHole(cut,candidate,toleranceMm);
  const open=found&&found.radiusMm+PRINT_RESOLUTION_MM>=candidate.lowerRadiusMm-toleranceMm;
  const hole=open?found:{centerMm:candidate.centerMm,radiusMm:candidate.lowerRadiusMm};
  if(!open)notes.push(`The counterbore cavity narrows near Z ${z.toFixed(3)} mm; the support there meets model material.`);
  if(cut.loops.some(loop=>area(loop)>0&&loop.every(point=>distance(point,hole.centerMm)<hole.radiusMm-toleranceMm)))
    notes.push(`Material lies inside the counterbore cavity near Z ${z.toFixed(3)} mm.`);
  return {hole,loops:cut.loops};
}

// The highest planar repetition below the shoulder with the whole cavity open;
// failing that, the highest one below the shoulder, noted.
function lastOpenSlice(candidate,process,sectionAt,toleranceMm,notes){
  const {firstLayerMm,layerMm}=process;
  check([firstLayerMm,layerMm].every(v=>finite(v)&&v>0),'Hole supports need planar firstLayerMm and layerMm.');
  const top=Math.floor((candidate.shoulderZMm-firstLayerMm+PRINT_RESOLUTION_MM)/layerMm);
  check(top>=0,'The counterbore shoulder lies below the first layer.');
  const open=Array.from({length:top+1},(_,i)=>firstLayerMm+(top-i)*layerMm).find(z=>{
    const hole=sectionHole(sectionAt(z),candidate,toleranceMm);
    return hole&&hole.radiusMm+PRINT_RESOLUTION_MM>=candidate.lowerRadiusMm-toleranceMm;
  });
  if(open===undefined)notes.push('No planar repetition has the whole lower cavity open; the highest one below the shoulder is used.');
  return open??firstLayerMm+top*layerMm;
}

function anchoredSpan(role,a,b,anchor,loops,process,repetition,notes){
  const d=distance(a,b),u=[(b[0]-a[0])/d,(b[1]-a[1])/d],before=[a[0]-anchor*u[0],a[1]-anchor*u[1],a[2]],after=[b[0]+anchor*u[0],b[1]+anchor*u[1],b[2]];
  if(!materialAt(loops,before)||!materialAt(loops,after))notes.push(`A ${role} attachment ends beyond the counterbore rim near Z ${a[2].toFixed(3)} mm.`);
  const samples=Math.ceil(d/Math.max(process.lineWidthMm/2,.1));
  if(Array.from({length:samples+1},(_,i)=>[a[0]+(b[0]-a[0])*i/samples,a[1]+(b[1]-a[1])*i/samples]).some(p=>materialAt(loops,p)))
    notes.push(`A ${role} free span crosses model material near Z ${a[2].toFixed(3)} mm.`);
  return [path(`${role}-attach`,[before,a],process),path(role,[a,b],process),path(`${role}-attach`,[b,after],process)]
    .map(curve=>repetition===undefined?curve:{...curve,repetitions:[repetition]});
}

function membrane(candidate,request,process,id,sectionAt,toleranceMm,notes){
  const [x,y]=candidate.centerMm,w=process.lineWidthMm;
  const pitch=request.pitchMm??w,overlap=request.anchorMm??w*1.5;
  check(finite(pitch)&&pitch>0&&finite(overlap)&&overlap>=0,'Membrane pitchMm must be positive and anchorMm nonnegative.');
  const z=lastOpenSlice(candidate,process,sectionAt,toleranceMm,notes),{hole,loops}=cavityAt(sectionAt,z,candidate,toleranceMm,notes),r=hole.radiusMm-w/2;
  const count=Math.max(1,Math.ceil(2*r/pitch)),curves=[];
  for(let i=0;i<count;i++){
    const dy=(i+.5-count/2)*pitch;
    if(Math.abs(dy)>=r)continue;
    const half=Math.sqrt(Math.max(0,r**2-dy**2));
    const anchorLength=Math.sqrt(Math.max(0,hole.radiusMm**2-dy**2))+overlap-half;
    curves.push(...anchoredSpan('hole-drill-membrane',[x-half,y+dy,z],[x+half,y+dy,z],anchorLength,loops,process,undefined,notes));
  }
  check(curves.length,'The selected bore is too small for a membrane stroke.');
  return trace(id,curves,request.after??[]);
}

function tangentBridge(candidate,request,process,id,sectionAt,toleranceMm,notes){
  const [x,y]=candidate.centerMm,small=candidate.upperRadiusMm,w=process.lineWidthMm;
  const anchor=request.anchorMm??w*1.5,offset=request.tangentOffsetMm??small+w/2;
  check(finite(anchor)&&anchor>=0&&finite(offset)&&offset>=0,'Tangent anchorMm and tangentOffsetMm must be nonnegative.');
  const top=lastOpenSlice(candidate,process,sectionAt,toleranceMm,notes);
  const topIndex=Math.round((top-process.firstLayerMm)/process.layerMm);
  const atStage=stage=>process.firstLayerMm+(topIndex-2+stage)*process.layerMm;
  check(atStage(0)>=process.firstLayerMm-PRINT_RESOLUTION_MM,'A three-stage tangent bridge needs three layers below the shoulder.');
  const curves=[];
  for(let stage=0;stage<2;stage++){
    const atZ=atStage(stage),{hole,loops}=cavityAt(sectionAt,atZ,candidate,toleranceMm,notes);
    const half=Math.sqrt((hole.radiusMm-w/2)**2-offset**2);
    if(!(half>0)){notes.push(`Tangent stage ${stage+1} has no free span inside the cavity and was skipped.`);continue;}
    for(const sign of [-1,1]){
      const a=stage===0?[x-half,y+sign*offset,atZ]:[x+sign*offset,y-half,atZ];
      const b=stage===0?[x+half,y+sign*offset,atZ]:[x+sign*offset,y+half,atZ];
      const anchorLength=Math.sqrt(hole.radiusMm**2-offset**2)+anchor-half;
      curves.push(...anchoredSpan(`hole-tangent-stage-${stage+1}`,a,b,anchorLength,loops,process,stage,notes));
    }
  }
  check(curves.length,'Tangent bridge has no free span inside the detected cavity.');
  // Third repetition marks the intended bore perimeter in four separate arcs.
  const radius=small+w/2,segments=Math.max(2,Math.ceil(Math.PI*radius/(2*.25)));
  const thirdZ=atStage(2),{hole:thirdHole}=cavityAt(sectionAt,thirdZ,candidate,toleranceMm,notes);
  if(radius+w/2>=thirdHole.radiusMm-toleranceMm)notes.push('The third-stage bore rim reaches the counterbore wall.');
  for(let quadrant=0;quadrant<4;quadrant++){
    const points=Array.from({length:segments+1},(_,i)=>{
      const a=(quadrant+i/segments)*Math.PI/2;return [x+radius*Math.cos(a),y+radius*Math.sin(a),thirdZ];
    });
    curves.push({...path('hole-tangent-stage-three',points,process),repetitions:[2]});
  }
  return {...trace(id,curves,request.after??[]),repeat:{count:3,translation:[0,0,0]},repetitionIds:['tangents-a','tangents-b','bore-rim']};
}

// A removable sleeve is an annulus from the bed to below the shoulder, closed by
// the host and sliced as concentric loops only, with no hop or retraction.
function sleeve(candidate,request,process,id,closeMeshPatchToPlane){
  const [x,y]=candidate.centerMm,w=process.lineWidthMm,xyGapMm=request.xyGapMm??.3,topGapMm=request.topGapMm??.2;
  check(finite(xyGapMm)&&xyGapMm>=0&&finite(topGapMm)&&topGapMm>=0,'Sleeve gaps must be nonnegative.');
  const outer=candidate.lowerRadiusMm-xyGapMm,inner=request.sleeveInnerRadiusMm??Math.max(w,candidate.upperRadiusMm-w);
  check(finite(inner)&&inner>0&&outer>inner,'The sleeve needs a positive inner radius below its outer clearance radius.');
  const top=candidate.shoulderZMm-topGapMm,rim=circle(x,y,outer),count=rim.length;
  const bore=Array.from({length:count},(_,i)=>[x+inner*Math.cos(i*2*Math.PI/count),y+inner*Math.sin(i*2*Math.PI/count)]);
  const roof={vertices:[...rim,...bore].map(([a,b])=>[a,b,top]),triangles:rim.flatMap((_,i)=>{const j=(i+1)%count;return [[i,j,count+j],[i,count+j,count+i]];})};
  const {solid,notes}=closeMeshPatchToPlane(roof,{triangleIndices:roof.triangles.map((_,i)=>i),planeZMm:0});
  return {solid,notes,assignment:{id,part:null,loops:Math.max(1,Math.ceil((outer-inner)/(2*w))),fillDensity:0,solidTop:0,solidBottom:0,
    process:{liftMm:0,retractMm:0},within:[{kind:'geometry',geometry:solid}],dependencies:{afterParts:[],beforeParts:[],after:request.after??[]},
    description:'Removable counterbore sleeve.'}};
}

export async function editHoleSupports(source,request,operations){
  check(request&&typeof request==='object'&&!Array.isArray(request),'Hole support request must be an object.');
  check(['discover','membrane','tangent-bridge','sleeve'].includes(request.mode),'Choose discover, membrane, tangent-bridge or sleeve.');
  check(source.geometry&&source.geometry.shape!=='assembly','Hole supports need a single component; this print is an assembly.');
  check(typeof operations.buildGeometry==='function','Hole supports need Geometry.buildGeometry.');
  const process=source.process??{},shell=operations.buildGeometry(source.geometry),toleranceMm=request.toleranceMm??.08;
  check(finite(toleranceMm)&&toleranceMm>0,'toleranceMm must be positive.');
  const {candidates,notes}=findBedCounterbores(shell,operations.createSectionQuery,{...process,toleranceMm});
  if(request.mode==='discover')return {report:{candidates,notes}};
  const prior=source.slices?.assignments??[];
  if(!prior.every(a=>a.construction==='curves'||!a.construction&&a.part==null&&a.surface?.kind==='horizontal'))
    notes.push('Some Slice assignments are not whole-component planar; inspect where their layers meet the support.');
  const candidate=chooseCandidate(candidates,request,toleranceMm),id=request.id??`hole-${request.mode}`;
  check(typeof id==='string'&&/^[a-z][a-z0-9-]*$/.test(id),'Hole support id must be lowercase hyphenated.');
  check(!prior.some(a=>a.id===id),'An assignment already has this hole-support id; choose a new id or remove the old assignment first.');
  const report={candidate,mode:request.mode,assignmentId:id,notes};
  if(request.mode==='sleeve'){
    const made=sleeve(candidate,request,process,id,operations.closeMeshPatchToPlane),original=source.geometry;
    const geometry=original.shape==='boolean'&&original.operation==='union'&&original.displayOperand===0
      ?{...original,operands:[...original.operands,made.solid]}:{shape:'boolean',operation:'union',operands:[original,made.solid],displayOperand:0};
    return {geometry,assignmentRequests:[made.assignment,...prior],report:{...report,notes:[...notes,...made.notes]}};
  }
  const sectionAt=operations.createSectionQuery(shell);
  const assignment=request.mode==='membrane'?membrane(candidate,request,process,id,sectionAt,toleranceMm,notes)
    :tangentBridge(candidate,request,process,id,sectionAt,toleranceMm,notes);
  return {assignmentRequests:[...prior,assignment],report};
}
