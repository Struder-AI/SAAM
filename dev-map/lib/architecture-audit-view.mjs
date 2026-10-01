// Standalone, local review surface; data and source are the same scan snapshot.
export function renderAudit(report) {
  const data=JSON.stringify(report).replaceAll('<','\\u003c');
  return `<!doctype html><meta charset="utf-8"><title>0.3.1 boundary audit</title>
<style>body{font:14px system-ui;margin:24px;color:#203047;background:#f4f6fa}h1{font-size:24px}a{color:#155cb5}button,select,input{font:inherit;padding:8px;margin:3px;border:1px solid #acb7c7;border-radius:5px;background:white}button{cursor:pointer}#summary{padding:14px;background:white;border-left:5px solid #d47922}#status{color:#935000}table{border-collapse:collapse;width:100%;background:white;margin-top:16px}th,td{text-align:left;padding:9px;border-bottom:1px solid #dbe0e8;vertical-align:top}th{position:sticky;top:0;background:#e5ebf3}td{overflow-wrap:anywhere;max-width:420px}.forbidden{color:#b32121}.unknown,.direction-review{color:#925000}.represented{color:#526477}.entry-bound{color:#24559a}small{color:#5c6a7e}dialog{width:85vw;max-height:85vh;border:1px solid #8c9cb0;border-radius:8px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px monospace}#counts button{font-size:12px}.hint{max-width:1100px;line-height:1.5}</style>
<h1>0.3.1 · Code against map 0</h1>
<p><a href="index.html#0">Architecture maps</a> · Snapshot <span id="when"></span> · <b id="status">Checking snapshot freshness…</b></p>
<div id="summary"></div>
<p class="hint">Red means map 0 has no connection between these buckets. Direction-review means a connection exists but its call/data direction needs inspection. Represented confirms only the connection; entry-bound also confirms a named target/kind. Neither certifies allowed effects or functional correctness. Unknown stays unresolved. Submaps are ignored; assignments are provisional and files have not moved.</p>
<label>View <select id="view"><option value="crossings">Crossings</option><option value="evidence">Ownership and resources</option><option value="leaves">Assigned code</option><option value="buckets">Bucket inventory</option><option value="scope">Scope ledger</option><option value="orphans">Orphan assignments</option></select></label>
<label id="bucket-control">Bucket <select id="bucket"><option value="">All</option></select></label>
<label id="status-control">Status <select id="filter"><option value="">All crossings</option><option selected>forbidden</option><option>direction-review</option><option>represented</option><option>unknown</option><option>unassigned</option><option>entry-bound</option><option>outside-product</option></select></label>
<input id="query" placeholder="Find function, file, interface…" size="36"><button id="reset">Reset</button>
<div id="counts"></div><p id="count"></p><div id="results"></div><button id="more">Show next 100</button>
<details><summary>Analysis limits</summary><ul id="limits"></ul></details>
<dialog id="detail"><button id="close">Close</button><div id="body"></div></dialog>
<script>const DATA=${data};
const $=id=>document.getElementById(id),esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const buckets=new Map(DATA.buckets.map(b=>[b.id,b])),leaves=new Map(DATA.leaves.map(n=>[n.path,n]));
const ownership=DATA.pipelineOwnership??[],resources=DATA.resourceProvenance??{observations:[],matches:[],limits:[]};
const evidence=[...ownership.map(proof=>({type:'ownership',proof})),...resources.matches.map(match=>({type:'resource-match',match})),...resources.observations.filter(o=>o.uncertainty).map(observation=>({type:'resource-unknown',observation}))];
const place=s=>s?.file&&s?.line?esc(s.file+':'+s.line+(s.column?':'+s.column:'')):'unknown site';
const sameSite=(a,b)=>a?.file===b?.file&&a?.line===b?.line&&a?.file!=null&&a?.line!=null;
function related(r){
 const proof=ownership.filter(p=>sameSite(p.call,r.site)||p.handoffs.some(h=>h.mutations.some(s=>sameSite(s,r.site))));
 const observed=resources.observations.filter(o=>sameSite(o.site,r.site)||sameSite(o.operationSite,r.site));
 const matches=resources.matches.filter(m=>[m.first,m.second,...m.provenance??[]].some(s=>sameSite(s,r.site)));
 return {proof,observed,matches};
}
const sourceAt=(site,heading)=>{const text=DATA.sources[site?.file];if(!text)return '<p>Source is not in the analyzed snapshot: '+place(site)+'</p>';
 const line=site.line,start=Math.max(0,line-4);return '<h4>'+esc(heading)+' · '+place(site)+'</h4><pre>'+esc(text.split('\\n').slice(start,line+3).map((s,i)=>(start+i+1)+' '+s).join('\\n'))+'</pre>';};
function ownershipDetail(p){return '<h3>Sequential ownership handoff</h3><p>'+esc(p.caller)+' → '+esc(p.callee)+' at '+place(p.call)+'</p>'+
 p.handoffs.map(h=>'<p><b>'+esc(h.argument)+' → '+esc(h.parameter)+'</b> · '+esc(h.allocationKind)+' allocated at '+place(h.allocation)+
 (h.elementAllocation?' · '+esc(h.elementKind)+' elements at '+place(h.elementAllocation):'')+' · mutations: '+h.mutations.map(place).join(', ')+
 ' · local aliases: '+esc(h.aliases.join(', '))+'</p>'+sourceAt(h.allocation,'Allocation')+
 (h.elementAllocation?sourceAt(h.elementAllocation,'Element allocation'):'')+h.mutations.map(s=>sourceAt(s,'Mutation')).join('')).join('')+
 sourceAt(p.call,'Handoff')+'<p><small>'+p.limits.map(esc).join(' · ')+'</small></p>';}
function identityText(symbol){try{
 const describe=v=>v.kind==='literal'?JSON.stringify(v.value):v.kind==='parameter'?'parameter '+v.name+' of '+v.owner:
   v.kind==='path'?v.operation+'('+v.parts.map(describe).join(', ')+')':v.kind==='concat'?v.parts.map(describe).join(' + '):
   v.kind==='unique'?'fresh token at '+v.site?.file+':'+v.site?.line:v.kind==='opaque-local'?'local value at '+v.site?.file+':'+v.site?.line:JSON.stringify(v);
 return describe(JSON.parse(symbol));
 }catch{return symbol;}}
function resourceDetail(m){const entries=resources.observations.filter(o=>o.symbol===m.symbol&&
 ([m.first,m.second].some(s=>sameSite(s,o.site))||m.provenance.some(s=>sameSite(s,o.operationSite))));
 return '<h3>Same symbolic resource</h3><p>'+esc(m.firstRole)+' at '+place(m.first)+' ↔ '+esc(m.secondRole)+' at '+place(m.second)+'</p>'+
 '<p>Identity: <code>'+esc(identityText(m.symbol))+'</code></p>'+
 '<p><small>Equal symbolic construction only; other paths may alias. A publication identifies the rename destination.</small></p>'+
 entries.map(o=>'<p><b>'+esc(o.role)+'</b> · '+esc(o.operation)+' · caller '+place(o.site)+' · operation '+place(o.operationSite??o.site)+
 (o.via?' · via '+esc(o.via):'')+'</p>').join('')+
 [...new Map([m.first,m.second,...m.provenance].map(s=>[s.file+':'+s.line,s])).values()].map(s=>sourceAt(s,'Resource operation')).join('');}
function observationDetail(o){return '<h3>Unresolved resource identity</h3><p>'+esc(o.operation)+' · '+esc(o.role)+' · caller '+place(o.site)+
 ' · operation '+place(o.operationSite??o.site)+'</p><p>'+esc(o.uncertainty)+'</p>'+
 sourceAt(o.site,'Caller')+(sameSite(o.site,o.operationSite)?'':sourceAt(o.operationSite,'Operation'));}
const label=id=>{const b=buckets.get(id);return b?b.index+' '+b.label:id??'unassigned';};
const inside=(id,selected)=>!selected||id===selected||(buckets.get(id)?.index??'!').startsWith((buckets.get(selected)?.index??'?')+'.');
let limit=100,shown=[];
$('when').textContent=DATA.generated;$('summary').textContent=Object.entries(DATA.totals).map(([k,v])=>k+': '+v).join(' · ');
$('limits').innerHTML=DATA.limits.map(x=>'<li>'+esc(x)+'</li>').join('');
$('bucket').innerHTML+=DATA.buckets.map(b=>'<option value="'+esc(b.id)+'">'+esc(label(b.id))+'</option>').join('');
function draw(){
 const view=$('view').value,bucket=$('bucket').value,status=$('filter').value,q=$('query').value.toLowerCase();
 $('status-control').hidden=view!=='crossings';$('bucket-control').hidden=!['crossings','leaves'].includes(view);
 let all=view==='crossings'?DATA.rows:view==='evidence'?evidence:view==='leaves'?DATA.leaves:view==='buckets'?DATA.bucketTotals:view==='scope'?DATA.files:DATA.orphan.map(path=>({path}));
 all=all.filter(r=>(view==='crossings'?(!status||r.status===status)&&(!bucket||inside(r.fromOwner,bucket)||inside(r.toOwner,bucket)):view==='leaves'?inside(r.owner,bucket):true)&&(!q||JSON.stringify(r).toLowerCase().includes(q)));
 shown=all.slice(0,limit);$('count').textContent=all.length+' matching records; showing '+shown.length;$('more').hidden=all.length<=limit;
 const heads=view==='crossings'?['Status / mechanism','Caller / consumer','Provider / target','Source / interface']:view==='evidence'?['Evidence','Relationship','Source sites','Review']:view==='leaves'?['Owner','Declaration','Assignment rationale']:view==='buckets'?['Bucket','Assigned leaves','Forbidden crossings']:['File / declaration','Scope','Reason'];
 $('results').innerHTML='<table><thead><tr>'+heads.map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody>'+shown.map((r,i)=>{
 const rel=view==='crossings'?related(r):null;
 const cue=rel&&(rel.proof.length||rel.observed.length||rel.matches.length)?'<br><small>Evidence: '+[rel.proof.length?'ownership '+rel.proof.length:'',rel.matches.length?'resource matches '+rel.matches.length:'',rel.observed.length?'resource sites '+rel.observed.length:''].filter(Boolean).join(' · ')+'</small>':'';
 const cells=view==='crossings'?['<b class="'+esc(r.status)+'">'+esc(r.status)+'</b><br>'+esc(r.kind)+cue,esc(label(r.fromOwner))+'<br><small>'+esc(r.from)+'</small>',esc(label(r.toOwner))+'<br><small>'+esc(r.to??r.reason)+'</small>','<button data-row="'+i+'">Inspect</button><br>'+place(r.site)+'<br><small>'+esc((r.contracts??[]).join(', '))+'</small>']:
 view==='evidence'?r.type==='ownership'?['Owned handoff',esc(r.proof.caller)+' → '+esc(r.proof.callee)+'<br><small>'+r.proof.handoffs.map(h=>esc(h.argument+' → '+h.parameter)).join(', ')+'</small>',place(r.proof.call)+'<br><small>'+r.proof.handoffs.flatMap(h=>h.mutations).map(place).join(', ')+'</small>','<button data-row="'+i+'">Inspect</button>']:
 r.type==='resource-match'?['Same symbolic resource',esc(r.match.firstRole)+' ↔ '+esc(r.match.secondRole)+'<br><small>'+esc(identityText(r.match.symbol))+'</small>',place(r.match.first)+'<br>'+place(r.match.second)+'<br><small>Operations: '+r.match.provenance.map(place).join(' · ')+'</small>','<button data-row="'+i+'">Inspect</button>']:
 ['Unresolved resource',esc(r.observation.operation)+' · '+esc(r.observation.uncertainty),place(r.observation.site)+'<br><small>Operation: '+place(r.observation.operationSite??r.observation.site)+'</small>','<button data-row="'+i+'">Inspect</button>']:
 view==='leaves'?[esc(label(r.owner)),'<button data-row="'+i+'">'+esc(r.path)+'</button><br><small>'+r.line+'–'+r.endLine+'</small>',esc(r.reason)]:view==='buckets'?['<a data-bucket="'+esc(r.id)+'" href="#'+esc(r.index)+'">'+esc(label(r.id))+'</a>',r.leaves,r.forbidden]:[esc(r.file??r.path),esc(r.scope??'orphan'),esc(r.reason??'Declaration disappeared or changed identity; review and remove/reassign.')];
 return '<tr>'+cells.map(c=>'<td>'+c+'</td>').join('')+'</tr>';
 }).join('')+'</tbody></table>';
 const groups=new Map();if(view==='crossings')for(const r of all)if(r.status==='forbidden'){const key=label(r.fromOwner)+' → '+label(r.toOwner);groups.set(key,(groups.get(key)??0)+1);}
 $('counts').innerHTML=view==='evidence'?'<p>Ownership handoffs: '+ownership.length+' · same-resource matches: '+resources.matches.length+' · unresolved resource observations: '+resources.observations.filter(o=>o.uncertainty).length+'</p><p><small>'+resources.limits.map(esc).join(' · ')+'</small></p>':[...groups].sort((a,b)=>b[1]-a[1]).slice(0,15).map(([k,v])=>'<button data-group="'+esc(k)+'">'+esc(k)+' ('+v+')</button>').join('');
}
function source(path,site){const n=leaves.get(path),file=n?.file??site?.file,text=DATA.sources[file];if(!text)return '<p>Source is not in the analyzed snapshot.</p>';const start=n?.line??site?.line??1,end=n?.endLine??start+20;return '<h3>'+esc(path??file)+'</h3><pre>'+esc(text.split('\\n').slice(Math.max(0,start-2),Math.min(end+1,start+180)).map((s,i)=>(Math.max(0,start-2)+i+1)+' '+s).join('\\n'))+'</pre>';}
$('results').onclick=e=>{const bucketLink=e.target.closest('[data-bucket]');if(bucketLink){$('view').value='leaves';$('bucket').value=bucketLink.dataset.bucket;limit=100;draw();return;}const button=e.target.closest('[data-row]');if(!button)return;const r=shown[Number(button.dataset.row)];
 if($('view').value==='evidence')$('body').innerHTML=r.type==='ownership'?ownershipDetail(r.proof):r.type==='resource-match'?resourceDetail(r.match):observationDetail(r.observation);
 else {const rel=$('view').value==='crossings'?related(r):null;
 $('body').innerHTML='<pre>'+esc(JSON.stringify(r,null,2))+'</pre>'+source(r.path??r.from,r.site)+(r.to?source(r.to):'')+(r.contracts??[]).map(id=>'<pre>'+esc(JSON.stringify(DATA.contracts.find(c=>c.id===id),null,2))+'</pre>').join('')+
 (rel?rel.proof.map(ownershipDetail).join('')+rel.matches.map(resourceDetail).join('')+rel.observed.filter(o=>o.uncertainty).map(observationDetail).join(''):'');}
 $('detail').showModal();};
$('counts').onclick=e=>{const button=e.target.closest('[data-group]');if(!button)return;const from=button.dataset.group.split(' → ')[0];const b=DATA.buckets.find(b=>label(b.id)===from);if(b)$('bucket').value=b.id;$('filter').value='forbidden';limit=100;draw();};
$('close').onclick=()=>$('detail').close();for(const id of ['view','bucket','filter','query'])$(id).oninput=()=>{limit=100;draw();};
$('more').onclick=()=>{limit+=100;draw();};$('reset').onclick=()=>{for(const id of ['bucket','filter','query'])$(id).value='';limit=100;draw();};
function route(){const index=decodeURIComponent(location.hash.slice(1));$('bucket').value=DATA.buckets.find(b=>b.index===index)?.id??'';limit=100;draw();}onhashchange=route;route();
fetch('audit-status.json',{cache:'no-store'}).then(r=>r.json()).then(s=>{$('status').textContent=s.generated===DATA.generated?s.state+' at last CLI check':'Status belongs to another scan; run audit-check';}).catch(()=>$('status').textContent='Run audit-check to verify freshness');
</script>`;
}
