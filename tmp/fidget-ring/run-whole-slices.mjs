import {readFileSync,writeFileSync} from 'node:fs';
import {schedulePath} from '../../core/path/schedule.mjs';
const sourceId='afce18c6-a599-4a8d-8470-ed3dc09be7db';
const source=JSON.parse(readFileSync('C:/SAAM/local/Prints/concentric-groove-fidget-20261017/paths/'+sourceId+'.json','utf8'));
const started=performance.now(),reported={stage:null};
function progress(value){if(value.stage!==reported.stage){reported.stage=value.stage;console.log(JSON.stringify({elapsedMs:Math.round(performance.now()-started),...value}));}}
const result=schedulePath(source,{sourcePathId:sourceId,onProgress:progress});
const report={elapsedMs:performance.now()-started,summary:result.summary};
writeFileSync('tmp/fidget-ring/whole-slice-result.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
