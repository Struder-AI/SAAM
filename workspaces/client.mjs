// The host owns viewer lifetime; extensions receive ordinary browser events.
const events=new EventSource('/api/events');
events.onmessage=({data})=>window.dispatchEvent(new CustomEvent('saam-workspace-event',{detail:JSON.parse(data)}));
window.addEventListener('pagehide',()=>events.close());
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});

function presentWorkspaceInformation(extension){
  const place=document.querySelector('[data-saam-workspace-info]');
  if(!place)return;
  const details=document.createElement('details'),heading=document.createElement('summary');
  heading.textContent='Credits & support';details.append(heading);
  for(const credit of extension.credits??[]){
    const row=document.createElement('p');row.textContent=credit.name+' — '+credit.role;details.append(row);
  }
  if(!extension.credits?.length){const row=document.createElement('p');row.textContent='Contributor attribution has not been declared.';details.append(row);}
  const support=extension.support,row=document.createElement('p');
  row.textContent=support?`${support.status[0].toUpperCase()+support.status.slice(1)} support · ${support.maintainer||'No designated maintainer'}. ${support.scope}`:'Support status has not been declared.';
  details.append(row);place.replaceChildren(details);
}
async function loadWorkspaceInformation(){
  const response=await fetch('/api/design');
  if(!response.ok)return;
  const state=await response.json();presentWorkspaceInformation(state.extension);
}
void loadWorkspaceInformation();
