// Plastic weld prepares process geometry, material assignments and ordinary Inject.
// The selected extension copy owns the technique; it has no release-relative imports.
const requireThat=(condition,message)=>{if(!condition)throw Error(message);};
// copies core/dimensions.mjs PRINT_RESOLUTION_MM; this runtime has no release-relative imports
const PRINT_RESOLUTION_MM=1e-3;
// Heights (layer grid, rivet bottom and top, stroke levels) coincide and height
// ranges overlap to print resolution; an overlap below a print-resolution square is none.
export const PLASTIC_WELD_DEFAULTS={enabled:false,sites:[],shaftDiameterMm:1.2,basinDiameterMm:3,
  basinHeightMm:1.2,wallMm:1.2,floorMm:0.8,seatDepthMm:0,volumeFactor:1,flowMm3S:0.5,holdSeconds:1,nozzleC:null};
const positive=(v,name)=>requireThat(Number.isFinite(v)&&v>0,'plastic-weld '+name+' must be positive.');

export function validatePlasticWeld(s){
  requireThat(typeof s.enabled==='boolean'&&Array.isArray(s.sites),'plastic-weld needs an enabled flag and sites array.');
  for(const k of ['shaftDiameterMm','basinDiameterMm','basinHeightMm','wallMm','floorMm','volumeFactor','flowMm3S'])positive(s[k],k);
  requireThat(Number.isFinite(s.holdSeconds)&&s.holdSeconds>=0,'Rivet hold must be nonnegative.');
  requireThat(Number.isFinite(s.seatDepthMm)&&s.seatDepthMm>=0,'Rivet seat depth must be nonnegative.');
  if(s.nozzleC!==null)requireThat(Number.isFinite(s.nozzleC)&&s.nozzleC>=0,'Authored nozzle temperature must be finite and nonnegative.');
  const ids=new Set();
  for(const site of s.sites){
    requireThat(site&&Object.keys(site).sort().join()==='id,part,xMm,yMm,zBottomMm,zTopMm','Rivet sites need exactly id, part, xMm, yMm, zBottomMm and zTopMm.');
    requireThat(typeof site.id==='string'&&/^[a-z][a-z0-9-]*$/.test(site.id)&&!ids.has(site.id),'Invalid or duplicate rivet site ID.');ids.add(site.id);
    requireThat(['xMm','yMm','zBottomMm','zTopMm'].every(k=>Number.isFinite(site[k])),'Rivet coordinates must be finite.');
    requireThat(site.zBottomMm>=0&&site.zTopMm>site.zBottomMm,'A rivet needs its bottom within its component and its opening above it.');
  }
}

// Explicit sites can be spatially staggered while their height ranges overlap.
// This authoring helper returns ordinary locked sites, not a second recipe.
export function staggeredWeldSites({columns,rows,levels,pitchMm=12,heightStepMm=3,depthMm=4,
  xMm=4,yMm=4,zBottomMm=0.8,part=null}){
  requireThat([columns,rows,levels].every(n=>Number.isSafeInteger(n)&&n>0)&&Number.isSafeInteger(columns*rows*levels),'Invalid rivet grid size.');
  [pitchMm,heightStepMm,depthMm].forEach(v=>positive(v,'grid spacing/depth'));
  return Array.from({length:levels},(_,k)=>Array.from({length:rows},(_,j)=>Array.from({length:columns},(_,i)=>({
    id:`rivet-${k}-${j}-${i}`,part,xMm:xMm+(i+(k%2)/2)*pitchMm,yMm:yMm+j*pitchMm,
    zBottomMm:zBottomMm+k*heightStepMm,zTopMm:zBottomMm+k*heightStepMm+depthMm
  })))).flat(2);
}

