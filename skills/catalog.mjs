// Explicit discovery catalog, shared by MCP and the generated maker digest.
// Order introduces familiar printing approaches before specialized ones.
export const SKILL_IDS = Object.freeze([
  'slice', 'line-network', 'bridging', 'plastic-weld', 'supports',
  'draped-skin', 'wave-overhangs', 'vase-wall', 'advanced-vase-wall', 'thick-lip', 'pipe-cladding', 'thingi10k', 'mesh-tools', 'text', 'gridfinity', 'heat-set-inserts'
]);
// Skills whose settings carry spacingFactor (core/path/spacing.mjs); slice
// assignments carry their own.
export const SPACING_SKILLS = Object.freeze(['draped-skin', 'pipe-cladding']);

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
