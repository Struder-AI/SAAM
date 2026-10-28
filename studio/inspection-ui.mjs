import {decodeNumericalView,numericalJsonText,numericalEncoding} from '../core/contracts/numerical-json.mjs';

const boundsOf=points=>{
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const p of points)for(let k=0;k<3;k++){min[k]=Math.min(min[k],p[k]);max[k]=Math.max(max[k],p[k]);}
  return min.every(Number.isFinite)?{min,max}:{min:[0,0,0],max:[1,1,1]};
};
export const inspectionTypeTitle=identity=>identity.typeId==='work'?'Paath /3':identity.typeId==='schedule'?'Paath schedule':identity.typeId==='schedule-request'?'Scheduling inputs':identity.typeId==='geometry-answer'?'Geometry':identity.typeId==='allocated-chart-region'?'Allocated chart region':identity.typeId==='chart-allocation-request'?'Chart allocation inputs':identity.typeId==='layer-regions'?'Prepared Slice regions':identity.typeId==='slice-layout'?'Slice mapping inputs':identity.typeId==='mapped-curves'?'Mapped Slice curves':identity.typeId==='deposition-intent'?'Prepared deposition strokes':identity.typeId==='flow-value'?(identity.implementationSchema==='saam-slice-numerical-context/1'?'Shared numerical context':'Flow observation'):identity.typeId??'Unavailable value';
const typeTitle=inspectionTypeTitle;
export function createInspectionUI({viewer,token,typedViews={},onClose}){
  const panel=document.createElement('section');panel.className='retained-inspection';panel.hidden=true;
  document.querySelector('aside').prepend(panel);
  let chosen=null,view=null,model=null,epoch=0;
  const element=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
  const request=(route,data)=>fetch('/api/'+route,{method:'POST',headers:{'Content-Type':'application/json','X-SAAM-Token':token},body:JSON.stringify(data)}).then(async r=>{const v=await r.json();if(!r.ok)throw Error(v.error);return v;});
  const href=(representation,observationId=chosen.observationId)=>'/api/inspection?'+new URLSearchParams({selectionId:chosen.selectionId,representation,observationId,...(representation==='view'?{}:{download:'1'})});
  const button=(label,action)=>{const b=element('button',label),ticket=epoch;b.type='button';b.onclick=()=>Promise.resolve(action()).catch(e=>{if(ticket===epoch)status.textContent=e.message;});panel.append(b);return b;};
  const status=element('p');
  function showCoverage(coverage){
    status.textContent=typeof coverage==='string'?coverage:coverage?.sourceCounts
      ?`${coverage.complete?'Complete source coverage':'Partial source page'} · ${coverage.displayedSegments} segments, ${coverage.displayedStationary} stationary points · ${coverage.positionToleranceMm} mm display tolerance · all-source bounds · no playback order`
      :`${coverage?.complete?'Complete graphic coverage':'Partial or unavailable graphic'} · ${coverage?.meaning??''}`;
  }
  async function select(selection){
    if(chosen?.selectionId===selection.selectionId)return model;
    const ticket=++epoch;chosen=selection;view=null;
    model={kind:selection.kind,geometry:null,program:null,bounds:{min:[0,0,0],max:[1,1,1]}};
    panel.hidden=false;panel.replaceChildren();viewer.clearProgram();viewer.publishGeometry({geometry:null});
    const identities=element('details');identities.append(element('summary','Exact retained identities'),element('pre',JSON.stringify(selection,null,2)));
    panel.append(element('strong','Retained value · '+typeTitle(selection)),element('p','Input revision: '+(selection.inputRevision??'unknown')+' · '+selection.phase),identities);
    if(selection.valueEncoding===numericalEncoding)panel.append(element('p','Exact finite-number JSON retains signed zero. Raw downloads preserve original bytes; these graphics are derived from the identified retained inputs.'));
    button('Return to normal review',async()=>{await request('inspection-close',{selectionId:selection.selectionId});await onClose();});
    for(const identity of new Map([selection,...selection.related].map(row=>[row.observationId,row])).values())for(const representation of identity.observationId===selection.observationId?selection.representations??['complete']:['complete']){
      const a=element('a',`${typeTitle(identity)} · ${representation}`);a.href=href(representation,identity.observationId);a.download='';panel.append(a);
    }
    panel.append(status);status.textContent='Loading exact retained value…';
    let failure=null;
    try{
      if(typedViews[selection.kind]){
        const rendered=await typedViews[selection.kind]({url:href('view'),downloadURL:href('complete'),selection});
        if(ticket!==epoch)return null;
        model={...model,...rendered};status.textContent='Showing the selected retained value in the shared '+typeTitle(selection)+' view.';
        return model;
      }
      const response=await fetch(href('view'));const reply=await response.json();if(!response.ok)throw Error(reply.error);view=await decodeNumericalView(reply,selection);
      if(ticket!==epoch)return null;
      showCoverage(view.coverage??view.reason??selection.reason);
      if(view.relatedFinding)panel.append(element('p','Related view unavailable: '+view.relatedFinding));
      if(view.kind==='geometry'){
        model.geometry=view.geometry;model.bounds=view.geometry.boundsMm??boundsOf(view.geometry.vertices??[]);viewer.publishGeometry({geometry:view.geometry});
      }else if(view.kind==='region'){
        model.bounds=boundsOf(view.segments.flat());viewer.publishLines(view.segments);
      }else if(view.kind==='slice-receiver'){
        model.bounds=view.bounds;viewer.publishLines(view.segments);
        const occurrence=view.identity;panel.append(element('p',`Native member ${occurrence.memberIndex} · character ${occurrence.characterIndex} · ${occurrence.group??'layer'} · ${occurrence.consumerPurpose}`));
        panel.append(element('p',view.groups.map(group=>`${group.role}: ${group.curves} curves`).join(' · ')));
        panel.append(element('p',`${view.coverage.shownEdges}/${view.coverage.totalEdges} received edges · ${view.coverage.shownFrames} geometric frames · ${view.coverage.shownSections} derived section ticks`));
        if(view.locals.length){
          const number=value=>Object.is(value,-0)?'-0':Number(value).toPrecision(5),sample=view.locals[0],parts=[];
          for(const [key,label,unit] of [['widthMm','width','mm'],['heightMm','depth','mm'],['speedMmS','requested speed','mm/s'],['derivedRateMm3PerMm','derived rate','mm³/mm'],['derivedAspectRatio','derived aspect','']])if(sample[key]!==undefined)parts.push(`${label} ${number(sample[key])} ${unit}`.trim());
          panel.append(element('p','First displayed segment · '+parts.join(' · ')));
        }
        const details=element('details'),raw=element('pre',numericalJsonText({locals:view.locals,frames:view.frames,mappingEvidence:view.mappingEvidence},2));details.append(element('summary','Displayed numerical samples and approximation evidence (signed zero preserved)'),raw);panel.append(details);
      }else failure=view.reason??'This retained value has no graphic; complete data remains available.';
    }catch(error){if(ticket!==epoch)return null;failure=error.message;status.textContent=failure;}
    if(ticket!==epoch)return null;
    model.failure=failure;
    return model;
  }
  return {select,model:()=>model,async ready(selection){await request('inspection-ready',{selectionId:selection.selectionId,valueId:selection.valueId,...(model?.failure?{renderError:model.failure}:{})});},
    clear(){epoch++;chosen=null;view=null;model=null;panel.hidden=true;},dispose(){this.clear();panel.remove();}};
}
