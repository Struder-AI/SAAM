// Explicit discovery catalog, shared by MCP and the generated maker digest.
// Extensions compose the three deposition primitives or construct geometry/assets.
export const SKILL_IDS = Object.freeze([
  'slice', 'trace', 'inject'
]);
export const EXTENSION_IDS = Object.freeze(['advanced-vase-wall','vase-wall','bridging','draped-skin','wave-overhangs','thick-lip','pipe-cladding','plastic-weld','heat-set-inserts','text','line-text','thingi10k','gridfinity','supports','hole-supports','wing']);
// These extensions consume named plan.skills configuration. Other dependencies
// are already represented by geometry shapes or construction assignments.
export const EXTENSION_CONFIGURATION_IDS=Object.freeze(['supports','plastic-weld']);
export const BUILDER_IDS = Object.freeze(['mesh-tools']);
export const GUIDANCE_IDS = Object.freeze(['line-network']);
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
    kind: /^[ \t]+saam-kind:[ \t]*(geometry|hybrid|guidance|extension|workspace)[ \t]*\r?$/m.exec(metadata)?.[1] ?? 'toolpath',
    description: frontmatter.match(/^description:[ \t]*(.*)$/m)?.[1]?.trim() ?? ''
  };
}
