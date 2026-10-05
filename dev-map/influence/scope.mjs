// What the influence analysis reads: the in-scope files and the static imports between them.
// run.mjs selects from these files and follows these imports for --closure; analyse.mjs splits
// the scope into import closures by the same graph. The scope is stated here once.
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import * as acorn from 'acorn';
import {resolver} from './constraints.mjs';
import {importAliases} from '../lib/scope.mjs';

// Scope: SAAM code and its development tooling (map-0 node Development tooling). Tests, demos and benchmarks are out.
// Packaging belongs to the 030-deployment set, except the application host that carries saam calls to the runtime
// and the release build (build, native-repair).
export const ROOTS=/^(core|studio|skills|workspaces|scripts|adapters)\/|^packaging\/(application|launch|build|native-repair)\.mjs$/;
export const OUT=/(^|\/)(tests?|demos?|bench|benchmarks?|fixtures?|examples?|vendor|node_modules)\/|\.test\.|\.min\.|^scripts\/(bench|bambu-audit)|^packaging\/(windows|macos)\//;
export const inScope=f=>/\.(mjs|js)$/.test(f)&&ROOTS.test(f)&&!OUT.test(f);

// Existing in-scope files, including new unignored source, as repository-relative paths.
export const scopeFiles=repo=>[...new Set(execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{cwd:repo,encoding:'utf8'}).split('\0'))].filter(file=>inScope(file)&&existsSync(resolve(repo,file)));
export const importResolver=files=>resolver(files,{aliases:importAliases});

// A module as a script when it does not parse as a module; null when it parses as neither.
export function parseModule(text,{locations=false}={}) {
  for(const sourceType of ['module','script']) {
    try{return acorn.parse(text,{ecmaVersion:'latest',sourceType,locations,allowHashBang:true});}catch{}
  }
  return null;
}
// The specifiers a module imports or re-exports statically. Dynamic imports are not followed.
export const staticImports=ast=>ast.body.filter(s=>(s.type==='ImportDeclaration'||s.type==='ExportAllDeclaration'||s.type==='ExportNamedDeclaration')&&s.source).map(s=>s.source.value);

// The import graph of the scope: each file's in-scope static imports, the files that parse as
// neither module nor script (they import nothing here), and each file's text.
export async function importGraph(repo) {
  const files=scopeFiles(repo),resolveImport=importResolver(files),deps=new Map(),texts=new Map(),unparsed=[];
  for(const file of files) {
    const text=await readFile(resolve(repo,file),'utf8');texts.set(file,text);
    const ast=parseModule(text);
    if(!ast){unparsed.push(file);deps.set(file,[]);continue;}
    deps.set(file,[...new Set(staticImports(ast).map(spec=>resolveImport(file,spec)).filter(t=>t&&inScope(t)))]);
  }
  return {files,deps,texts,unparsed};
}
// A file and every in-scope file it imports, transitively.
export function closureOf(file,deps) {
  const seen=new Set([file]),queue=[file];
  while(queue.length)for(const d of deps.get(queue.pop())??[])if(!seen.has(d)){seen.add(d);queue.push(d);}
  return seen;
}
