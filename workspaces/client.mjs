// The host owns viewer lifetime; extensions receive ordinary browser events.
const events=new EventSource('/api/events');
events.onmessage=({data})=>window.dispatchEvent(new CustomEvent('saam-workspace-event',{detail:JSON.parse(data)}));
window.addEventListener('pagehide',()=>events.close());
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
