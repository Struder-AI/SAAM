// Gridfinity planner design: drawer or grid sizing, painted bin placements,
// intended filaments and build-plate packing. Construction belongs to the
// gridfinity and text extensions; this module only plans.
const requireThat=(condition,message)=>{if(!condition)throw Error(message);};
export const PITCH_MM=42;
const UNITS_MM={mm:1,cm:10,in:25.4};
const SHOULDER_MM=7,LIP_MM=3.8,PLATE_SOCKET_MM=4.75;
// Room left above the tallest bin when a drawer height is given.
const DRAWER_HEADROOM_MM=1;
// Bed margin and spacing between parts on a build plate.
const BED_MARGIN_MM=10,PART_GAP_MM=6;

// Bin types offered in the palette. Each placement copies its type's
// construction settings and may then change them individually.
export const CATALOG=Object.freeze([
  {type:'bin-1x1',code:'1×1',name:'Bin 1 × 1',kind:'bin',xUnits:1,yUnits:1},
  {type:'bin-2x1',code:'2×1',name:'Bin 2 × 1',kind:'bin',xUnits:2,yUnits:1},
  {type:'bin-1x2',code:'1×2',name:'Bin 1 × 2',kind:'bin',xUnits:1,yUnits:2},
  {type:'bin-2x2',code:'2×2',name:'Bin 2 × 2',kind:'bin',xUnits:2,yUnits:2},
  {type:'bin-3x1',code:'3×1',name:'Bin 3 × 1',kind:'bin',xUnits:3,yUnits:1},
  {type:'bin-3x2',code:'3×2',name:'Bin 3 × 2',kind:'bin',xUnits:3,yUnits:2},
  {type:'bin-4x1',code:'4×1',name:'Bin 4 × 1',kind:'bin',xUnits:4,yUnits:1},
  {type:'divided-2x1',code:'2×1|2',name:'Divided 2 × 1 · 2 cups',kind:'bin',xUnits:2,yUnits:1,compartmentsX:2},
  {type:'divided-3x1',code:'3×1|3',name:'Divided 3 × 1 · 3 cups',kind:'bin',xUnits:3,yUnits:1,compartmentsX:3},
  {type:'divided-2x2',code:'2×2|4',name:'Divided 2 × 2 · 4 cups',kind:'bin',xUnits:2,yUnits:2,compartmentsX:2,compartmentsY:2},
  {type:'blank-1x1',code:'B1×1',name:'Solid blank 1 × 1',kind:'blank',xUnits:1,yUnits:1}
].map(Object.freeze));
const catalogType=type=>CATALOG.find(entry=>entry.type===type);

export const DEFAULT_DESIGN=Object.freeze({
  schema:'saam-gridfinity-planner/1',
  sizing:{mode:'drawer',unit:'in',drawer:{width:null,depth:null,height:null},gridGapMm:4,grid:{xUnits:null,yUnits:null}},
  baseplate:{include:true,floorMm:1.2,filament:0},
  filaments:[{name:'PLA black',colour:'#2b2b2b'},{name:'PLA orange',colour:'#f07a1a'}],
  printer:{machineId:'bambu-h2d',packing:'filament'},
  bins:[]
});

const finite=(value,message)=>{requireThat(Number.isFinite(value),message);return value;};
const integer=(value,min,max,name)=>{requireThat(Number.isInteger(value)&&value>=min&&value<=max,`${name} must be a whole number from ${min} to ${max}.`);return value;};
const hex=value=>{requireThat(typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value),'Filament colours are six-digit hex colours such as #f07a1a.');return value.toLowerCase();};

// Whole cells and the border that fits them to the drawer. The grid gap is the
// total amount the baseplate is smaller than the drawer in each direction.
// Units are centred left to right; the leftover depth goes behind them, so they
// sit at the front of the drawer.
// A new plan has no size yet; nothing is planned until one is entered.
export function planGrid(sizing){
  if(sizing.mode==='grid'&&(sizing.grid.xUnits==null||sizing.grid.yUnits==null))return null;
  if(sizing.mode==='drawer'&&(sizing.drawer.width==null||sizing.drawer.depth==null))return null;
  if(sizing.mode==='grid')return {xUnits:sizing.grid.xUnits,yUnits:sizing.grid.yUnits,
    padding:{left:0,right:0,front:0,back:0},plateMm:[PITCH_MM*sizing.grid.xUnits,PITCH_MM*sizing.grid.yUnits],drawerMm:null};
  const scale=UNITS_MM[sizing.unit],gap=sizing.gridGapMm;
  const drawerMm=[sizing.drawer.width*scale,sizing.drawer.depth*scale,sizing.drawer.height===null?null:sizing.drawer.height*scale];
  const plateMm=[drawerMm[0]-gap,drawerMm[1]-gap];
  const xUnits=Math.floor(plateMm[0]/PITCH_MM),yUnits=Math.floor(plateMm[1]/PITCH_MM);
  requireThat(xUnits>=1&&yUnits>=1,`This drawer fits no whole ${PITCH_MM} mm cell after the ${gap} mm grid gap.`);
  const spareX=plateMm[0]-PITCH_MM*xUnits,spareY=plateMm[1]-PITCH_MM*yUnits;
  return {xUnits,yUnits,padding:{left:spareX/2,right:spareX/2,front:0,back:spareY},plateMm,drawerMm};
}

