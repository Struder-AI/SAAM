// Static viewer disk authoring: one chosen directory, serialized fresh-document writes.
const FILE_AUTHOR={directory:null,resume:null,pending:[],writing:false};
function authorFolderButton() {
  const b=document.getElementById('author-files');b.hidden=AUTHOR.server||!AUTHORING.folder;
  b.disabled=!('showDirectoryPicker' in window)||FILE_AUTHOR.writing;
  b.textContent=FILE_AUTHOR.directory?'Live save on':'Connect save folder';
  b.title='Choose '+(AUTHORING.folder?.path||'the map files folder')+' to save each move directly';
}
async function authorDirectoryRecord(directory) {
  const db=await new Promise((done,fail)=>{const r=indexedDB.open('devmap-files:'+location.pathname,1);
    r.onupgradeneeded=()=>r.result.createObjectStore('handles');r.onsuccess=()=>done(r.result);r.onerror=()=>fail(r.error);});
  try{return await new Promise((done,fail)=>{const t=db.transaction('handles',directory?'readwrite':'readonly'),s=t.objectStore('handles');
    const r=directory?s.put(directory,AUTHORING.set):s.get(AUTHORING.set);let value;
    r.onsuccess=()=>value=r.result;t.oncomplete=()=>done(value);t.onerror=()=>fail(t.error);t.onabort=()=>fail(t.error);});}
  finally{db.close();}
}
async function authorFile(path,directory=FILE_AUTHOR.directory) {
  const parts=path.split('/');if(parts.some(p=>!p||p==='..'||p==='.'||p.includes('\\')))throw Error('Invalid map file path');
  for(const part of parts.slice(0,-1))directory=await directory.getDirectoryHandle(part);
  return directory.getFileHandle(parts.at(-1));
}
async function authorFileDocuments(directory=FILE_AUTHOR.directory) {
  const [architecture,layout]=await Promise.all([authorFile(AUTHORING.folder.architecture,directory),authorFile(AUTHORING.folder.layout,directory)]);
  const [a,l]=await Promise.all([architecture.getFile().then(f=>f.text()),layout.getFile().then(f=>f.text())]);
  const own=JSON.parse(l),arch=JSON.parse(a);
  if(own.schema!==1||!own.maps||!Array.isArray(arch.nodes))throw Error('This folder does not contain the expected map files');
  const known=new Set(arch.nodes.map(n=>'@cluster/'+n.id));
  for(const n of Object.keys(AUTHORING.maps['0']||{}))if(!n.includes('external:')&&n.startsWith('@cluster/')&&!known.has(n)&&n!=='@cluster/(unowned)')
    throw Error('This folder belongs to a different architecture');
  return {architecture,layout,a,own};
}
async function authorWriteDocument(handle,text) {
  const w=await handle.createWritable();
  try{await w.write(text);await w.close();}catch(e){try{await w.abort();}catch{}throw e;}
}
function authorQueueFiles(map,set,initial={}) {
  FILE_AUTHOR.pending.push(structuredClone({map,set,initial}));
  if(FILE_AUTHOR.directory)authorFlushFiles();
}
async function authorFlushFiles() {
  if(FILE_AUTHOR.writing||!FILE_AUTHOR.directory)return;
  FILE_AUTHOR.writing=true;authorFolderButton();
  try{while(FILE_AUTHOR.pending.length) {
    if(await FILE_AUTHOR.directory.queryPermission({mode:'readwrite'})!=='granted')throw Error('Reconnect the save folder to allow writing');
    const edit=FILE_AUTHOR.pending[0],docs=await authorFileDocuments(),next=positionDocuments({architecture:docs.a,layout:docs.own,...edit});
    authorSay('saving to map files…');
    if(next.architecture)await authorWriteDocument(docs.architecture,next.architecture);
    if(next.layout)await authorWriteDocument(docs.layout,layoutText(next.layout));
    FILE_AUTHOR.pending.shift();
  }
  authorSay('saved to map files · all pages');}
  catch(e){authorSay('file save failed: '+e.message+' · changes remain here · Export layout',true);}
  finally{FILE_AUTHOR.writing=false;authorFolderButton();}
}
function authorRecoverFiles() {
  // Only browser changes relative to this build are pending; baked defaults never overwrite disk.
  for(const [map,boxes] of Object.entries(AUTHOR.maps)) {
    const set={};for(const [id,p] of Object.entries(boxes))if(p.x!==AUTHORING.maps[map]?.[id]?.x||p.y!==AUTHORING.maps[map]?.[id]?.y)set[id]=p;
    if(Object.keys(set).length)authorQueueFiles(map,set,boxes);
  }
}
async function authorConnectFiles() {
  if(FILE_AUTHOR.writing||AUTHOR.server)return;
  if(FILE_AUTHOR.directory){if(await FILE_AUTHOR.directory.requestPermission({mode:'readwrite'})==='granted')return authorFlushFiles();
    authorSay('Folder write permission was not granted · changes remain here',true);return;}
  if(!('showDirectoryPicker' in window)){authorSay('Live file saving is unavailable in this browser · Export layout keeps a file',true);return;}
  try{
    let directory=FILE_AUTHOR.resume;
    if(directory){if(await directory.requestPermission({mode:'readwrite'})!=='granted')throw Error('Folder write permission was not granted');}
    else directory=await window.showDirectoryPicker({id:'dev-map-save',mode:'readwrite'});
    const docs=await authorFileDocuments(directory),maps=documentPositions({architecture:docs.a,layout:docs.own});
    const pending=FILE_AUTHOR.pending;
    AUTHOR.maps=maps;
    for(const edit of pending){const m=AUTHOR.maps[edit.map]??={};for(const [id,p] of Object.entries(edit.initial))if(m[id]===undefined)m[id]=p;
      for(const [id,p] of Object.entries(edit.set))p?m[id]=p:delete m[id];}
    FILE_AUTHOR.directory=directory;FILE_AUTHOR.resume=null;authorFolderButton();authorShow();minimap();
    try{localStorage.setItem(AUTHOR_STORE,JSON.stringify(AUTHOR.maps));}catch{}
    try{await authorDirectoryRecord(directory);}catch{authorSay('save folder connected · reconnect after reopening');}
    await authorFlushFiles();
  }catch(e){if(e.name!=='AbortError')authorSay('save folder not connected: '+e.message+' · changes remain here · Export layout',true);}
}
async function authorRestoreFiles() {
  authorRecoverFiles();authorFolderButton();
  if(!AUTHORING.folder||!('showDirectoryPicker' in window))return;
  try{const directory=await authorDirectoryRecord();if(!directory)return;
    FILE_AUTHOR.resume=directory;
    if(await directory.queryPermission({mode:'readwrite'})==='granted') {
      // Restoring a granted handle performs no permission prompt or folder picker.
      const docs=await authorFileDocuments(directory),maps=documentPositions({architecture:docs.a,layout:docs.own});
      for(const edit of FILE_AUTHOR.pending){const m=maps[edit.map]??={};for(const [id,p] of Object.entries(edit.initial))if(m[id]===undefined)m[id]=p;
        for(const [id,p] of Object.entries(edit.set))p?m[id]=p:delete m[id];}
      AUTHOR.maps=maps;FILE_AUTHOR.directory=directory;FILE_AUTHOR.resume=null;authorShow();minimap();authorFolderButton();await authorFlushFiles();
    }else authorSay('browser positions restored · Connect save folder to resume disk saving');
  }catch(e){authorSay('browser positions restored · Connect save folder to save to disk');}
}
addEventListener('beforeunload',e=>{if(FILE_AUTHOR.directory&&FILE_AUTHOR.pending.length){e.preventDefault();e.returnValue='';}});
