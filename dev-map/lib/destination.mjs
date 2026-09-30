// How an address opens: a leaf as its code, the top map and every cluster as a map. Shared by
// generation, the agent read and the drawing.
export const destinationFor=page=>['root','group'].includes(page.kind)?'graph':'code';