// Tallest bin, in 7 mm height units, that clears the drawer above the baseplate.
export function maxHeightUnits(design,grid=planGrid(design.sizing),stackingLip=true){
  const height=grid?.drawerMm?.[2];
  if(height==null)return 20;
  const floor=design.baseplate.include?design.baseplate.floorMm:-PLATE_SOCKET_MM;
  return Math.floor((height-DRAWER_HEADROOM_MM-floor-(stackingLip?LIP_MM:0))/SHOULDER_MM);
}

export function binHeightMm(bin){return SHOULDER_MM*bin.heightUnits+(bin.kind==='bin'&&bin.stackingLip?LIP_MM:0);}

function normalizeBin(raw,index,filamentCount){
  requireThat(raw&&typeof raw==='object'&&!Array.isArray(raw),'Each bin is a record.');
  const type=catalogType(raw.type);
  requireThat(type,`Unknown bin type ${raw.type}.`);
  const bin={
    id:typeof raw.id==='string'&&/^[a-z][a-z0-9-]{0,31}$/.test(raw.id)?raw.id:`bin-${index+1}`,
    type:type.type,kind:type.kind,xUnits:type.xUnits,yUnits:type.yUnits,
    x:integer(raw.x,0,999,'Bin column'),y:integer(raw.y,0,999,'Bin row'),
    heightUnits:integer(raw.heightUnits??(type.kind==='blank'?1:3),type.kind==='blank'?1:2,20,'Bin height'),
    magnetHoles:raw.magnetHoles??false,
    label:raw.label??'',
    filament:integer(raw.filament??0,0,filamentCount-1,'Bin filament')
  };
  requireThat(typeof bin.magnetHoles==='boolean','magnetHoles is true or false.');
  requireThat(typeof bin.label==='string'&&bin.label.length<=24&&!/[\r\n]/.test(bin.label),'A label is one line of at most 24 characters.');
  bin.label=bin.label.trim();
  if(type.kind==='bin'){
    bin.compartmentsX=integer(raw.compartmentsX??type.compartmentsX??1,1,16,'Compartments across');
    bin.compartmentsY=integer(raw.compartmentsY??type.compartmentsY??1,1,16,'Compartments deep');
    bin.stackingLip=raw.stackingLip??true;
    requireThat(typeof bin.stackingLip==='boolean','stackingLip is true or false.');
    for(const [units,count] of [[bin.xUnits,bin.compartmentsX],[bin.yUnits,bin.compartmentsY]])
      requireThat((PITCH_MM*units-0.5-1.2*(count+1))/count>=4,'Each compartment needs at least 4 mm clear width.');
  }
  return bin;
}

