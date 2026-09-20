import {loadMachine,startupPosition,startupRetracted} from '../../machine/profile.mjs';
import {defaults} from '../../print/plan.mjs';
import {createPlanningState} from '../../path/planning.mjs';
export function primingFixtures(){
  return ['default','tool1','unretracted','support-extents','only-rear','no-room','no-settings','empty','travel-only','stationary','volumes','invalid-length','invalid-gap','motion-bounds','reverse-start'].map(name=>{
    const machine=loadMachine(),plan=defaults(machine);
    if(name==='tool1')plan.setup.tool=1;
    if(name==='unretracted')plan.process.retractMm=0;
    if(name==='no-settings')delete machine.startup.primingStrokes;
    if(name==='invalid-length')machine.startup.primingStrokes.lineLengthMm=0;
    if(name==='invalid-gap')machine.startup.primingStrokes.clearanceMm=NaN;
    const state=createPlanningState({start:name==='reverse-start'?[250,220,4]:startupPosition(machine,plan),process:plan.process,machine,generatorVersion:'test',retracted:startupRetracted(machine,plan)});
    let geometry={min:[140,100,0],max:[148,108,2]};
    const stroke={points:[[140,100,.2],[148,108,.2]],beadAreaMm2:.08},results=[{operations:[{strokes:[stroke]}]}];
    if(name==='support-extents')stroke.points=[[110,80,.2],[200,160,.2]];
    if(name==='only-rear'){geometry={min:[0,0,0],max:[325,220,2]};stroke.points=[[0,0,.2],[329,220,.2]];}
    if(name==='no-room')geometry={min:[0,0,0],max:[330,240,2]};
    if(name==='motion-bounds')state.motionBounds={min:[80,40,0],max:[230,200,100]};
    if(name==='empty')results.length=0;
    if(name==='travel-only')stroke.beadAreaMm2=0;
    if(name==='stationary'){delete stroke.beadAreaMm2;stroke.stationaryExtrusion={volumeMm3:1};stroke.points=[[140,100,.2]];}
    if(name==='volumes'){delete stroke.beadAreaMm2;stroke.volumesMm3=[.08];}
    return {name,state,geometry,results};
  });
}
