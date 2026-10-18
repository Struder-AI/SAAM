// Plastic weld authors process cavities and material envelopes as ordinary
// rational geometry, then uses the shared Boolean and Inject operations.
const requireThat=(condition,message)=>{if(!condition)throw Error(message);};
export const PLASTIC_WELD_DEFAULTS={enabled:false,sites:[],shaftDiameterMm:1.2,basinDiameterMm:3,
  basinHeightMm:1.2,wallMm:1.2,floorMm:.8,seatDepthMm:0,volumeFactor:1,flowMm3S:.5,holdSeconds:1,nozzleC:null};
const positive=(value,name)=>requireThat(Number.isFinite(value)&&value>0,'plastic-weld '+name+' must be positive.');

export function validatePlasticWeld(settings){
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

export function staggeredWeldSites({columns,rows,levels,pitchMm=12,heightStepMm=3,depthMm=4,
  xMm=4,yMm=4,zBottomMm=.8,part=null}){
  requireThat([columns,rows,levels].every(n=>Number.isSafeInteger(n)&&n>0)&&Number.isSafeInteger(columns*rows*levels),'Invalid rivet grid size.');
  [pitchMm,heightStepMm,depthMm].forEach(value=>positive(value,'grid spacing/depth'));
  return Array.from({length:levels},(_,k)=>Array.from({length:rows},(_,j)=>Array.from({length:columns},(_,i)=>({
    id:`rivet-${k}-${j}-${i}`,part,xMm:xMm+(i+(k%2)/2)*pitchMm,yMm:yMm+j*pitchMm,
    zBottomMm:zBottomMm+k*heightStepMm,zTopMm:zBottomMm+k*heightStepMm+depthMm
  })))).flat(2);
}

export function plasticWeldSource({Geometry,Recipe,extensionId,settings:configuration}){
  const {PRINT_RESOLUTION_MM}=Geometry.dimensions;
  const settings={...PLASTIC_WELD_DEFAULTS,...configuration};
  requireThat(Array.isArray(settings.sites),'Plastic-weld sites must be an array.');
  const declarations=settings.sites.map(site=>{
    requireThat(typeof site?.id==='string'&&/^[a-z][a-z0-9-]*$/.test(site.id),'Invalid rivet site ID.');
    const id=extensionId+':'+site.id;return {id,assignments:[{id,part:site.part,construction:'inject'}]};
  });
  const {buildGeometry,revolvedProfile,convexVolume,rodFrame,point}=Geometry;
  const {assignmentFilament,injectionAssignment}=Recipe;
  const sides=96;
  // Convex prerequisites select only the floor and wall in the cavity's frame.
  function enclosureVolumes({mouth,axis,depth,widest,profile}){
    const frame=rodFrame(mouth,mouth.map((value,k)=>value+axis[k])),radius=widest+settings.wallMm,volumes=[];
    const ring=(s,r)=>Array.from({length:sides},(_,i)=>point(frame,[r*Math.cos(i*2*Math.PI/sides),r*Math.sin(i*2*Math.PI/sides),s]));
    volumes.push(convexVolume([...ring(depth,radius),...ring(depth+settings.floorMm,radius)]));
    const opening=Math.min(2*PRINT_RESOLUTION_MM,depth/4),radialGuard=1/Math.cos(Math.PI/sides);
    for(let k=1;k<profile.length;k++){
      const [low,innerLow]=profile[k-1],[high,innerHigh]=profile[k],start=Math.max(low,opening);
      if(high<=start)continue;
      const innerStart=innerLow+(innerHigh-innerLow)*(start-low)/(high-low);
      for(let i=0;i<sides;i++){
        const corners=(s,inner)=>[inner*radialGuard,radius].flatMap(r=>[i,i+1].map(j=>point(frame,[r*Math.cos(j*2*Math.PI/sides),r*Math.sin(j*2*Math.PI/sides),s])));
        volumes.push(convexVolume([...corners(start,innerStart),...corners(high,innerHigh)]));
      }
    }
    return volumes;
  }
  async function prepare({plan,placed,componentShells,processForAssignment}){
    requireThat(Object.keys(settings).every(key=>Object.hasOwn(PLASTIC_WELD_DEFAULTS,key)),'Unknown plastic-weld setting.');
    validatePlasticWeld({...settings,sites:[]});
    if(!settings.sites.length)return {contributions:[],failures:[]};
    requireThat(placed,'Plastic weld needs host geometry.');
    const failures=[],seen=new Set(),contributions=[];
    for(const site of settings.sites){
      try{
        validatePlasticWeld({...settings,sites:[site]});
        requireThat(!seen.has(site.id),'Duplicate rivet site ID.');seen.add(site.id);
        const prepared=await prepareSite(site);
        contributions.push({id:prepared.assignment.id,assignments:[prepared.assignment],
          geometryCuts:[{part:prepared.part,geometry:prepared.cavity}],solidVolumes:[{part:prepared.part,geometry:prepared.solid}],
          requiredMaterial:enclosureVolumes(prepared).map(volume=>({part:prepared.part,volume})),
          report:{...prepared.report,physicalValidation:'not performed',notes:prepared.notes}});
      }catch(error){
        if(error.name==='AbortError'||error.code==='ABORT_ERR')throw error;
        failures.push({id:extensionId+':'+site.id,message:error.message});
      }
    }
    return {failures,contributions};
    async function prepareSite(site){
      requireThat(componentShells?componentShells.has(site.part):site.part===null,'Rivet site must select its native component.');
      const id=extensionId+':'+site.id,process=processForAssignment({part:site.part});
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
      // Clear the entry shaft past the host, including rims above an oblique
      // mouth plane. Only the inward profile owns fill volume and enclosure.
      const outwardReach=axis.reduce((sum,c,k)=>sum-c*((c>0?shell.bounds.min[k]:shell.bounds.max[k])-mouth[k]),0);
      const clearance=Math.max(0,outwardReach)+settings.shaftDiameterMm/2;
      const cavityGeometry=revolvedProfile({positionMm:mouth,axis,profile:[[-clearance,settings.shaftDiameterMm/2],...profile]}),widest=Math.max(settings.basinDiameterMm,settings.shaftDiameterMm)/2;
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
      return {...site,x:mouth[0],y:mouth[1],mouth,axis,depth,bottom,top,floor,widest,settings,assignment,process,cavity,solid,cavityGeometry,envelopeGeometry,profile,report,notes:[]};
    }
  }
  return {declarations,prepare};
}