// Complete, checked design. Unknown fields are rejected so saved designs stay
// readable by the agent and the UI alike.
export function normalizeDesign(input,{printer}){
  requireThat(input&&typeof input==='object'&&!Array.isArray(input),'A gridfinity plan is a record.');
  const d={...structuredClone(DEFAULT_DESIGN),...structuredClone(input)};
  requireThat(Object.keys(d).every(key=>Object.hasOwn(DEFAULT_DESIGN,key)),'Unknown gridfinity plan field.');
  requireThat(d.schema===DEFAULT_DESIGN.schema,'Unsupported gridfinity plan schema.');
  const s={...DEFAULT_DESIGN.sizing,...d.sizing};
  requireThat(['drawer','grid'].includes(s.mode),'Size by drawer or by grid.');
  requireThat(Object.hasOwn(UNITS_MM,s.unit),'Drawer units are mm, cm or in.');
  s.drawer={...DEFAULT_DESIGN.sizing.drawer,...s.drawer};
  for(const key of ['width','depth'])requireThat(s.drawer[key]===null||finite(s.drawer[key],'Drawer sizes are numbers.')>0,'Drawer width and depth must be positive.');
  requireThat(s.drawer.height===null||Number.isFinite(s.drawer.height)&&s.drawer.height>0,'Drawer height is positive, or empty.');
  requireThat(finite(s.gridGapMm,'The grid gap is a number.')>=0&&s.gridGapMm<=40,'The grid gap is 0 to 40 mm.');
  const units=(value,name)=>value==null?null:integer(value,1,40,name);
  s.grid={xUnits:units(s.grid?.xUnits,'Grid width'),yUnits:units(s.grid?.yUnits,'Grid depth')};
  d.sizing=s;
  d.baseplate={...DEFAULT_DESIGN.baseplate,...d.baseplate};
  requireThat(typeof d.baseplate.include==='boolean','Choose whether to print the baseplate.');
  requireThat(Number.isFinite(d.baseplate.floorMm)&&d.baseplate.floorMm>=0&&d.baseplate.floorMm<=5,'Baseplate floor is 0 to 5 mm.');
  requireThat(Array.isArray(d.filaments)&&d.filaments.length>=1&&d.filaments.length<=16,'List one to sixteen intended filaments.');
  d.filaments=d.filaments.map(f=>{
    requireThat(f&&typeof f.name==='string'&&f.name.trim()&&f.name.length<=40,'Each filament needs a short name.');
    return {name:f.name.trim(),colour:hex(f.colour)};
  });
  d.baseplate.filament=integer(d.baseplate.filament,0,d.filaments.length-1,'Baseplate filament');
  d.printer={...DEFAULT_DESIGN.printer,...d.printer};
  requireThat(['filament','mixed'].includes(d.printer.packing),'Group plates by filament, or mix filaments on a plate.');
  const machine=printer(d.printer.machineId);
  requireThat(d.printer.packing==='filament'||machine.filamentChanges,`${machine.name} has no filament changes in SAAM; group plates by filament.`);
  const grid=planGrid(s);
  requireThat(Array.isArray(d.bins),'Bins are a list.');
  requireThat(grid||!d.bins.length,'Size the grid before placing bins.');
  d.bins=d.bins.map((bin,i)=>normalizeBin(bin,i,d.filaments.length));
  const ids=new Set(),taken=new Map();
  for(const bin of d.bins){
    if(ids.has(bin.id))bin.id=`bin-${ids.size+1}-${bin.x}-${bin.y}`;
    requireThat(!ids.has(bin.id),'Bin ids must be distinct.');ids.add(bin.id);
    requireThat(bin.x+bin.xUnits<=grid.xUnits&&bin.y+bin.yUnits<=grid.yUnits,`${bin.id} extends past the ${grid.xUnits} × ${grid.yUnits} grid.`);
    for(let x=bin.x;x<bin.x+bin.xUnits;x++)for(let y=bin.y;y<bin.y+bin.yUnits;y++){
      const key=x+','+y;requireThat(!taken.has(key),`${bin.id} overlaps ${taken.get(key)}.`);taken.set(key,bin.id);
    }
    const limit=maxHeightUnits(d,grid,bin.kind==='bin'&&bin.stackingLip);
    requireThat(bin.heightUnits<=limit,`${bin.id} is ${bin.heightUnits} units tall; the drawer fits ${limit}.`);
  }
  return d;
}

// Gridfinity extension parameters for one planned bin.
export function binParameters(bin){
  const common={kind:bin.kind,xUnits:bin.xUnits,yUnits:bin.yUnits,heightUnits:bin.heightUnits,magnetHoles:bin.magnetHoles};
  return bin.kind==='bin'?{...common,compartmentsX:bin.compartmentsX,compartmentsY:bin.compartmentsY,stackingLip:bin.stackingLip}:common;
}

