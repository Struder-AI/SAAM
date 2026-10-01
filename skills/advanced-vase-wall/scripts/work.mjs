import {requireThat} from '../../../core/geom/tolerance.mjs';
import {depositedBeadSegments} from '../../../core/path/deposited-curves.mjs';
import {advancedVaseResult} from './advanced-vase.mjs';
import {standardVaseResult} from '../../vase-wall/scripts/prepare.mjs';

export function constructVaseWork({node,samePart,after,machine,onProgress,substrateAdaptation}){
  const context=node.context??node.record.context,assignment=node.context?.assignment??node.record.spec.settings;
  const foundations=samePart.filter(item=>item.node.nominalRank<=context.startMm+1e-8);
  if(assignment.zStartMm>0){
    const grid=(assignment.zStartMm-context.process.firstLayerMm)/context.process.layerMm;
    requireThat(Math.abs(grid-Math.round(grid))<1e-8,'A raised sleeve must start on its resolved process layer grid.');
    requireThat(foundations.some(item=>item.result.operations.length),'A raised sleeve needs supporting deposition below its start.');
  }
  const foundationSegments=substrateAdaptation&&assignment.zStartMm>0?depositedBeadSegments(foundations.flatMap(item=>item.result.operations),{widthMm:context.process.lineWidthMm}):[];
  return node.kind==='slice'?standardVaseResult(node.record,{foundationSegments,substrateAdaptation}):advancedVaseResult({...context,machine,after,onProgress,foundationSegments,substrateAdaptation});

}

export function vaseDependencies(node,nodes){
  const needs=new Set();
  for(const other of nodes){
    if(other===node)continue;
      if(node.construction==='sleeve'&&other.part===node.part){
        if(other.kind==='slice'&&!other.record.reference&&other.nominalRank<=(node.context??node.record.context).startMm+1e-8||other.construction==='sleeve'&&(other.context??other.record.context).endMm<=(node.context??node.record.context).startMm+1e-8)needs.add(other.key);
      }
      if(node.kind==='slice'&&!node.record.reference&&other.construction==='sleeve'&&other.part===node.part&&node.nominalRank>(other.context??other.record.context).endMm+1e-8){
        requireThat((other.context?.assignment??other.record.spec.settings).endTransition==='level','Slices above a sleeve need its ending transition to be level.');needs.add(other.key);
      }
  }
  return [...needs];
}