export function plasticWeldSource({Geometry,Recipe,extensionId,settings:configuration}){
  const settings={...PLASTIC_WELD_DEFAULTS,...configuration};
  requireThat(Object.keys(settings).every(key=>Object.hasOwn(PLASTIC_WELD_DEFAULTS,key)),'Unknown plastic-weld setting.');
  const {makeMesh,convexVolume,horizontalSlice,sliceStack,regionArea}=Geometry;
  const {assignmentFilament,injectionAssignment}=Recipe;
  const sides=96;
  const circle=(x,y,r)=>[Array.from({length:sides},(_,i)=>[x+r*Math.cos(i*2*Math.PI/sides),y+r*Math.sin(i*2*Math.PI/sides)])];
  // One closed mesh represents the stepped cavity. This same prepared profile
  // supplies its polygonal volume; depositing results are never inspected.
  function profileSolid(x,y,profile){
    const vertices=profile.flatMap(([z,r])=>circle(x,y,r)[0].map(p=>[...p,z])),triangles=[];
    for(let ring=0;ring<profile.length-1;ring++)for(let i=0;i<sides;i++){
      const a=ring*sides+i,b=ring*sides+(i+1)%sides,c=a+sides,d=b+sides;
      triangles.push([a,b,d],[a,d,c]);
    }
    const last=(profile.length-1)*sides;
    for(let i=1;i<sides-1;i++)triangles.push([0,i+1,i],[last,last+i,last+i+1]);
    return makeMesh(vertices,triangles);
  }
  // Prerequisites select the floor and wall, never the empty fill cavity.
  function enclosureVolumes({x,y,floor,bottom,top,widest,profile}){
    const radius=widest+settings.wallMm,limit=top-Math.min(2*PRINT_RESOLUTION_MM,(top-floor)/4),volumes=[];
    if(bottom>floor)volumes.push(convexVolume(profileSolid(x,y,[[floor,radius],[bottom,radius]]).vertices));
    const boundary=profile.filter((p,i)=>i===0||i===profile.length-1||p[1]!==profile[i-1][1]||p[1]!==profile[i+1][1]);
    for(let k=1;k<boundary.length;k++){
      const [low,innerLow]=boundary[k-1],[high,innerHigh]=boundary[k],end=Math.min(high,limit);
      if(end<=low)continue;
      const innerEnd=innerLow+(innerHigh-innerLow)*(end-low)/(high-low);
      for(let i=0;i<sides;i++){
        const corners=(z,inner)=>[inner,radius].flatMap(r=>[i,i+1].map(j=>[x+r*Math.cos(j*2*Math.PI/sides),y+r*Math.sin(j*2*Math.PI/sides),z]));
        volumes.push(convexVolume([...corners(low,innerLow),...corners(end,innerEnd)]));
      }
    }
    return volumes;
  }
  function prepare({plan,placed,componentShells,processForAssignment}){
    validatePlasticWeld({...settings,sites:[]});
    requireThat(placed,'Plastic weld needs host geometry.');
    const notes=[],seen=new Set(),sites=settings.sites.flatMap(site=>{
      try{
        validatePlasticWeld({...settings,sites:[site]});
        requireThat(!seen.has(site.id),'Duplicate rivet site ID.');seen.add(site.id);
        return [prepareSite(site)];
      }catch(error){notes.push('Rivet '+site?.id+' produces nothing: '+error.message);return [];}
    });
    return {notes,contributions:sites.map(site=>({id:site.assignment.id,assignments:[site.assignment],
      geometryCuts:[{part:site.part,geometry:site.cavity}],solidVolumes:[{part:site.part,geometry:site.solid}],
      requiredMaterial:enclosureVolumes(site).map(volume=>({part:site.part,volume})),
      report:{...site.report,physicalValidation:'not performed',notes:site.notes}}))};
    function prepareSite(site){
      requireThat(componentShells?componentShells.has(site.part):site.part===null,'Rivet site must select its native component.');
      const id=extensionId+':'+site.id,process=processForAssignment({part:site.part});
      const shell=componentShells?componentShells.get(site.part):placed;
      const component=componentShells?plan.geometry.parts.find(p=>p.id===site.part):null;
      const x=(component?.xMm??0)+site.xMm,y=(component?.yMm??0)+site.yMm;
      const min=shell.bounds.min[2],first=min+process.firstLayerMm;
      const onGrid=z=>{const k=Math.round((z-first)/process.layerMm);return k>=0?first+k*process.layerMm:z-min<process.firstLayerMm/2?min:first;};
      const last=first+Math.floor((shell.bounds.max[2]-first+PRINT_RESOLUTION_MM)/process.layerMm)*process.layerMm;
      const bottom=onGrid(min+site.zBottomMm),top=Math.min(onGrid(min+site.zTopMm),last);
      requireThat(top>bottom+PRINT_RESOLUTION_MM,'Rivet '+site.id+' has no depth on its component layer grid.');
      requireThat(settings.seatDepthMm<top-bottom-PRINT_RESOLUTION_MM,'Rivet insertion depth must remain within its prepared cavity.');
      const levels=sliceStack({base:horizontalSlice(min),pitchMm:process.layerMm,firstLayerMm:process.firstLayerMm},
        {...shell.bounds,max:[shell.bounds.max[0],shell.bounds.max[1],top]}).layers.map(layer=>layer.slice.origin[2]).filter(z=>z>bottom+PRINT_RESOLUTION_MM);
      const radiusAt=z=>settings.shaftDiameterMm/2+(settings.basinDiameterMm-settings.shaftDiameterMm)/2*Math.max(0,1-(z-bottom)/settings.basinHeightMm);
      const profile=[];let from=bottom,cavityVolumeMm3=0;
      for(const z of levels){
        const radius=radiusAt(z-process.layerMm);
        if(!profile.length||profile.at(-1)[1]!==radius)profile.push([from,radius]);
        profile.push([z,radius]);
        cavityVolumeMm3+=Math.abs(regionArea(circle(x,y,radius)))*(z-from);from=z;
      }
      const cavity=profileSolid(x,y,profile),widest=Math.max(settings.basinDiameterMm,settings.shaftDiameterMm)/2;
      const floor=Math.max(min,bottom-settings.floorMm),solid=profileSolid(x,y,[[floor,widest+settings.wallMm],[top,widest+settings.wallMm]]);
      const assignment=injectionAssignment({id,part:site.part,filament:assignmentFilament(plan,{id,part:site.part}),nozzleC:settings.nozzleC,
        points:[{point:[x,y,top-settings.seatDepthMm],volumeMm3:cavityVolumeMm3*settings.volumeFactor,
          flowMm3S:settings.flowMm3S,holdSeconds:settings.holdSeconds,approachMm:settings.seatDepthMm}]});
      const report={id:site.id,part:site.part,positionMm:assignment.points[0].point,openingMm:top,bottomMm:bottom,
        cavityVolumeMm3,volumeMm3:assignment.points[0].volumeMm3,nozzleC:settings.nozzleC??plan.setup.nozzleC,flowMm3S:settings.flowMm3S};
      const notes=Math.max(Math.abs(bottom-min-site.zBottomMm),Math.abs(top-min-site.zTopMm))>PRINT_RESOLUTION_MM?
        ['Rivet '+site.id+': placed on its component layer grid, Z '+(bottom-min).toFixed(3)+' to '+(top-min).toFixed(3)+' mm above its base.']:[];
      return {...site,x,y,bottom,top,floor,widest,settings,assignment,process,cavity,solid,profile,report,notes};
    }
  }
  return {prepare};
}
