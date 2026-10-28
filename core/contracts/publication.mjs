// The application package and source reader share this publication boundary.
// A release records its exact selected files; a checkout selects tracked files.
export const PUBLISHED_SOURCE_MANIFEST='published-source.json';
const EXCLUDED=[/^relay\//,/^tools\//,/^(tmp|development)\//,/^scripts\/bench\//,/^scripts\/check-repo\.mjs$/,/^core\/tests\//,
  /^\.(local|claude|codex|github)\//,
  /^skills\/[^/]+\/tests\//,/^[^/]+\.html$/,/^result\.json$/,/^adapters\/mcp\//,
  /^packaging\/(build\.mjs|windows\/|macos\/)/];

export function applicationFile(file){
  return !EXCLUDED.some(pattern=>pattern.test(file));
}
// Source navigation excludes personal/runtime data even if an older package
// accidentally included it. This does not change which existing assets ship.
export function publishedSourceFile(file){
  if(typeof file!=='string'||!file||file.includes('\\')||file.includes(':')||file.includes('\0')||file.startsWith('/'))return false;
  const parts=file.split('/');
  if(parts.some(part=>!part||part==='.'||part==='..'||/^\.(git|local|saam|claude|codex|github|aws|vscode|idea)$|^\.env(?:\.|$)|^node_modules$/i.test(part)))return false;
  if(/^(local|state|prints|runtime|output|dist(?:-[^/]+)?|build|tmp|development)\//i.test(file))return false;
  return applicationFile(file)||/^packaging\/(windows|macos)\/.*\.(ps1|cmd|bat|vbs|sh)$/.test(file);
}
export const publishedTextSource=file=>publishedSourceFile(file)&&/\.(mjs|cjs|js|jsx|ts|tsx|json|md|txt|html|css|svg|py|ps1|sh|cmd|bat|vbs|applescript|jxa|cs|yaml|yml)$/i.test(file);
