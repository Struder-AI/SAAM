// The same finite selectors and canonical queries serve normal and retained review.
export function createPaathQueries({parent,request,current=()=>true,onSample=()=>{},onError=()=>{}}){
  const element=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
  const panel=element('section'),operation=element('select'),course=element('select'),u=element('input'),side=element('select'),result=element('pre'),summary=element('p');
  panel.className='paath-queries';parent.append(panel);let disposed=false,controlsEpoch=0,operationRows=[],courseRows=[],operationNext=null,courseNext=null;
  const live=()=>!disposed&&current(),fail=error=>{if(live())onError(error);};
  const button=(label,action)=>{const b=element('button',label);b.type='button';b.onclick=()=>Promise.resolve(action()).catch(fail);panel.append(b);return b;};
  const labeled=(label,control)=>{const l=element('label',label+' ');l.append(control);return l;};
  const courseLabel=labeled('Course',course);
  u.type='number';u.step='any';u.value='0';side.append(element('option','right'),element('option','left'));
  const fill=(control,rows)=>{control.replaceChildren();for(const row of rows){const option=element('option',row.id);option.value=row.id;control.append(option);}control.disabled=!rows.length;};
  const currentControls=serial=>live()&&serial===controlsEpoch;
  const enableQueries=enabled=>{u.disabled=side.disabled=readSample.disabled=readEntity.disabled=!enabled;};
  async function showCourses(after=null){
    const serial=++controlsEpoch,op=operationRows.find(row=>row.id===operation.value);enableQueries(false);course.disabled=true;
    const page=op?.kind==='deposit'?(await request('source-courses',{options:{operationId:op.id,after}})).page:{items:[],next:null};
    if(!currentControls(serial))return;
    courseRows=page.items;courseNext=page.next;fill(course,courseRows);course.hidden=courseLabel.hidden=op?.kind!=='deposit';
    firstCourses.disabled=course.hidden||after===null;nextCourses.disabled=!courseNext;
    u.value=String(courseRows[0]?.from??0);enableQueries(Boolean(op)&&(op.kind==='inject'||courseRows.length>0));
  }
  async function showOperations(page){
    operationRows=page.items;operationNext=page.next;fill(operation,operationRows);nextOperations.disabled=!operationNext;
    await showCourses();if(live()&&!operationRows.length)summary.textContent='The selected source contains no operations.';
  }
  async function operationPage(after=null){
    const serial=++controlsEpoch;enableQueries(false);
    const {page}=await request('source-operations',{options:{after}});if(!currentControls(serial))return;
    await showOperations(page);
  }
  panel.append(labeled('Operation',operation));
  button('First operations',()=>operationPage());const nextOperations=button('Next operations',()=>operationNext?operationPage(operationNext):undefined);
  panel.append(courseLabel);
  const firstCourses=button('First courses',()=>showCourses()),nextCourses=button('Next courses',()=>courseNext?showCourses(courseNext):undefined);
  panel.append(labeled('Source parameter u',u),labeled('Limit side',side));
  operation.onchange=()=>showCourses().catch(fail);course.onchange=()=>{u.value=String(courseRows.find(row=>row.id===course.value).from);};
  const selectionAt=()=>({operationId:operation.value,...(!course.hidden?{courseId:course.value}:{}),u:Number(u.value),side:side.value});
  const readSample=button('Read source parameter',async()=>{
    const selection=selectionAt(),{sample}=await request('source-sample',{selection});if(!live())return;
    result.textContent=JSON.stringify(sample,null,2);
    const s=sample.sample,n=value=>Number(value).toPrecision(6),parts=[`u=${sample.u} (${sample.side})`,`Point [${s.point.map(n).join(', ')}] mm`];
    for(const [key,label,unit] of [['rateMm3PerMm','Material rate','mm³/mm'],['aspectRatio','Aspect ratio',''],['widthMm','Width','mm'],['heightMm','Height','mm'],['speedMmS','Requested speed','mm/s'],['volumeMm3','Stationary dose','mm³'],['flowMm3S','Flow','mm³/s'],['holdSeconds','Hold','s'],['requestedSeconds','Local requested time','s']])if(Number.isFinite(s[key]))parts.push(`${label}: ${n(s[key])} ${unit}`.trim());
    for(const [key,label]of [['toolAxis','Tool axis'],['materialNormal','Material normal']])if(s[key])parts.push(`${label} [${s[key].map(n).join(', ')}]`);
    summary.textContent=parts.join(' · ');onSample({selection,sample});
  });
  const readEntity=button('Read complete entity',async()=>{
    const value=await request('source-entity',{selection:selectionAt()});if(!live())return;
    result.textContent=JSON.stringify(value.entity,null,2);summary.textContent='Complete selected source entity and numerical definitions.';
  });
  const raw=element('details');raw.append(element('summary','Complete local query reply'),result);panel.append(summary,raw);enableQueries(false);
  return {async load(page){if(page)await showOperations(page);else await operationPage();},dispose(){disposed=true;controlsEpoch++;panel.remove();}};
}
