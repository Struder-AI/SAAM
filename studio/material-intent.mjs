// Display-only review of how the locked recipe occupies the supplied target.
// This never replaces native geometry and never derives or approves a toolpath.
const LABELS={solid:'Solid material',sparse:'Sparse interior','perimeter-only':'Perimeter-only / hollow',empty:'No deposited material','surface-only':'Surface-only material'};

function heightOf(geometry){
  if(['box','pipe','spline-tube'].includes(geometry.shape))return geometry.heightMm;
  if(geometry.shape==='wedge')return geometry.baseMm+geometry.runMm*Math.tan(geometry.angleDeg*Math.PI/180);
  if(geometry.shape==='mesh'){
    const z=geometry.vertices.map(point=>point[2]);return Math.max(...z)-Math.min(...z);
  }
  if(Array.isArray(geometry.heightsMm))return Math.max(...geometry.heightsMm.flat())-Math.min(0,...geometry.heightsMm.flat());
  if(geometry.shape==='assembly')return Math.max(...geometry.parts.map(part=>part.zMm+heightOf(part.geometry)));
  return 0;
}

function explicitVoids(geometry,part=null,offset=0){
  if(geometry.shape==='assembly')return geometry.parts.flatMap(child=>explicitVoids(child.geometry,child.id,offset+child.zMm));
  if(geometry.shape==='pipe'||geometry.shape==='spline-tube')return [{
    source:'geometry',kind:'through-hole',part,zStartMm:offset,zEndMm:offset+geometry.heightMm,
    label:'Modeled through-hole',detail:`${2*geometry.innerRadiusMm} mm diameter bore`
  }];
  return [];
}

function classification(skills,defaults){
  if(skills['vase-wall'])return 'perimeter-only';
  if(skills['full-fill']?.mode==='body'&&!skills['planar-infill'])return 'solid';
  if(skills['planar-infill']){
    const infill={...defaults['planar-infill'],...skills['planar-infill']};
    if(infill.density>=1)return 'solid';
    if(infill.density>0)return 'sparse';
    return infill.perimeters>0?'perimeter-only':'empty';
  }
  if(skills['draped-skin']||skills['rimming-planar']||skills['rimming-normal']||skills['pipe-cladding'])return 'surface-only';
  return skills['full-fill']?'solid':'empty';
}

function splitSolidSurfaces(region,plan){
  const fill={...plan.skills['full-fill'],...region.skills['full-fill']};
  if(fill.mode!=='solid-surfaces'||!region.skills['planar-infill'])return [region];
  const span=region.zEndMm-region.zStartMm;
  const layerThickness=count=>count?plan.process.firstLayerMm+Math.max(0,count-1)*plan.process.layerMm:0;
  const bottom=Math.min(span,layerThickness(fill.bottomLayers)),top=Math.min(span-bottom,fill.topLayers*plan.process.layerMm);
  const middleStart=region.zStartMm+bottom,middleEnd=region.zEndMm-top,result=[];
  if(bottom>1e-9)result.push({...region,id:region.id+':solid-bottom',zEndMm:middleStart,classification:'solid',label:'Solid base'});
  if(middleEnd-middleStart>1e-9)result.push({...region,id:region.id+':body',zStartMm:middleStart,zEndMm:middleEnd});
  if(top>1e-9)result.push({...region,id:region.id+':solid-top',zStartMm:middleEnd,classification:'solid',label:'Solid top'});
  return result;
}

export function materialIntentModel(plan,displayGeometry=null){
  const totalHeight=displayGeometry?.boundsMm?displayGeometry.boundsMm.max[2]-displayGeometry.boundsMm.min[2]:heightOf(plan.geometry);
  const partHeights=new Map(plan.geometry.shape==='assembly'?plan.geometry.parts.map(part=>[part.id,heightOf(part.geometry)]):[]);
  const source=plan.composition?.regions?.length?plan.composition.regions:[{
    id:'whole target',part:null,zStartMm:0,zEndMm:totalHeight,
    skills:plan.skills?Object.fromEntries(Object.entries(plan.skills).filter(([,settings])=>settings.enabled)):{}
  }];
  const regions=source.flatMap(item=>{
    const zEndMm=item.zEndMm??partHeights.get(item.part)??totalHeight,skills=Object.fromEntries(Object.entries(item.skills).map(([name,settings])=>[name,{...plan.skills?.[name],...settings}]));
    const region={source:'process',id:item.id,part:item.part??null,zStartMm:item.zStartMm,zEndMm,skills,
      classification:classification(skills,plan.skills??{})};
    return splitSolidSurfaces(region,plan);
  }).map(region=>({...region,label:region.label??LABELS[region.classification]}));
  if(!plan.skills)regions.splice(0,regions.length,{source:'process',id:'whole target',part:null,zStartMm:0,zEndMm:totalHeight,classification:'solid',label:LABELS.solid});
  return {
    schema:'saam-material-intent-review/1',
    target:{source:'geometry',label:'Supplied target envelope',detail:'The closed modeled shape; not a promise that its entire volume will be deposited.'},
    explicitVoids:explicitVoids(plan.geometry),regions,
    note:'Geometry approval confirms the modeled target and explicit cavities only. Hollow, sparse and solid assignments remain process choices confirmed in Settings; toolpath approval remains separate.'
  };
}

const mm=value=>`${Math.round(value*100)/100} mm`;
export function renderMaterialIntent(container,model,documentApi=document){
  container.replaceChildren();
  const heading=documentApi.createElement('div');heading.className='intent-heading';
  const title=documentApi.createElement('strong');title.textContent='Material intent preview';
  const qualifier=documentApi.createElement('span');qualifier.textContent='Not a toolpath';heading.append(title,qualifier);container.append(heading);
  const target=documentApi.createElement('p');target.className='intent-target';target.textContent=`Target: ${model.target.detail}`;container.append(target);
  for(const cavity of model.explicitVoids){
    const row=documentApi.createElement('div');row.className='intent-explicit';
    row.textContent=`Explicit geometry · ${cavity.label} · ${cavity.detail}`;container.append(row);
  }
  const groups=new Map();
  for(const region of model.regions){const key=region.part??'Whole part';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(region);}
  for(const [part,regions] of groups){
    const group=documentApi.createElement('div');group.className='intent-group';
    const name=documentApi.createElement('span');name.className='intent-part';name.textContent=part;
    const stack=documentApi.createElement('div');stack.className='intent-stack';
    for(const region of [...regions].sort((a,b)=>b.zStartMm-a.zStartMm)){
      const band=documentApi.createElement('div');band.className=`intent-band intent-${region.classification}`;
      band.style.flexGrow=Math.max(.15,region.zEndMm-region.zStartMm);
      band.textContent=`${region.label} · Z ${mm(region.zStartMm)}–${mm(region.zEndMm)}`;
      band.title=`Process region ${region.id}`;stack.append(band);
    }
    group.append(name,stack);container.append(group);
  }
  const note=documentApi.createElement('p');note.className='intent-note';note.textContent=model.note;container.append(note);
}
