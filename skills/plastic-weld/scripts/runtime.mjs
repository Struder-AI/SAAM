// Plastic weld authors process cavities and material envelopes as ordinary
// rational geometry, then uses the shared Boolean and Inject operations.
const requireThat=(condition,message)=>{if(!condition)throw Error(message);};
// copies core/dimensions.mjs PRINT_RESOLUTION_MM; no release-relative imports
const PRINT_RESOLUTION_MM=1e-3;
export const PLASTIC_WELD_DEFAULTS={enabled:false,sites:[],shaftDiameterMm:1.2,basinDiameterMm:3,
  basinHeightMm:1.2,wallMm:1.2,floorMm:.8,seatDepthMm:0,volumeFactor:1,flowMm3S:.5,holdSeconds:1,nozzleC:null};
const positive=(value,name)=>requireThat(Number.isFinite(value)&&value>0,'plastic-weld '+name+' must be positive.');

export function validatePlasticWeld(plan){
  const settings=plan.skills['plastic-weld'];
  requireThat(typeof settings.enabled==='boolean'&&Array.isArray(settings.sites),'plastic-weld needs an enabled flag and sites array.');
  for(const key of ['shaftDiameterMm','basinDiameterMm','basinHeightMm','wallMm','floorMm','volumeFactor','flowMm3S'])positive(settings[key],key);
  requireThat(Number.isFinite(settings.holdSeconds)&&settings.holdSeconds>=0,'Rivet hold must be nonnegative.');
  requireThat(Number.isFinite(settings.seatDepthMm)&&settings.seatDepthMm>=0,'Rivet seat depth must be nonnegative.');
  if(settings.nozzleC!==null)requireThat(Number.isFinite(settings.nozzleC)&&settings.nozzleC>=0,'Authored nozzle temperature must be finite and nonnegative.');
  const ids=new Set();
  for(const site of settings.sites){
    requireThat(typeof site?.id==='string'&&/^[a-z][a-z0-9-]*$/.test(site.id)&&!ids.has(site.id),'Invalid or duplicate rivet site ID.');ids.add(site.id);
    const fields=Object.keys(site).sort().join();
    if(fields==='axis,depthMm,id,part,positionMm'){
      requireThat(Array.isArray(site.positionMm)&&site.positionMm.length===3&&site.positionMm.every(Number.isFinite),'Rivet positionMm must be finite XYZ at its opening.');
      requireThat(Array.isArray(site.axis)&&site.axis.length===3&&site.axis.every(Number.isFinite)&&Math.hypot(...site.axis)>0,'Rivet axis must point into the part.');
      positive(site.depthMm,'depthMm');
    }else{
      requireThat(fields==='id,part,xMm,yMm,zBottomMm,zTopMm','Rivet sites need id, part, positionMm, axis and depthMm; existing vertical coordinate sites remain readable.');
      requireThat(['xMm','yMm','zBottomMm','zTopMm'].every(key=>Number.isFinite(site[key])),'Rivet coordinates must be finite.');
      requireThat(site.zBottomMm>=0&&site.zTopMm>site.zBottomMm,'A rivet needs its bottom within its component and its opening above it.');
    }
  }
}

export const plasticWeldRecordRuntime=()=>({validatePlasticWeld});

export function staggeredWeldSites({columns,rows,levels,pitchMm=12,heightStepMm=3,depthMm=4,
  xMm=4,yMm=4,zBottomMm=.8,part=null}){
  requireThat([columns,rows,levels].every(n=>Number.isSafeInteger(n)&&n>0)&&Number.isSafeInteger(columns*rows*levels),'Invalid rivet grid size.');
  [pitchMm,heightStepMm,depthMm].forEach(value=>positive(value,'grid spacing/depth'));
  return Array.from({length:levels},(_,k)=>Array.from({length:rows},(_,j)=>Array.from({length:columns},(_,i)=>({
    id:`rivet-${k}-${j}-${i}`,part,xMm:xMm+(i+(k%2)/2)*pitchMm,yMm:yMm+j*pitchMm,
    zBottomMm:zBottomMm+k*heightStepMm,zTopMm:zBottomMm+k*heightStepMm+depthMm
  })))).flat(2);
}

