// Prepared geometry supplies its chart and separate completion identity.
// Sequence position is independent of spatial position and numeric slice labels.
import {requireThat} from '../private/toolpath/numeric.mjs';

export function preparedSurfaceReference({assignment,source}){
  const selection=assignment.surface,authored=source?.owner?.assignment??source?.assignment;
  const part=source?.owner&&Object.hasOwn(source.owner,'part')?source.owner.part:authored?.part??null;
  requireThat(authored?.id===selection.assignment&&part===assignment.part,
    'A slice reference needs prepared work on the selected part.');
  const stack=source.spec??source.preparedSurfaces;
  requireThat(stack?.layers,'Referenced producer has no prepared surface: '+selection.assignment+'.');
  const layer=selection.index===undefined?stack.layers.findLast(layer=>layer.slice&&layer.region?.length):
    stack.layers.find(layer=>layer.index===selection.index);
  requireThat(layer?.slice&&layer.region?.length,'Referenced stack has no selected prepared material surface: '+selection.assignment+'.');
  return {slice:layer.slice,region:layer.region,direction:layer.direction??source.referenceStack?.direction??stack.direction,
    prerequisites:[source.prerequisite??stack.prerequisite??{assignment:authored.id,part:assignment.part,index:layer.index}]};
}
