// CLI navigation names exact source spans; the human viewer owns code previews.
export function sourceLocations(page) {
  const spans=[page.sourceSpan??page,...(page.foldedCode??[])];
  const locations=new Map();
  for(const span of spans) {
    if(!span.file||!Number.isInteger(span.line)||!Number.isInteger(span.endLine))continue;
    const location={file:span.file,range:[span.line,span.endLine]};
    locations.set(JSON.stringify(location),location);
  }
  return [...locations.values()];
}
