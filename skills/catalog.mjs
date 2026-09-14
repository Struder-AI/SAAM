// Explicit discovery catalog, shared by MCP and the generated maker digest.
// Order introduces familiar printing approaches before specialized ones.
export const SKILL_IDS = Object.freeze([
  'planar-infill', 'full-fill', 'supports', 'rimming-planar', 'rimming-normal',
  'draped-skin', 'vase-wall', 'thick-lip', 'pipe-cladding', 'wedge-demo', 'mesh-tools', 'text', 'gridfinity'
]);

export function skillMetadata(id, manual) {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(manual)?.[1] ?? '';
  const metadata = /^metadata:[ \t]*\r?\n((?:[ \t]+[^\r\n]*(?:\r?\n|$))*)/m.exec(frontmatter)?.[1] ?? '';
  return {
    id,
    kind: /^[ \t]+saam-kind:[ \t]*task[ \t]*$/m.test(metadata) ? 'task' : 'printing',
    description: frontmatter.match(/^description:[ \t]*(.*)$/m)?.[1]?.trim() ?? ''
  };
}
