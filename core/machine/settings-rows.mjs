// Saved settings are presentation data; reading them never executes a writer.
import {ROUNDING_MM} from '../dimensions.mjs';
const label=key=>key.replace(/([a-z\d])([A-Z])/g,'$1 $2').replace(/^./,letter=>letter.toUpperCase());
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export function settingsRows(plan,machine){
  const labels=machine?.settingsLabels??{},rows=[];
  function visit(value,path){
    if(record(value))for(const [key,child] of Object.entries(value))visit(child,[...path,key]);
    else if(Array.isArray(value)&&value.some(record))value.forEach((child,index)=>visit(child,[...path,String(index+1)]));
    else rows.push([labels[path.join('.')]??path.map(label).join(' · '),
      value==null?'Not set':Array.isArray(value)?value.join(', '):typeof value==='boolean'?(value?'Yes':'No'):String(value)]);
  }
  visit(plan.setup??{},[]);
  return rows;
}

// Settings' presentation of a recipe on one machine profile: its settings rows,
// startup basis, program file name from the selected output's declaration and
// a bed-fit warning. machine is the resolved profile, or null when none is
// selected or the labelled machine is not installed.
export function machinePresentation(plan,machine,geometry){
  if(!machine)return {settingsRows:[],setupBasis:null,exportName:null,limitations:[],outputAvailability:'Select a printer before Export.'};
  const extension=machine.outputs?.find(output=>output.id===plan.output)?.extension;
  const exportName=typeof extension==='string'&&/^\.[a-z0-9.]+$/.test(extension)?'part'+extension:null;
  return {settingsRows:settingsRows(plan,machine),setupBasis:plan.setup?.startupVerified?'Confirmed startup behavior':machine.startup?.validation,
    exportName,limitations:bedFit(plan,machine,geometry),outputAvailability:null};
}

// A warning only: the part at its placement overhangs the selected tool's bed.
function bedFit(plan,machine,geometry){
  const part=geometry?.boundsMm,bed=machine.tools?.find(t=>t.index===plan.setup?.tool)?.bounds??machine.bounds,offset=[plan.placement?.xMm??0,plan.placement?.yMm??0];
  if(!part||!bed||[0,1].every(i=>part.min[i]+offset[i]>=bed.min[i]-ROUNDING_MM&&part.max[i]+offset[i]<=bed.max[i]+ROUNDING_MM))return [];
  return [`The part at placement X ${offset[0]} / Y ${offset[1]} mm does not fit the ${machine.name} bed.`];
}
