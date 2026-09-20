// The one authored input to the generated map: which top-level roots are mapped, and which are
// scanned only so the calls they make into the mapped roots are seen. Nothing else about the map
// is chosen here; regions, files, entries, numbering and every box come from the code.
export const mappedRoots=['core','studio'];
export const outsideRoots=['skills','adapters','scripts'];
export const scanRoots=[...mappedRoots,...outsideRoots];
const mappedPrefix=new RegExp(`^(${mappedRoots.join('|')})/`);
export const isMapped=file=>mappedPrefix.test(file);
// A served path that is not the module path on disk: the import specifier cannot be resolved by
// the file system alone, so the serving alias is stated here rather than guessed.
export const importAliases={'studio/app.mjs:./studio/machine-session.mjs':'studio/machine-session.mjs'};
