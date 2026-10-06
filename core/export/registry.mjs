import {requireThat,distance} from '../private/export/numeric.mjs';
import {exportGriffin} from './griffin.mjs';
import {exportBambu} from './bambu.mjs';
import {exportDobot} from './dobot.mjs';
import {exportDenso} from './denso.mjs';
import {prepareExportPath} from './prepare-path.mjs';
import {preparedTravelAdvisory} from './travel-advisory.mjs';
// Each adapter writes a prepared path and returns {bytes, report}.
const adapters={
  'denso-pacscript':exportDenso,
  'griffin-gcode':exportGriffin,
  'bambu-gcode':exportBambu,
  'dobot-lua':exportDobot
};
export function outputAdapter(plan,machine){
  const declaration=machine.outputs.find(o=>o.id===plan.output);
  requireThat(declaration,'Machine does not declare the requested output.');
  requireThat(declaration.implemented!==false&&adapters[declaration.id],declaration.reason??`No exporter for ${declaration.id}.`);
  return adapters[declaration.id];
}
// The prepared path's own totals: requested timing and commanded volume.
function pathTotals(prepared){
  let from=prepared.initialPosition,moves=0,seconds=0,volumeMm3=0;
  for(const action of prepared.actions){
    if(action.kind==='move'){moves++;seconds+=action.durationSeconds??distance(from,action.to)/action.speedMmS;volumeMm3+=action.volumeMm3;from=action.to;}
    else if(action.kind==='extrude'){seconds+=action.volumeMm3/action.flowMm3S;volumeMm3+=action.volumeMm3;}
    else if(action.kind==='dwell')seconds+=action.seconds;
  }
  return {moves,seconds,volumeMm3};
}
// Prepares the path once and writes it. The report is what Bundle stores:
// the adapter's notice, limitations and estimates (the path's own totals when
// the adapter gives none), the move count and the short-travel advisory.
export function exportProgram(path,plan,machine,release){
  const write=outputAdapter(plan,machine),prepared=prepareExportPath(path,plan,machine);
  const {bytes,report}=write(prepared,plan,machine,release),totals=pathTotals(prepared);
  return {bytes,report:{limitations:[],...report,moves:totals.moves,seconds:report.seconds??totals.seconds,
    volumeMm3:report.volumeMm3??totals.volumeMm3,shortTravel:preparedTravelAdvisory(prepared,plan)}};
}
