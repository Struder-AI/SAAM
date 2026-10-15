// Selected extension record validation. No release-relative code is needed to
// validate a saved sleeve before regeneration.
export function advancedVaseRecordRuntime(){
  const requireThat=(condition,message)=>{if(!condition)throw Error(message);};
  // Patterns use sleeve coordinates, never independent world XYZ.

// A turns pattern's perimeter position is periodic; a sized pattern's arc is not.
// copies core/dimensions.mjs PRINT_RESOLUTION_MM; this runtime has no release-relative imports
const PRINT_RESOLUTION_MM=1e-3;
// copies core/dimensions.mjs BUILD_SCALE_MM; this runtime has no release-relative imports
const BUILD_SCALE_MM=1000;
// Joined paths meet to print resolution once mapped: a third of it per coordinate
// (arc or turn, height, offset) keeps the mapped gap inside it. A turn fraction
// scales by a perimeter of at most build scale.
const JOIN_MM=PRINT_RESOLUTION_MM/3,JOIN_TURNS=JOIN_MM/BUILD_SCALE_MM;
const sameSurfacePoint=(a,b,period)=>{const du=a[0]-b[0];return Math.abs(period?du-Math.round(du):du)<=(period?JOIN_TURNS:JOIN_MM)&&Math.abs(a[1]-b[1])<=JOIN_MM;};
const offsetAt=(path,i)=>Array.isArray(path.offsetMm)?path.offsetMm.at(i):(path.offsetMm??0);
const joined=(a,b,period)=>sameSurfacePoint(a.points.at(-1),b.points[0],period)&&Math.abs(offsetAt(a,-1)-offsetAt(b,0))<=JOIN_MM;

// Turns patterns repeat by a fixed advance in perimeter turns; sized patterns
// repeat a tile of fixed arc width, as many times per turn as the perimeter holds.
function validateSleevePattern(pattern,mode='continuous') {
  if(pattern===null)return;
  const keys=pattern&&Object.keys(pattern).sort().join(),sized=keys==='paths,riseMm,tileWidthMm,turns';
  requireThat(sized||keys==='advance,paths,repeats','Vase pattern needs explicit paths with either advance and repeats (perimeter turns) or tileWidthMm, riseMm and turns (millimetres of arc). Legacy tile records require explicit bundle migration.');
  if(sized){
    requireThat([pattern.tileWidthMm,pattern.riseMm].every(v=>Number.isFinite(v)&&v>0),'Sized pattern tileWidthMm and riseMm (per turn) must be positive.');
    requireThat(Number.isSafeInteger(pattern.turns)&&pattern.turns>=1,'Sized pattern turns must be a positive safe integer.');
  }else{
    requireThat(Array.isArray(pattern.advance)&&pattern.advance.length===2&&pattern.advance.every(Number.isFinite)&&pattern.advance[1]>0,'Pattern advance is [perimeter turns, rise in mm], with positive rise.');
    requireThat(Number.isSafeInteger(pattern.repeats)&&pattern.repeats>=1,'Pattern repeats must be a positive safe integer.');
  }
  const paths=pattern.paths;
  requireThat(Array.isArray(paths)&&paths.length>0,'A sleeve pattern needs ordered deposition paths.');
  for(const path of paths) {
    requireThat(path&&['beadHeightMm,points','beadHeightMm,offsetMm,points'].includes(Object.keys(path).sort().join()),'Each pattern path needs points and beadHeightMm, with optional offsetMm.');
    requireThat(Array.isArray(path.points)&&path.points.length>=2&&path.points.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)),
      sized?'Sized pattern points must be [arc mm from the tile start, height mm above the rising turn], not XYZ.':'Pattern points must be [unwrapped perimeter turns, height in mm], not XYZ.');
    const heights=Array.isArray(path.beadHeightMm)?path.beadHeightMm:path.points.map(()=>path.beadHeightMm);
    requireThat(heights.length===path.points.length&&heights.every(h=>Number.isFinite(h)&&h>=0),'Pattern beadHeightMm must be nonnegative or one height per point.');
    const offsets=Array.isArray(path.offsetMm)?path.offsetMm:path.points.map(()=>path.offsetMm??0);
    requireThat(offsets.length===path.points.length&&offsets.every(Number.isFinite),'Pattern offsetMm must be finite or one finite offset per point.');
    // Repeated consecutive points are dropped at mapping.
    for(let i=1;i<path.points.length;i++)
      requireThat(heights[i-1]+heights[i]>0,'Split travel into separate pattern paths; zero-deposition segments are not pattern paths.');
  }
  requireThat(paths[0].points[0][1]>=0,'The first pattern point cannot start below the selected print height.');
  // Every turn of a sized pattern starts its first tile at the seam, so a
  // changed tile count still joins the turn below.
  if(sized)requireThat(paths[0].points[0][0]===0,'Sized pattern arc starts at 0, the tile start.');
  if(mode==='continuous') {
    const period=sized?0:1,advance=sized?[pattern.tileWidthMm,0]:pattern.advance;
    for(let i=1;i<pattern.paths.length;i++)requireThat(joined(pattern.paths[i-1],pattern.paths[i],period),'Continuous pattern paths must meet on the sleeve, including offset; select segmented mode for gaps.');
    if(sized||pattern.repeats>1)requireThat(joined(pattern.paths.at(-1),{...pattern.paths[0],points:[pattern.paths[0].points[0].map((v,k)=>v+advance[k])]},period),
      'Continuous pattern repetitions must meet on the sleeve after advance; select segmented mode for gaps.');
  }
}


  return {validateSleevePattern};
}
