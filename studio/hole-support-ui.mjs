export function createHoleSupportUI({getState,token,onChanged,onError}){
  const url=new URL(location.href),requested=url.searchParams.get('hole-support')==='1';
  if(!requested)return {present(){}};
  url.searchParams.delete('hole-support');history.replaceState(null,'',url);
  let shown=false;
  return {async present(){
    const state=getState();if(shown||!state)return;shown=true;
    const dialog=document.createElement('dialog');dialog.id='hole-support-choice';dialog.setAttribute('aria-label','Support a downward-facing hole');
    const head=document.createElement('div');head.className='picker-head';
    const title=document.createElement('h2');title.textContent='Hole support';
    const close=document.createElement('button');close.textContent='Close';close.onclick=()=>dialog.close();head.append(title,close);dialog.append(head);
    const status=document.createElement('p');status.setAttribute('role','status');status.textContent='Finding bed-facing counterbores...';dialog.append(status);
    document.body.append(dialog);dialog.showModal();dialog.addEventListener('close',()=>dialog.remove(),{once:true});
    try{
      const response=await fetch('/api/hole-support'),data=await response.json();if(!response.ok)throw Error(data.error);
      if(!dialog.isConnected)return;
      if(getState().printId!==state.printId||getState().revision!==data.revision)throw Error('The print changed. Ask for hole support again.');
      if(!data.features.length){status.textContent='No supported bed-facing counterbores found.';return;}
      status.textContent='';
      const label=document.createElement('label');label.textContent='Hole';
      const select=document.createElement('select');select.setAttribute('aria-label','Counterbore to treat');
      data.features.forEach((f,i)=>{const option=document.createElement('option');option.value=i;option.textContent=`${f.part?f.part+' / ':''}${f.id}: ${(f.counterboreRadiusMm*2).toFixed(1)} to ${(f.boreRadiusMm*2).toFixed(1)} mm`;select.append(option);});label.append(select);dialog.append(label);
      const overlapLabel=document.createElement('label');overlapLabel.textContent='Bore support contact';
      const overlap=document.createElement('select');overlap.setAttribute('aria-label','Bore support bead overlap');for(const n of [50,75]){const option=document.createElement('option');option.value=n/100;option.textContent=n+'%';overlap.append(option);}overlapLabel.append(overlap);dialog.append(overlapLabel);
      const choices=document.createElement('div');choices.className='hole-support-options';dialog.append(choices);
      const actionButtons=[];
      for(const strategy of data.strategies){
        const button=document.createElement('button');button.className='hole-support-option';
        const icon=document.createElement('img');icon.src=strategy.icon;icon.alt='';icon.width=96;icon.height=72;
        const name=document.createElement('strong');name.textContent=strategy.name;
        const finish=document.createElement('span');finish.textContent=strategy.finish;button.append(icon,name,finish);choices.append(button);actionButtons.push(button);
        button.onclick=async()=>{
          actionButtons.forEach(b=>b.disabled=true);select.disabled=true;overlap.disabled=true;close.disabled=true;
          status.textContent='Preparing '+strategy.name.toLowerCase()+'...';
          const {part,applied,...feature}=data.features[Number(select.value)];
          try{
            const result=await fetch('/api/hole-support',{method:'POST',headers:{'Content-Type':'application/json','X-SAAM-Token':token},body:JSON.stringify({printId:state.printId,revision:data.revision,request:{...(part?{part}:{}),feature:{...feature,strategy:strategy.id,overlap:Number(overlap.value)}}})});
            const body=await result.json();if(!result.ok)throw Error(body.error);dialog.close();onChanged();
          }catch(error){status.textContent=error.message;actionButtons.forEach(b=>b.disabled=false);select.disabled=false;overlap.disabled=false;}
          finally{close.disabled=false;}
        };
      }
    }catch(error){status.textContent=error.message;onError?.(error);}
  }};
}