// Split the baseplate into tiles that fit the bed. Only edges on the drawer
// boundary keep their padding; tile seams fall on cell boundaries.
export function baseplateTiles(design,grid,bed){
  const room=[bed.max[0]-bed.min[0]-2*BED_MARGIN_MM,bed.max[1]-bed.min[1]-2*BED_MARGIN_MM];
  const p=grid.padding,axes=[[grid.xUnits,room[0]-p.left-p.right],[grid.yUnits,room[1]-p.front-p.back]];
  const split=axes.map(([units,space])=>{
    const most=Math.floor(space/PITCH_MM);
    requireThat(most>=1,'The baseplate border alone is wider than the bed.');
    const count=Math.ceil(units/most),base=Math.floor(units/count),extra=units%count;
    return Array.from({length:count},(_,i)=>base+(i<extra?1:0));
  });
  const tiles=[];let y0=0;
  for(const [j,ny] of split[1].entries()){
    let x0=0;
    for(const [i,nx] of split[0].entries()){
      const padding={left:i===0?p.left:0,right:i===split[0].length-1?p.right:0,front:j===0?p.front:0,back:j===split[1].length-1?p.back:0};
      tiles.push({id:`baseplate-${j+1}-${i+1}`,kind:'baseplate',x:x0,y:y0,xUnits:nx,yUnits:ny,padding,filament:design.baseplate.filament,
        footprintMm:[PITCH_MM*nx+padding.left+padding.right,PITCH_MM*ny+padding.front+padding.back],heightMm:design.baseplate.floorMm+PLATE_SOCKET_MM,
        // Local footprint minimum relative to the construction origin.
        originMm:[-padding.left,-padding.front]});
      x0+=nx;
    }
    y0+=ny;
  }
  return tiles;
}

// Shelf packing: tallest-footprint first into rows across the bed, rows from
// front to back, a new plate when the bed is full.
function packGroup(items,bed){
  const width=bed.max[0]-bed.min[0]-2*BED_MARGIN_MM,depth=bed.max[1]-bed.min[1]-2*BED_MARGIN_MM;
  const sorted=[...items].sort((a,b)=>b.footprintMm[1]-a.footprintMm[1]||b.footprintMm[0]-a.footprintMm[0]||a.id.localeCompare(b.id));
  const plates=[];let plate=null,rowY=0,rowDepth=0,cursor=0;
  for(const item of sorted){
    const [w,h]=item.footprintMm;
    requireThat(w<=width&&h<=depth,`${item.id} (${w.toFixed(0)} × ${h.toFixed(0)} mm) does not fit the bed.`);
    requireThat(item.heightMm<=bed.max[2]-bed.min[2],`${item.id} is taller than the printer's build height.`);
    if(plate&&cursor+w>width){rowY+=rowDepth+PART_GAP_MM;rowDepth=0;cursor=0;}
    if(!plate||rowY+h>depth){plate={items:[]};plates.push(plate);rowY=0;rowDepth=0;cursor=0;}
    plate.items.push({...item,bedMm:[bed.min[0]+BED_MARGIN_MM+cursor,bed.min[1]+BED_MARGIN_MM+rowY]});
    cursor+=w+PART_GAP_MM;rowDepth=Math.max(rowDepth,h);
  }
  return plates;
}

// Every printable item and the build plates they are packed onto. Plate
// filaments list only the colours that plate uses, in design order.
export function planPlates(design,machine){
  const grid=planGrid(design.sizing),bed=machine.printableMm;
  if(!grid)return [];
  const items=design.bins.map(bin=>({id:bin.id,kind:bin.kind,bin,filament:bin.filament,
    footprintMm:[PITCH_MM*bin.xUnits-0.5,PITCH_MM*bin.yUnits-0.5],heightMm:binHeightMm(bin),originMm:[0.25,0.25]}));
  if(design.baseplate.include)items.push(...baseplateTiles(design,grid,bed));
  const groups=design.printer.packing==='mixed'?[items]:design.filaments.map((_,index)=>items.filter(item=>item.filament===index));
  const plates=groups.filter(group=>group.length).flatMap(group=>packGroup(group,bed));
  return plates.map((plate,index)=>{
    const used=[...new Set(plate.items.map(item=>item.filament))].sort((a,b)=>a-b);
    return {id:`plate-${String(index+1).padStart(2,'0')}`,filaments:used,items:plate.items};
  });
}

export function summary(design,machine){
  const grid=planGrid(design.sizing),counts={};
  for(const bin of design.bins){
    const key=`${bin.type}|${bin.heightUnits}|${bin.filament}`;
    counts[key]??={type:bin.type,code:catalogType(bin.type).code,heightUnits:bin.heightUnits,filament:bin.filament,count:0};counts[key].count++;
  }
  const cells=grid?grid.xUnits*grid.yUnits:0,used=design.bins.reduce((n,b)=>n+b.xUnits*b.yUnits,0);
  let plates=[],error=null;
  try{plates=planPlates(design,machine);}catch(e){error=e.message;}
  return {grid,maxHeightUnits:maxHeightUnits(design,grid),cells,usedCells:used,counts:Object.values(counts),plates,error,
    printer:{id:machine.id,name:machine.name,printableMm:machine.printableMm}};
}
