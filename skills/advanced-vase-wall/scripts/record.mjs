// Selected extension record validation. No release-relative code is needed to
// validate a saved sleeve before regeneration.
export function advancedVaseRecordRuntime(){
  const requireThat=(condition,message)=>{if(!condition)throw Error(message);};
  const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));// Patterns use sleeve coordinates, never independent world XYZ.

const sameSurfacePoint=(a,b)=>Math.abs((a[0]-b[0])-Math.round(a[0]-b[0]))<=1e-10&&Math.abs(a[1]-b[1])<=1e-9;
const offsetAt=(path,i)=>Array.isArray(path.offsetMm)?path.offsetMm.at(i):(path.offsetMm??0);
const joined=(a,b)=>sameSurfacePoint(a.points.at(-1),b.points[0])&&Math.abs(offsetAt(a,-1)-offsetAt(b,0))<=1e-9;

function validateSleevePattern(pattern,mode='continuous') {
  if(pattern===null)return;
  requireThat(pattern&&Object.keys(pattern).sort().join()==='advance,paths,repeats','Vase pattern needs explicit paths, advance and repeats. Legacy tile records require explicit bundle migration.');
  requireThat(Array.isArray(pattern.advance)&&pattern.advance.length===2&&pattern.advance.every(Number.isFinite)&&pattern.advance[1]>0,'Pattern advance is [perimeter turns, rise in mm], with positive rise.');
  requireThat(Number.isSafeInteger(pattern.repeats)&&pattern.repeats>=1,'Pattern repeats must be a positive safe integer.');
  const paths=pattern.paths;
  requireThat(Array.isArray(paths)&&paths.length>0,'A sleeve pattern needs ordered deposition paths.');
  for(const path of paths) {
    requireThat(path&&['beadHeightMm,points','beadHeightMm,offsetMm,points'].includes(Object.keys(path).sort().join()),'Each pattern path needs points and beadHeightMm, with optional offsetMm.');
    requireThat(Array.isArray(path.points)&&path.points.length>=2&&path.points.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)),'Pattern points must be [unwrapped perimeter turns, height in mm], not XYZ.');
    const heights=Array.isArray(path.beadHeightMm)?path.beadHeightMm:path.points.map(()=>path.beadHeightMm);
    requireThat(heights.length===path.points.length&&heights.every(h=>Number.isFinite(h)&&h>=0),'Pattern beadHeightMm must be nonnegative or one height per point.');
    const offsets=Array.isArray(path.offsetMm)?path.offsetMm:path.points.map(()=>path.offsetMm??0);
    requireThat(offsets.length===path.points.length&&offsets.every(Number.isFinite),'Pattern offsetMm must be finite or one finite offset per point.');
    for(let i=1;i<path.points.length;i++) {
      requireThat(distance(path.points[i-1],path.points[i])>0||offsets[i-1]!==offsets[i],'Remove duplicate consecutive pattern points.');
      requireThat(heights[i-1]+heights[i]>0,'Split travel into separate pattern paths; zero-deposition segments are not pattern paths.');
    }
  }
  requireThat(paths[0].points[0][1]>=0,'The first pattern point cannot start below the selected print height.');
  if(mode==='continuous') {
    for(let i=1;i<pattern.paths.length;i++)requireThat(joined(pattern.paths[i-1],pattern.paths[i]),'Continuous pattern paths must meet on the sleeve, including offset; select segmented mode for gaps.');
    if(pattern.repeats>1)requireThat(joined(pattern.paths.at(-1),{...pattern.paths[0],points:[pattern.paths[0].points[0].map((v,k)=>v+pattern.advance[k])]}),
      'Continuous pattern repetitions must meet on the sleeve after advance; select segmented mode for gaps.');
  }
}


const SLEEVE_DEFAULTS={zStartMm:0,zEndMm:null,endTransition:'level',pattern:null,pathMode:'continuous',meshSleeve:null,sampleStepMm:1,toleranceMm:0.02,boundaryToleranceMm:0.02,minFeatureMm:0.4,sleeveToleranceMm:0.08};
const sleeveAssignment=({id,...options})=>structuredClone({id,construction:'sleeve',part:null,filament:null,process:null,after:[],...SLEEVE_DEFAULTS,...options});
function validateSleeveAssignment(a,{parts}={}){
  requireThat(a&&a.construction==='sleeve'&&Object.keys(a).sort().join()===Object.keys(sleeveAssignment({id:a.id})).sort().join(),'Invalid sleeve assignment fields.');
  requireThat(typeof a.id==='string'&&/^[a-z][a-z0-9-]*$/.test(a.id),'Invalid sleeve assignment id.');
  requireThat(a.part===null||parts?.includes(a.part),'Sleeve names an unknown part.');
  requireThat(a.filament===null||Number.isInteger(a.filament)&&a.filament>=0,'Sleeve filament must be null or a filament index.');
  requireThat(Array.isArray(a.after)&&a.after.every(id=>typeof id==='string'&&id.length),'Sleeve after lists operation ids.');
  requireThat(['continuous','segmented'].includes(a.pathMode),'Sleeve path mode must be continuous or segmented.');
  validateSleevePattern(a.pattern,a.pathMode);
  requireThat(a.pattern!==null||a.pathMode==='continuous','Segmented mode requires a sleeve pattern.');
  requireThat(['spiral','level'].includes(a.endTransition),'Sleeve ending transition must be spiral or level.');
  requireThat(Number.isFinite(a.zStartMm)&&a.zStartMm>=0&&(a.zEndMm===null||Number.isFinite(a.zEndMm)&&a.zEndMm>a.zStartMm),'Sleeve needs nonnegative start and null or greater end height.');
  for(const key of ['sampleStepMm','toleranceMm','boundaryToleranceMm','minFeatureMm'])requireThat(Number.isFinite(a[key])&&a[key]>0,`Sleeve ${key} must be positive.`);
  requireThat(Number.isFinite(a.sleeveToleranceMm)&&a.sleeveToleranceMm>=0,'Sleeve fit tolerance must be nonnegative.');
  if(a.meshSleeve===null)return;
  const fit=a.meshSleeve;
  requireThat(fit&&Object.keys(fit).sort().join()==='circumferentialControls,contactSide,detailToleranceMm,fidelity,heightControls','Invalid mesh sleeve settings.');
  requireThat(Number.isFinite(fit.fidelity)&&fit.fidelity>=0&&fit.fidelity<=1&&['inside','outside'].includes(fit.contactSide),'Mesh sleeve needs fidelity 0–1 and inside/outside contact.');
  requireThat(Number.isSafeInteger(fit.circumferentialControls)&&fit.circumferentialControls>=8&&Number.isSafeInteger(fit.heightControls)&&fit.heightControls>=4,'Mesh sleeve needs at least 8 circumferential and 4 height controls.');
  requireThat(Number.isFinite(fit.detailToleranceMm)&&fit.detailToleranceMm>0,'Mesh sleeve detail tolerance must be positive.');
}

  return {SLEEVE_DEFAULTS,sleeveAssignment,validateSleeveAssignment,validateSleevePattern};
}
