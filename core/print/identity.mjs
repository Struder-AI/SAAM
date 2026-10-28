import {z} from 'zod';

// Shared part identity contract: CLI validates inputs and discovery recognizes
// the same library-relative names before caller path admission.
export const bundleIdSchema=z.string().min(1).refine(id=>{
  const parts=id.split('/');
  return parts.every(part=>part.length>0
    && !/^[.]|[. ]$|[\\:*?"<>|\x00-\x1f]/.test(part)
    && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part));
},'Invalid print name: use relative folder names, without traversal, reserved names or Windows path characters.');
