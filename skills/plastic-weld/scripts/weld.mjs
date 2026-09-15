import {requireThat} from '../../../core/geom/tolerance.mjs';
import {difference,union} from '../../../core/region/boolean.mjs';
import {regionArea,pointSegmentDistance} from '../../../core/region/region2d.mjs';
import {layerHeights} from '../../full-fill/scripts/fill.mjs';
import {requireProcessControl,validateNozzleC} from '../../../core/path/process-controls.mjs';

export const PLASTIC_WELD_DEFAULTS={enabled:false,sites:[],shaftDiameterMm:1.2,basinDiameterMm:3,
  basinHeightMm:1.2,wallMm:1.2,floorMm:0.8,seatDepthMm:0,volumeFactor:1,flowMm3S:0.5,holdSeconds:1,nozzleC:null};
const positive=(v,name)=>requireThat(Number.isFinite(v)&&v>0,'plastic-weld '+name+' must be positive.');
const circle=(x,y,r)=>[Array.from({length:96},(_,i)=>[x+r*Math.cos(i*2*Math.PI/96),y+r*Math.sin(i*2*Math.PI/96)])];
const area=r=>Math.abs(regionArea(r));
const height=op=>op.strokes.reduce((h,s)=>s.points.reduce((z,p)=>Math.max(z,p[2]),h),-Infinity);

export function validatePlasticWeld(plan,machine){
  const s=plan.skills['plastic-weld'];
  requireThat(typeof s.enabled==='boolean'&&Array.isArray(s.sites)&&s.sites.length<=256,'plastic-weld needs an enabled flag and at most 256 sites.');
  for(const k of ['shaftDiameterMm','basinDiameterMm','basinHeightMm','wallMm','floorMm','volumeFactor','flowMm3S'])positive(s[k],k);
  requireThat(s.basinDiameterMm>s.shaftDiameterMm,'The rivet basin must be wider than its shaft.');
  if(s.enabled)requireThat(s.wallMm>=plan.process.lineWidthMm&&s.floorMm>=plan.process.layerMm,'Rivet walls and floor must contain at least one bead/layer.');
  requireThat(Number.isFinite(s.holdSeconds)&&s.holdSeconds>=0&&s.holdSeconds<=60,'Rivet hold must be 0–60 seconds.');
  requireThat(Number.isFinite(s.seatDepthMm)&&s.seatDepthMm>=0&&s.seatDepthMm<=0.5,'Rivet seat depth must be 0–0.5 mm.');
  if(s.nozzleC!==null)validateNozzleC(s.nozzleC,plan,machine);
  if(s.enabled){requireProcessControl(machine);requireThat(s.sites.length>0,'Assign at least one plastic-weld site.');}
  const ids=new Set();
  for(const site of s.sites){
    requireThat(site&&Object.keys(site).sort().join()==='id,part,xMm,yMm,zBottomMm,zTopMm','Rivet sites need exactly id, part, xMm, yMm, zBottomMm and zTopMm.');
    requireThat(typeof site.id==='string'&&/^[a-z][a-z0-9-]*$/.test(site.id)&&!ids.has(site.id),'Invalid or duplicate rivet site ID.');ids.add(site.id);
    requireThat(['xMm','yMm','zBottomMm','zTopMm'].every(k=>Number.isFinite(site[k])),'Rivet coordinates must be finite.');
    if(s.enabled)requireThat(plan.geometry.shape==='assembly'?plan.geometry.parts.some(p=>p.id===site.part):site.part===null,'Rivet site must select its native component.');
    requireThat(site.zBottomMm>=s.floorMm&&site.zTopMm-site.zBottomMm>s.basinHeightMm,'Rivet needs a solid floor and a shaft above its basin.');
    requireThat(site.zTopMm-site.zBottomMm-s.basinHeightMm>s.seatDepthMm,'Nozzle seating must remain within the shaft.');
  }
}

