// Selected technique checks supplement the structural saved-record checks.
export function vaseWallRecordRuntime(){
  const requireThat=(condition,message)=>{if(!condition)throw Error(message);};
function validateSleeveAssignment(a){
  requireThat(a.filament===null||Number.isInteger(a.filament)&&a.filament>=0,'Sleeve filament must be null or a filament index.');
  requireThat(Array.isArray(a.after)&&a.after.every(id=>typeof id==='string'&&id.length),'Sleeve after lists operation ids.');
  requireThat(['continuous','segmented'].includes(a.pathMode),'Sleeve path mode must be continuous or segmented.');
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

  return {validateSleeveAssignment};
}
