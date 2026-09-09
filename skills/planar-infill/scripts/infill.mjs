import {fullFillResult,layerHeights} from '../../full-fill/scripts/fill.mjs';
import {sectionGeometry} from '../../../core/geom/query.mjs';
import {offsetRegion,regionArea} from '../../../core/region/region2d.mjs';
import {intersect,difference,union,levelSetRegion,levelSetCoverage} from '../../../core/region/boolean.mjs';

export const PLANAR_INFILL_DEFAULTS={perimeters:2,density:0.2,fillAnglesDeg:[45,135],fillOverlap:0.15,minFeatureMm:0.4};

// One owner for walls; full-fill owns only selected solid interiors. Neither
// pattern makes a second toolpath or chooses process parameters at generation.
export function planarInfillResults({shell,plan,reserve=null,id='planar-infill',solid=false}) {
  const settings=plan.skills['planar-infill'],fill=plan.skills['full-fill'],width=plan.process.lineWidthMm;
  const heights=layerHeights(plan.process,shell.bounds.min[2],reserve?reserve.maxMm:shell.bounds.max[2]);
  const regions=heights.map(z=>{
    let region=sectionGeometry(shell,z,{minFeatureMm:settings.minFeatureMm}).loops;
    if(reserve){const coverage=levelSetCoverage(reserve.field,z);if(coverage==='none')region=[];else if(coverage==='partial')region=intersect(region,levelSetRegion(reserve.field,z));}
    return region;
  });
  const solids=regions.map((region,i)=>{
    if(!solid||!region.length)return [];
    let supported=region,covered=region;
    for(let n=1;n<=fill.bottomLayers;n++)supported=intersect(supported,regions[i-n]??[]);
    for(let n=1;n<=fill.topLayers;n++)covered=intersect(covered,regions[i+n]??[]);
    return union(difference(region,supported),difference(region,covered));
  });
  const sparse=fullFillResult({shell,plan,reserve,id,settings,spacingMm:width/settings.density,
    interiorRegion:(region,i)=>difference(region,solids[i])});
  for(const op of sparse.operations)for(const stroke of op.strokes)if(stroke.role==='fill')stroke.role='infill';
  sparse.report.density=settings.density;
  if(!solid)return [sparse];
  const solidResult=fullFillResult({shell,plan,reserve,id:id+':solid',settings:{...settings,perimeters:0},
    interiorRegion:(_region,i,_z,whole)=>{
      // Match the sparse interior's centerline domain, including wall overlap.
      const interior=offsetRegion(whole,-width*(settings.perimeters>0?settings.perimeters+0.5-settings.fillOverlap:0.5));
      return intersect(interior,solids[i]);
    }});
  for(const op of solidResult.operations){
    const wall=sparse.operations.find(p=>p.layer===op.layer&&p.id.endsWith(':walls'));
    if(wall)op.after.push(wall.id);
    for(const next of sparse.operations.filter(p=>p.layer===op.layer+1))next.after.push(op.id);
  }
  solidResult.report.selectedAreaMm2=solids.reduce((s,r)=>s+regionArea(r),0);
  return [sparse,solidResult];
}