// Explicit sites can be spatially staggered while their height ranges overlap.
// This authoring helper returns ordinary locked sites, not a second recipe.
export function staggeredWeldSites({columns,rows,levels,pitchMm=12,heightStepMm=3,depthMm=4,
  xMm=4,yMm=4,zBottomMm=0.8,part=null}){
  requireThat([columns,rows,levels].every(n=>Number.isInteger(n)&&n>0)&&columns*rows*levels<=256,'Invalid rivet grid size.');
  [pitchMm,heightStepMm,depthMm].forEach(v=>positive(v,'grid spacing/depth'));
  return Array.from({length:levels},(_,k)=>Array.from({length:rows},(_,j)=>Array.from({length:columns},(_,i)=>({
    id:`rivet-${k}-${j}-${i}`,part,xMm:xMm+(i+(k%2)/2)*pitchMm,yMm:yMm+j*pitchMm,
    zBottomMm:zBottomMm+k*heightStepMm,zTopMm:zBottomMm+k*heightStepMm+depthMm
  })))).flat(2);
}

export function preparePlasticWeld({plan,placed,componentShells}){
  const settings=plan.skills['plastic-weld'];if(!settings.enabled)return [];
  const sites=settings.sites.map(site=>{
    const shell=componentShells?componentShells.get(site.part):placed;
    const component=componentShells?plan.geometry.parts.find(p=>p.id===site.part):null;
    const x=plan.placement.xMm+(component?.xMm??0)+site.xMm,y=plan.placement.yMm+(component?.yMm??0)+site.yMm;
    const bottom=shell.bounds.min[2]+site.zBottomMm,top=shell.bounds.min[2]+site.zTopMm;
    const grid=z=>(z-shell.bounds.min[2]-plan.process.firstLayerMm)/plan.process.layerMm;
    for(const z of [bottom,top,bottom-settings.floorMm])requireThat(z>=shell.bounds.min[2]-1e-8&&(Math.abs(z-shell.bounds.min[2])<1e-8||Math.abs(grid(z)-Math.round(grid(z)))<1e-7),'Rivet bottom, opening and floor must align with the component layer grid.');
    requireThat(top<=shell.bounds.max[2]+1e-8,'Rivet opening exceeds its component.');
    const radiusAt=z=>settings.shaftDiameterMm/2+(settings.basinDiameterMm-settings.shaftDiameterMm)/2*Math.max(0,1-(z-bottom)/settings.basinHeightMm);
    // The maximum radius over each bead's height preserves a printable stepped
    // cavity. Meter its actual polygonal volume, not an ideal cone's volume.
    const regionAt=z=>z>bottom+1e-8&&z<=top+1e-8?circle(x,y,radiusAt(z-plan.process.layerMm)):[];
    const footprint=circle(x,y,settings.basinDiameterMm/2);
    const solidRegionAt=z=>z>bottom-settings.floorMm+1e-8&&z<=top+1e-8?
      difference(circle(x,y,settings.basinDiameterMm/2+settings.wallMm),regionAt(z)):[];
    const completion={z:top,region:regionAt(top),operationId:'plastic-weld:'+site.id};
    const reservation={footprint,regionAt,solidRegionAt,completion};
    shell.processReservations??=[];shell.processReservations.push(reservation);
    return {...site,x,y,bottom,top,shell,regionAt,radiusAt,settings};
  });
  for(let i=0;i<sites.length;i++)for(let j=0;j<i;j++){
    const a=sites[i],b=sites[j];
    if(Math.min(a.top,b.top)>Math.max(a.bottom-settings.floorMm,b.bottom-settings.floorMm)+1e-8)
      requireThat(Math.hypot(a.x-b.x,a.y-b.y)>=settings.basinDiameterMm+2*settings.wallMm,
        'Overlapping rivet envelopes: stagger sites farther apart or separate their height ranges.');
  }
  return sites;
}

