// The one authored input to the generated map: which top-level roots are mapped, and which are
// scanned only so the calls they make into the mapped roots are seen. Nothing else about the map
// is chosen here; entry points, numbering and every box come from the code.
import {SKILL_IDS} from '../../skills/catalog.mjs';
export const mappedRoots=['core','studio'];
export const outsideRoots=['skills','adapters','scripts'];
// Scanned, but not mapped: code inside a mapped root that the map does not cover, each area an
// outside caller under its port name like the roots above — never a region, a page or an index.
// The agent CLI toolkit is agent tooling rather than core/Studio product code. The exporters are
// the machine-output dialects: each turns a SAAMpath into a machine program and reads that
// program back for review, and is documented in core/export/DEVELOP.md and its dialect contract
// instead. The dialect-neutral routing, travel advisory and playback files stay mapped, so any
// new file under core/export is an exporter unless it is named here.
const mappedExportFiles=new Set(['registry','travel-advisory','source-time','machine-study'].map(name=>`core/export/${name}.mjs`));
export const unmappedAreas=[
  {port:'core/agent',contains:file=>file.startsWith('core/agent/')},
  {port:'exporters',contains:file=>file.startsWith('core/export/')&&!mappedExportFiles.has(file)}
];
export const scanRoots=[...mappedRoots,...outsideRoots];
const mappedPrefix=new RegExp(`^(${mappedRoots.join('|')})/`);
const unmappedArea=path=>{const file=path.split('::')[0];return unmappedAreas.find(area=>area.contains(file));};
export const isMapped=file=>mappedPrefix.test(file)&&!unmappedArea(file);
// The outside root a scanned but unmapped path belongs to, as a port names it: the unmapped area
// when the path is inside one, otherwise its top-level root.
export const outsideRootOf=path=>unmappedArea(path)?.port??path.split('/')[0];
// Which outside files have their calls drawn as caller rows on a declaration page. A caller is
// active when it runs while a person makes a part or operates Studio: a catalogued skill's
// implementation scripts, the MCP adapter, the agent CLI toolkit and the script that fronts it,
// and the exporters. Everything else scanned — skill tests, demo and example scripts, benchmarks,
// audits — stays scanned and counted at the root, and is named on a declaration page only as a
// count. This is the only place that decision is made.
const skillScript=new RegExp(`^skills/(${SKILL_IDS.join('|')})/scripts/[^/]+\\.mjs$`);
const toolingScript=/^(?:adapters\/mcp\/src|core\/agent)\/[^/]+\.mjs$/;
export const activeCallers=file=>
  file==='scripts/agent-toolkit.mjs'||toolingScript.test(file)||unmappedArea(file)?.port==='exporters'
  ||skillScript.test(file)&&!/demo|example/.test(file.slice(file.lastIndexOf('/')+1));
// A served path that is not the module path on disk: the import specifier cannot be resolved by
// the file system alone, so the serving alias is stated here rather than guessed.
export const importAliases={'studio/app.mjs:./studio/machine-session.mjs':'studio/machine-session.mjs'};
