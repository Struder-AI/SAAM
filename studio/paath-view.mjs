import {createPaathQueries} from './paath-queries.mjs';

// One Paath view owns presentation and source controls, regardless of where the
// selected value came from. Its session owns the source and optional playback.
export function createPaathView({parent,viewer,onChange=()=>{},onError=()=>{}}){
  const element=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
  const panel=element('details'),title=element('summary','Paath source'),download=element('a','Complete Paath data (JSON)'),status=element('p');
  panel.className='paath-source';panel.hidden=true;download.download='paath.json';panel.append(title,download);parent.append(panel);
  let session=null,options=null,controls=null,controller=null,epoch=0,frame=null,bounds=null,sourceSelection=null,sourceSample=null,mode='playback';
  const fail=error=>{if(error.name!=='AbortError')onError(error);};
  const button=(label,action)=>{const b=element('button',label);b.type='button';b.onclick=()=>Promise.resolve(action()).catch(fail);panel.append(b);return b;};
  const source=button('Source view',()=>showSource()),next=button('Next source page',()=>frame?.coverage.next?showSource(frame.coverage.next):undefined),playback=button('Playback',async()=>{
    const ticket=epoch;mode='playback';await paint({buildPath:true,buildMaterial:true});if(ticket===epoch)onChange();
  });panel.append(status);
  const request=(type,data)=>session.querySource(type,data,{signal:controller.signal});
  function update(){
    const coverage=frame?.coverage;
    status.textContent=mode==='source'&&coverage
      ?`${coverage.complete?'Complete source coverage':'Partial source page'} · ${coverage.displayedSegments} segments, ${coverage.displayedStationary} stationary points · ${coverage.positionToleranceMm} mm display tolerance · all-source bounds · no playback order`
      :options?.program?'Playback uses the selected Paath’s schedule.':'';
    if(session?.relatedFinding)status.textContent+=' · '+session.relatedFinding;
    source.disabled=mode==='source';next.disabled=mode!=='source'||!coverage?.next;playback.disabled=mode==='playback'||!options?.program;
  }
  async function paint(overrides={}){
    update();
    if(mode==='source'){viewer.publishSource({frame});return null;}
    const selected=options,ticket=epoch,{program,...presentation}=selected;
    const result=program?await viewer.publishProgram({...presentation,...overrides,moves:program.moves,previewMaterial:program.previewMaterial}):null;
    if(result?.previewMaterialConsumed&&ticket===epoch&&options===selected){const {previewMaterial,...retained}=program;options={...options,program:retained};}
    return result;
  }
  async function showSource(cursor=null){
    const ticket=epoch,{frame:page}=await request('source-frame',{options:{cursor}});if(ticket!==epoch)return;
    frame=page;mode='source';await paint();if(ticket===epoch)onChange();
  }
  async function loadQueries(){
    if(!session?.sourceIdentity||controls||!panel.open)return;
    const ticket=epoch;
    controls=createPaathQueries({parent:panel,request,current:()=>ticket===epoch,
      onSample:value=>{sourceSelection=value.selection;sourceSample=value.sample;onChange();},onError:fail});
    try{await controls.load();}catch(error){if(ticket===epoch)fail(error);}
  }
  panel.ontoggle=()=>void loadQueries();
  function clear(){
    epoch++;controller?.abort();controller=null;controls?.dispose();controls=null;session=null;options=null;frame=null;bounds=null;sourceSelection=null;sourceSample=null;mode='playback';
    panel.hidden=true;download.removeAttribute('href');
  }
  return {
    async present(selected,presentation){
      if(session!==selected){clear();session=selected;controller=new AbortController();frame=session?.sourceFrame??null;mode=presentation.program?'playback':'source';}
      options=presentation;
      if(!bounds&&presentation.program){
        const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
        for(const move of presentation.program.moves)for(const point of [move.from,move.to])for(let i=0;i<3;i++){min[i]=Math.min(min[i],point[i]);max[i]=Math.max(max[i],point[i]);}
        bounds=min.every(Number.isFinite)?{min,max}:{min:[0,0,0],max:[1,1,1]};
      }
      if(session?.sourceIdentity){
        const identity=session.sourceIdentity;title.textContent='Paath source · '+(identity.sourcePathId??identity.artifactId??identity.valueId??identity.outputId??'selected value');
        download.href=presentation.downloadURL??'/api/path?'+new URLSearchParams({printId:identity.printId,revision:identity.revision,id:identity.outputId});
        panel.hidden=false;void loadQueries();
      }
      return paint();
    },
    setVisible(visible){panel.hidden=!visible||!session?.sourceIdentity;},
    model:()=>({frame:mode==='source'?frame:null,bounds:mode==='source'?frame?.bounds:bounds,sourceSelection,sourceSample,mode}),
    clear,dispose(){clear();panel.remove();}
  };
}