export function plasticWeldResult({plan,sites,modelResults}){
  if(!sites.length)return null;
  const model=modelResults.flatMap(r=>r.operations),operations=[],reports=[];
  const planarLayers=new Map();
  for(const op of model)if(op.region&&op.materialCoverage==='area'){
    const key=height(op).toFixed(7);
    if(!planarLayers.has(key))planarLayers.set(key,{operations:[]});
    planarLayers.get(key).operations.push(op);
  }
  for(const site of sites){
    const {settings:s,shell,x,y,bottom,top}=site;
    const levels=layerHeights(plan.process,shell.bounds.min[2],top).filter(z=>z>bottom-s.floorMm+1e-8);
    const hostIds=new Set();let cavityVolumeMm3=0;
    for(const z of levels){
      const cavity=site.regionAt(z),outer=circle(x,y,(z<=bottom+1e-8?s.basinDiameterMm/2:site.radiusAt(z-plan.process.layerMm))+s.wallMm);
      const required=cavity.length?difference(outer,cavity):outer;
      const layer=planarLayers.get(z.toFixed(7)),candidates=layer?.operations??[];
      const supplied=layer?(layer.region??=union(candidates.flatMap(op=>op.materialRegion??[]),[])):[];
      requireThat(area(difference(required,supplied))<=0.01,
        `Rivet ${site.id} needs solid enclosing material and a closed floor at Z=${z.toFixed(3)}; sparse infill, hollow walls or missing layers cannot contain this injection. Assign a solid host region.`);
      for(const op of candidates)hostIds.add(op.id);
      cavityVolumeMm3+=area(cavity)*plan.process.layerMm;
    }
    // A nonplanar/continuous owner cannot silently deposit across the cavity.
    // Inspect all strokes, including other components, supports and finishes.
    for(const op of model)for(const stroke of op.strokes){
      const points=stroke.closed?[...stroke.points,stroke.points[0]]:stroke.points;
      for(let i=1;i<points.length;i++){
        const a=points[i-1],b=points[i],lo=Math.min(a[2],b[2]),hi=Math.max(a[2],b[2]);
        if(hi<=bottom+1e-8||lo>top+1e-8)continue;
        // Planar owners already reserved the precise cavity. Curved paths are
        // bounded conservatively by the basin cylinder including bead width.
        if(op.region&&Math.abs(a[2]-b[2])<1e-8){
          requireThat(pointSegmentDistance([x,y],a,b)>=site.radiusAt(a[2]-plan.process.layerMm)+plan.process.lineWidthMm/2-0.025,
            `Operation ${op.id} deposits inside rivet ${site.id}; separate overlapping material owners.`);
          continue;
        }
        requireThat(pointSegmentDistance([x,y],a,b)>s.basinDiameterMm/2+plan.process.lineWidthMm/2,
          `Operation ${op.id} crosses rivet ${site.id}; move the site into solid planar material or separate the operation's region.`);
      }
    }
    const id='plastic-weld:'+site.id,layer=Math.round((top-shell.bounds.min[2]-plan.process.firstLayerMm)/plan.process.layerMm);
    // A height barrier prevents later cover layers (from any skill) closing the
    // mouth before injection. Existing prerequisites remain authoritative.
    const after=[...hostIds];
    for(const op of model)if(height(op)>top+1e-8)op.after=[...new Set([...(op.after??[]),id])];
    const volumeMm3=cavityVolumeMm3*s.volumeFactor;
    const layerZ=shell.bounds.min[2]+plan.process.firstLayerMm+layer*plan.process.layerMm;
    operations.push({id,phase:'plastic-weld',layer,layerId:'planar:'+layerZ,rank:top,after,order:'given',
      strokes:[{points:[[x,y,top-s.seatDepthMm]],role:'plastic-rivet',stationaryExtrusion:{volumeMm3,flowMm3S:s.flowMm3S,holdSeconds:s.holdSeconds}}],
      ...(s.nozzleC!==null?{nozzleC:s.nozzleC,restoreNozzleC:plan.setup.nozzleC}:{}),
      travelPolicy:{clearanceFor:()=>top,constantClearanceZ:top,canTravelDirect:()=>false,maxCombMm:0},clearanceZ:top+plan.process.liftMm});
    reports.push({id:site.id,part:site.part,positionMm:[x,y,top-s.seatDepthMm],openingMm:top,bottomMm:bottom,cavityVolumeMm3,volumeMm3,
      nozzleC:s.nozzleC??plan.setup.nozzleC,flowMm3S:Math.min(s.flowMm3S,plan.process.maxFlowMm3S)});
  }
  return {id:'plastic-weld',operations,report:{sites:reports,physicalValidation:'not performed'}};
}
