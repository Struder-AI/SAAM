// User-selected objective: part bounding cylinder / average machine cylinder.
// "Average" is the arithmetic mean of the lower and upper enclosing diameters,
// not a frustum volume and not the maximum diameter over the entire height.
export function averageCylinderScore({baseTowerRadiusMm,topTowerRadiusMm,trackPairMm,machineHeightMm,partDiameterMm,partHeightMm}){
  const values=[baseTowerRadiusMm,topTowerRadiusMm,trackPairMm,machineHeightMm,partDiameterMm,partHeightMm];
  if(!values.every(v=>Number.isFinite(v)&&v>0))throw Error('Positive dimensions required');
  const baseDiameterMm=2*Math.hypot(baseTowerRadiusMm,trackPairMm/2),topDiameterMm=2*Math.hypot(topTowerRadiusMm,trackPairMm/2),averageDiameterMm=(baseDiameterMm+topDiameterMm)/2;
  const machineCylinderMm3=Math.PI/4*averageDiameterMm**2*machineHeightMm,partCylinderMm3=Math.PI/4*partDiameterMm**2*partHeightMm;
  return {baseDiameterMm,topDiameterMm,averageDiameterMm,machineHeightMm,machineCylinderMm3,partCylinderMm3,score:partCylinderMm3/machineCylinderMm3};
}
