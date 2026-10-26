
const requireThat=(condition,message)=>{if(!condition)throw Error(message);};

// Dimensional sources and height conventions live in the skill manual.
const COMMON={kind:'bin',xUnits:1,yUnits:1,toleranceMm:null};
const OPTIONS={
  bin:{heightUnits:3,wallMm:1.2,floorMm:2.25,compartmentsX:1,compartmentsY:1,stackingLip:true,magnetHoles:false},
  blank:{heightUnits:1,magnetHoles:false},
  baseplate:{floorMm:1.2,paddingLeftMm:0,paddingRightMm:0,paddingFrontMm:0,paddingBackMm:0}
};
// An edit merges into the saved parameters; a changed kind keeps only the common
// ones (footprint and tolerance), since its other settings mean something else.
export function editedGridfinityParameters(previous,changes){
  const kept=changes.kind===undefined||changes.kind===previous.kind?previous
    :Object.fromEntries(Object.entries(previous).filter(([key])=>key!=='kind'&&Object.hasOwn(COMMON,key)));
  return {...kept,...changes};
}
export function gridfinityParameters(input={},toleranceMm){
  requireThat(input&&typeof input==='object'&&!Array.isArray(input),'Gridfinity parameters must be an object.');
  const kind=input.kind??'bin';
  requireThat(Object.hasOwn(OPTIONS,kind),'Gridfinity kind must be bin, blank or baseplate.');
  const template={...COMMON,kind,...OPTIONS[kind],toleranceMm};
  requireThat(Object.keys(input).every(key=>Object.hasOwn(template,key)),'Unknown or inapplicable gridfinity parameter.');
  const p={...template,...input};
  const range=(key,min,max,integer=false)=>requireThat(Number.isFinite(p[key])&&p[key]>=min&&p[key]<=max&&(!integer||Number.isInteger(p[key])),`${key} must be ${integer?'an integer ':''}between ${min} and ${max}.`);
  range('xUnits',1,Number.MAX_SAFE_INTEGER,true);range('yUnits',1,Number.MAX_SAFE_INTEGER,true);range('toleranceMm',Number.MIN_VALUE,Infinity);
  if(kind!=='baseplate'){
    range('heightUnits',1,Number.MAX_SAFE_INTEGER,true);requireThat(typeof p.magnetHoles==='boolean','magnetHoles must be boolean.');
  }
  if(kind==='baseplate')for(const key of ['floorMm','paddingLeftMm','paddingRightMm','paddingFrontMm','paddingBackMm'])range(key,0,Infinity);
  if(kind==='bin'){
    range('heightUnits',1,Number.MAX_SAFE_INTEGER,true);range('wallMm',Number.MIN_VALUE,3.75);range('floorMm',Number.MIN_VALUE,Infinity);
    requireThat(p.wallMm<3.75,'Wall thickness must leave a positive inner corner radius.');
    range('compartmentsX',1,Number.MAX_SAFE_INTEGER,true);range('compartmentsY',1,Number.MAX_SAFE_INTEGER,true);
    requireThat(typeof p.stackingLip==='boolean','stackingLip must be boolean.');
    const floor=4.75+p.floorMm,shoulder=7*p.heightUnits;
    requireThat(floor+(p.stackingLip?3.8:0)<shoulder,'Bin floor leaves insufficient depth beneath the rim.');
    for(const [axis,count] of [['xUnits','compartmentsX'],['yUnits','compartmentsY']])
      requireThat((42*p[axis]-0.5-p.wallMm*(p[count]+1))/p[count]>0,'Compartments must retain positive clear width.');
  }
  return p;
}