export function plasticWeldRuntime({Geometry,Recipe}){
  const {buildGeometry,revolvedProfile,section,regionArea,intersect}=Geometry;
  const {assignmentFilament,injectionAssignment}=Recipe;
  async function preparePlasticWeld({plan,placed,componentShells,processForAssignment}){
    const settings=plan.skills?.['plastic-weld'];if(!settings?.enabled)return {sites:[],notes:[]};
    const sites=[],notes=[];
    for(const site of settings.sites){
      try{sites.push(await prepareSite(site));}
      catch(error){notes.push('Rivet '+site.id+' produces nothing: '+error.message);}
    }
    return {sites,notes};
    async function prepareSite(site){
      requireThat(componentShells?componentShells.has(site.part):site.part===null,'Rivet site must select its native component.');
      const id='plastic-weld:'+site.id,process=processForAssignment({part:site.part});
      const shell=componentShells?componentShells.get(site.part):placed;
      const component=componentShells?plan.geometry.parts.find(part=>part.id===site.part):null;
      const offset=[component?.xMm??0,component?.yMm??0,component?.zMm??0];
      const authored=site.positionMm?site.positionMm:[site.xMm,site.yMm,shell.bounds.min[2]-offset[2]+site.zTopMm];
      const mouth=authored.map((value,k)=>value+offset[k]);
      const direction=site.axis??[0,0,-1],axis=direction.map(value=>value/Math.hypot(...direction));
      const depth=site.depthMm??site.zTopMm-site.zBottomMm;
      requireThat(settings.seatDepthMm<depth-PRINT_RESOLUTION_MM,'Rivet insertion depth must remain within its prepared cavity.');
      const neck=Math.max(0,depth-settings.basinHeightMm),profile=[[0,settings.shaftDiameterMm/2]];
      if(neck>0)profile.push([neck,settings.shaftDiameterMm/2]);
      profile.push([depth,settings.basinDiameterMm/2]);
      const cavityGeometry=revolvedProfile({positionMm:mouth,axis,profile}),widest=Math.max(settings.basinDiameterMm,settings.shaftDiameterMm)/2;
      const envelopeGeometry=revolvedProfile({positionMm:mouth,axis,profile:[[0,widest+settings.wallMm],[depth+settings.floorMm,widest+settings.wallMm]]});
      const cavity=await buildGeometry(cavityGeometry),solid=await buildGeometry(envelopeGeometry);
      const cavityVolumeMm3=profile.slice(1).reduce((sum,[s,r],i)=>{
        const [previous,priorRadius]=profile[i];return sum+Math.PI*(s-previous)*(priorRadius**2+priorRadius*r+r**2)/3;
      },0);
      const injection=mouth.map((value,k)=>value+settings.seatDepthMm*axis[k]);
      const assignment=injectionAssignment({id,part:site.part,filament:assignmentFilament(plan,{id,part:site.part}),nozzleC:settings.nozzleC,
        points:[{point:injection,direction:axis,volumeMm3:cavityVolumeMm3*settings.volumeFactor,
          flowMm3S:settings.flowMm3S,holdSeconds:settings.holdSeconds,approachMm:settings.seatDepthMm}]});
      const top=Math.min(shell.bounds.max[2],solid.bounds.max[2]),bottom=cavity.bounds.min[2],floor=solid.bounds.min[2];
      const report={id:site.id,part:site.part,positionMm:injection,openingMm:mouth[2],bottomMm:bottom,axis,depthMm:depth,
        cavityVolumeMm3,volumeMm3:assignment.points[0].volumeMm3,nozzleC:settings.nozzleC??plan.setup.nozzleC,flowMm3S:settings.flowMm3S,
        cavityGeometry:'rational-surface Boolean cutter'};
      return {...site,x:mouth[0],y:mouth[1],mouth,axis,depth,bottom,top,floor,widest,settings,assignment,process,cavity,solid,cavityGeometry,envelopeGeometry,report,notes:[]};
    }
  }
  function weldWork(sites){
    return sites.map(site=>({key:'rivet:'+site.id,kind:'inject',construction:'rivet',sourceId:site.assignment.id,part:site.part,
      nominalRank:site.top,context:{details:{site},assignment:site.assignment,process:site.process},requires:[],
      report:{sites:[site.report],physicalValidation:'not performed',notes:site.notes}}));
  }
  function encloses(site,node){
    if(node.kind!=='slice')return false;
    return node.layers.some(layer=>{
      const envelope=section(site.solid,layer.slice).loops;
      return envelope.length&&Math.abs(regionArea(intersect(layer.region,envelope)))>0;
    });
  }
  function weldDependencies(node,nodes){
    const needs=new Set();
    for(const other of nodes){
      if(other===node||other.part!==node.part)continue;
      if(node.construction==='rivet'&&encloses(node.details.site,other))needs.add(other.key);
      if(other.construction==='rivet'&&node.construction!=='rivet'&&!encloses(other.details.site,node)&&node.heightRange[1]>other.details.site.top+PRINT_RESOLUTION_MM)needs.add(other.key);
    }
    return [...needs];
  }
  return {preparePlasticWeld,weldWork,weldDependencies};
}
