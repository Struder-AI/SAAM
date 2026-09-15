import {watch} from 'node:fs';
// Disk remains the source of truth; notifications only trigger a fresh read.
// Watch the library so CLI tools and other MCP processes update the same viewer.
export function watchStudioChanges(root,onChange){
  let watcher,timer;const changed=new Set();
  try{watcher=watch(root,{recursive:true,persistent:false},(_event,name)=>{
    const path=String(name??'').replaceAll('\\','/');
    if(path.endsWith('.tmp'))return;
    let kind;
    if(path.startsWith('.studio-requests/')&&path.endsWith('.json'))kind='requests';
    else if(path==='.tour-progress.json')kind='tour';
    else if(/(^|\/)(plan|review|machine)\.json$/.test(path)||path.includes('/geometry/'))kind='print';
    if(!kind)return;changed.add(kind);clearTimeout(timer);
    timer=setTimeout(()=>{const kinds=[...changed];changed.clear();onChange(kinds);},35);timer.unref();
  });watcher.on('error',()=>watcher.close());}catch{/* Polling remains available on unsupported filesystems. */}
  return ()=>{clearTimeout(timer);watcher?.close();};
}