// -> {geometry, notes}: the construction's notes; no material is empty geometry with a note.
export async function compileGridfinity(input={}, {constructGeometry,roundedRectangleProfile,loftProfiles,dimensions}={}){
  requireThat([constructGeometry,roundedRectangleProfile,loftProfiles].every(value=>typeof value==='function'),'Gridfinity needs shared Geometry construction and profile operations.');
  const p=gridfinityParameters(input,dimensions.FEATURE_TOLERANCE_MM);
  const loft=(levels,cx,cy)=>loftProfiles({profiles:levels.map(([z,widthMm,heightMm,radiusMm])=>roundedRectangleProfile({widthMm,heightMm,radiusMm,centerMm:[cx,cy,z]})),centers:[[cx,cy,levels[0][0]],[cx,cy,levels.at(-1)[0]]]});
  const block=(w,d,r,z0,z1,cx,cy)=>loft([[z0,w,d,r],[z1,w,d,r]],cx,cy);
  const union=operands=>({operation:'union',operands});
  const subtract=(a,b)=>({operation:'difference',operands:[a,b]});
  const w=42*p.xUnits-0.5,d=42*p.yUnits-0.5,cx=21*p.xUnits,cy=21*p.yUnits;
    let solid;
    if(p.kind==='baseplate'){
      // Padding widens the solid border beyond the socket grid, which stays at
      // the origin: left/front extend toward -X/-Y, right/back toward +X/+Y.
      const floor=p.floorMm,top=floor+4.75,{paddingLeftMm:l,paddingRightMm:r,paddingFrontMm:f,paddingBackMm:b}=p;
      solid=block(w+0.5+l+r,d+0.5+f+b,4,0,top,cx+(r-l)/2,cy+(b-f)/2);
      const sockets=[];
      for(let x=0;x<p.xUnits;x++)for(let y=0;y<p.yUnits;y++){
        // 5 mm reference socket, trimmed 0.25 mm below its zero-width rim.
        sockets.push(loft([
          [floor===0?-0.1:floor,36.3,36.3,1.15],
          [floor+0.35,36.3,36.3,1.15],
          [floor+1.05,37.7,37.7,1.85],
          [floor+2.85,37.7,37.7,1.85],
          [floor+5,42,42,4],
          [floor+5.1,42,42,4]
        ],21+42*x,21+42*y));
      }
      solid=subtract(solid,union(sockets));
    }else{
      const shoulder=7*p.heightUnits,top=shoulder+(p.stackingLip?3.8:0),parts=[];
      for(let x=0;x<p.xUnits;x++)for(let y=0;y<p.yUnits;y++)parts.push(loft([
        [0,35.6,35.6,0.8],[0.8,37.2,37.2,1.6],
        [2.6,37.2,37.2,1.6],[4.75,41.5,41.5,3.75]
      ],21+42*x,21+42*y));
      parts.push(block(w,d,3.75,4.75,top,cx,cy));
      solid=union(parts);
      if(p.kind==='bin'){
        const inset=p.wallMm,floor=4.75+p.floorMm;
        const cavityLevels=[[floor,w-2*inset,d-2*inset,3.75-inset]];
        if(p.stackingLip)cavityLevels.push(
          [shoulder-3.8,w-2*inset,d-2*inset,3.75-inset],
          [shoulder-1.2,w-5.2,d-5.2,1.15],
          [shoulder,w-5.2,d-5.2,1.15],
          [shoulder+0.7,w-3.8,d-3.8,1.85],
          [shoulder+2.5,w-3.8,d-3.8,1.85],
          [top,w-1.2,d-1.2,3.15],[top+0.1,w-1.2,d-1.2,3.15]);
        else cavityLevels.push([top+0.1,w-2*inset,d-2*inset,3.75-inset]);
        let cavity=loft(cavityLevels,cx,cy);
        const dividers=[],insideW=w-2*inset,insideD=d-2*inset;
        const cellW=(insideW-(p.compartmentsX-1)*inset)/p.compartmentsX;
        const cellD=(insideD-(p.compartmentsY-1)*inset)/p.compartmentsY;
        const cube=(size,offset)=>({operation:'translate',geometry:{operation:'box',size},offset});
        const dividerHeight=(p.stackingLip?shoulder:top+0.2)-floor;
        for(let i=1;i<p.compartmentsX;i++)dividers.push(cube([inset,d,dividerHeight],[0.25+inset+i*cellW+(i-1)*inset,0.25,floor]));
        for(let i=1;i<p.compartmentsY;i++)dividers.push(cube([w,inset,dividerHeight],[0.25,0.25+inset+i*cellD+(i-1)*inset,floor]));
        if(dividers.length)cavity=subtract(cavity,union(dividers));
        solid=subtract(solid,cavity);
      }
      if(p.magnetHoles){
        const holes=[];
        for(let x=0;x<p.xUnits;x++)for(let y=0;y<p.yUnits;y++)for(const dx of [-13,13])for(const dy of [-13,13])
          holes.push({operation:'translate',geometry:{operation:'cylinder',heightMm:2.5,radiusMm:3.25},offset:[21+42*x+dx,21+42*y+dy,-0.1]});
        solid=subtract(solid,union(holes));
      }
    }
    const [built]=await constructGeometry([solid],{toleranceMm:p.toleranceMm});
    return {geometry:{shape:'gridfinity',parameters:p,solid:built.geometry},notes:[...built.notes,...(built.empty?['The Gridfinity construction leaves no material.']:[])]};
}
