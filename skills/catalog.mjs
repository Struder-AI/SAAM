// Explicit discovery catalog, shared by MCP and the generated maker digest.
// Extensions compose the three deposition primitives or construct geometry/assets.
export const SKILL_IDS = Object.freeze([
  'slice', 'trace', 'inject'
]);
export const EXTENSION_IDS = Object.freeze(['advanced-vase-wall','vase-wall','bridging','plastic-weld','heat-set-inserts','text','line-text','thingi10k','gridfinity','standard-support','bridge-supports','hole-transitions','wing','light-switch-covers']);
export const BUILDER_IDS = Object.freeze(['mesh-tools']);
export const GUIDANCE_IDS = Object.freeze(['supports','line-network','hole-supports','pipe-cladding','thick-lip','wave-overhangs']);
// Skills whose settings carry spacingFactor (core/path/spacing.mjs); slice
// assignments carry their own.
export const SPACING_SKILLS = Object.freeze([]);

export function skillMetadata(id, manual) {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(manual)?.[1] ?? '';
  const metadata = /^metadata:[ \t]*\r?\n((?:[ \t]+[^\r\n]*(?:\r?\n|$))*)/m.exec(frontmatter)?.[1] ?? '';
  return {
    id,
    layer:EXTENSION_IDS.includes(id)?'extension':GUIDANCE_IDS.includes(id)?'guidance':BUILDER_IDS.includes(id)?'builder':'core',
    // Hybrid skills change the geometry and deposit their own toolpath.
    kind: /^[ \t]+saam-kind:[ \t]*(geometry|hybrid|guidance|extension|workspace|machine)[ \t]*\r?$/m.exec(metadata)?.[1] ?? 'toolpath',
    description: frontmatter.match(/^description:[ \t]*(.*)$/m)?.[1]?.trim() ?? ''
  };
}
