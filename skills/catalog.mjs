// Explicit discovery catalog, shared by MCP and the generated maker digest.
// Construction techniques are manuals of the general slice skill.
export const SKILL_IDS = Object.freeze([
  'slice', 'plastic-weld', 'heat-set-inserts', 'text', 'mesh-tools', 'thingi10k', 'gridfinity', 'supports'
]);
export const TECHNIQUE_IDS = Object.freeze(['line-network','bridging','draped-skin','wave-overhangs','vase-wall','advanced-vase-wall','thick-lip','pipe-cladding']);
// Skills whose settings carry spacingFactor (core/path/spacing.mjs); slice
// assignments carry their own.
export const SPACING_SKILLS = Object.freeze([]);

export function skillMetadata(id, manual) {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(manual)?.[1] ?? '';
  const metadata = /^metadata:[ \t]*\r?\n((?:[ \t]+[^\r\n]*(?:\r?\n|$))*)/m.exec(frontmatter)?.[1] ?? '';
  return {
    id,
    // Hybrid skills change the geometry and deposit their own toolpath.
    kind: /^[ \t]+saam-kind:[ \t]*(geometry|hybrid)[ \t]*\r?$/m.exec(metadata)?.[1] ?? 'toolpath',
    description: frontmatter.match(/^description:[ \t]*(.*)$/m)?.[1]?.trim() ?? ''
  };
}
