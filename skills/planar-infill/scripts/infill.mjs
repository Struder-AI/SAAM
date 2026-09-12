import {fullFillResult,layerHeights} from '../../full-fill/scripts/fill.mjs';
import {createSectionQuery} from '../../../core/geom/query.mjs';
import {regionArea} from '../../../core/region/region2d.mjs';
import {intersect,difference,union} from '../../../core/region/boolean.mjs';
import {clipReservedRegion,clipAboveSurface} from '../../../core/region/reservation.mjs';
import {infillStrokes} from './patterns.mjs';

export const PLANAR_INFILL_DEFAULTS={perimeters:2,density:0.2,pattern:'rectilinear',sampleStepMm:0.2,maxPatternCells:1000000,fillAnglesDeg:[45,135],fillOverlap:0.15,minFeatureMm:0.4};

// One owner for walls; full-fill owns only selected solid interiors. Neither
// pattern makes a second toolpath or chooses process parameters at generation.
export function planarInfillResults({shell,plan,machine,reserve=null,id='planar-infill',solid=false,zStartMm=null,zEndMm=null,lowerSurface=null}) {
  const settings=plan.skills['planar-infill'],fill=plan.skills['full-fill'],width=plan.process.lineWidthMm;
  const heights=layerHeights(plan.process,shell.bounds.min[2],Math.min(shell.bounds.max[2],zEndMm??Infinity)).filter(z=>z>(zStartMm??-Infinity)+1e-9);
  const layerOffset=heights.length?Math.round((heights[0]-shell.bounds.min[2]-plan.process.firstLayerMm)/plan.process.layerMm):0;
  const reserves=Array.isArray(reserve)?reserve:[reserve].filter(Boolean);
  const query=createSectionQuery(shell,{minFeatureMm:settings.minFeatureMm}),sections=new Map();
  const sectionAt=z=>{if(!sections.has(z))sections.set(z,query(z));return sections.get(z);};
  // Shared solid/sparse construction owns one clipped region and centerline
  // inset per layer. A standalone sparse body needs neither eager mask pass.
  const regions=solid?heights.map(z=>{
    let region=sectionAt(z).loops;
    if(lowerSurface)region=clipAboveSurface(region,z,lowerSurface);
    for(const reservation of reserves)region=clipReservedRegion(region,z,reservation);
    return region;
  }):[];
  const solids=regions.map((region,i)=>{
    if(!solid||!region.length)return [];
    let supported=region,covered=region;
    for(let n=1;n<=fill.bottomLayers&&supported.length;n++)supported=intersect(supported,regions[i-n]??[]);
    for(let n=1;n<=fill.topLayers&&covered.length;n++)covered=intersect(covered,regions[i+n]??[]);
    return union(difference(region,supported),difference(region,covered));
  });
  const interiors=[];
  const prepared=solid?{regionAt:(_z,i)=>regions[i-layerOffset]}:{};
  const sparse=fullFillResult({shell,plan,machine,reserve,id,settings,spacingMm:settings.density===0?null:width/settings.density,zStartMm,zEndMm,lowerSurface,sectionAt,...prepared,
    interiorStrokes:(region,i,z)=>infillStrokes(region,{...settings,widthMm:width,angleDeg:settings.fillAnglesDeg[(settings.pattern==='rectilinear'?i:0)%settings.fillAnglesDeg.length],zMm:z}),
    interiorRegion:solid?(region,i)=>{
      interiors[i-layerOffset]=region;
      return difference(region,solids[i-layerOffset]);
    }:null});
  for(const op of sparse.operations)for(const stroke of op.strokes)if(stroke.role==='fill')stroke.role='infill';
  sparse.report.density=settings.density;
  sparse.report.pattern=settings.pattern??'rectilinear';
  if(!solid)return [sparse];
  const solidResult=fullFillResult({shell,plan,machine,reserve,id:id+':solid',settings:{...settings,perimeters:0},zStartMm,zEndMm,lowerSurface,sectionAt,
    regionAt:prepared.regionAt,fillRegionAt:(_whole,i)=>{
      // Match the sparse interior's centerline domain, including wall overlap.
      return solids[i-layerOffset].length?intersect(interiors[i-layerOffset],solids[i-layerOffset]):[];
    }});
  const sparseLayers=new Map();
  for(const op of sparse.operations){if(!sparseLayers.has(op.layer))sparseLayers.set(op.layer,[]);sparseLayers.get(op.layer).push(op);}
  for(const op of solidResult.operations){
    const wall=sparseLayers.get(op.layer)?.find(p=>p.id.endsWith(':walls'));
    if(wall)op.after.push(wall.id);
    for(const next of sparseLayers.get(op.layer+1)??[])next.after.push(op.id);
  }
  solidResult.report.selectedAreaMm2=solids.reduce((s,r)=>s+regionArea(r),0);
  return [sparse,solidResult];
}
