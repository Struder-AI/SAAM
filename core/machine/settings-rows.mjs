// Saved settings are presentation data; reading them never executes a writer.
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
