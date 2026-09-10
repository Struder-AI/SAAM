// SYNTHETIC TEST ONLY. These numbers are invented to test software interfaces;
// they describe no robot, measured calibration, human approval or real job.
export function syntheticDobotSetup(plan){
  plan.setup.nozzleC=215;plan.setup.bedC=0;
  Object.assign(plan.setup.dobot,{
    configurationSource:'SYNTHETIC TEST ONLY — invented fixture, never use on hardware',
    toolFrame:1,userFrame:2,scaleX:1.02,scaleY:0.98,offsetXMm:-100,offsetYMm:-80,bedZMm:10,rDeg:0,
    extrusionOutput:'DO_1',maxLinearSpeedMmS:100,maxLinearAccelMmS2:1000,accelerationPercent:20,
    extrusionRateMm3S:1.2,relayPolicy:'stroke-stop-start-unblended',temperatureControl:'external-preheated',
    initialPositionMm:[200,180,20],workspaceMinMm:[-150,-100,0],workspaceMaxMm:[300,200,250]
  });
  return plan;
}
