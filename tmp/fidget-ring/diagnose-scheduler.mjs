import {readFileSync} from 'node:fs';
import {schedulePath} from 'file:///C:/SAAM/app/core/path/schedule.mjs';
import {resolveSourceOrder} from 'file:///C:/SAAM/app/core/path/compose.mjs';
import {prepareCurvePath} from 'file:///C:/SAAM/app/core/path/curve-path.mjs';
const source=JSON.parse(readFileSync('C:/SAAM/local/Prints/concentric-groove-fidget-20261017/paths/725b72f5-cfc9-4a2f-b326-5d9045b1a0a0.json','utf8'));
if(process.argv.includes('--outer-only'))source.operations=Object.fromEntries(Object.entries(source.operations).filter(([,op])=>op.part==='outer-ring'));
const started=performance.now(),reported={stage:null,percent:null};
function progress(p){
  const percent=p.total?Math.floor(p.completed*100/p.total):null;
  if(reported.stage===p.stage&&reported.percent===percent)return;
  Object.assign(reported,{stage:p.stage,percent});
  console.log(JSON.stringify({elapsedMs:Math.round(performance.now()-started),...p}));
}
const result=process.argv.includes('--order-only')
  ?resolveSourceOrder(source,prepareCurvePath(source),{onProgress:progress})
  :schedulePath(source,{sourcePathId:'725b72f5-cfc9-4a2f-b326-5d9045b1a0a0',onProgress:progress});
console.log(JSON.stringify({completed:true,elapsedMs:performance.now()-started,summary:result.summary}));
