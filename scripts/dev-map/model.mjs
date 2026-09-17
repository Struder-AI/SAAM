import {readFile, readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'acorn';

export const root = fileURLToPath(new URL('../../', import.meta.url));
const cells = text => text.split('|').map(s => s.trim());
const fail = message => { throw Error(message); };

export function declarations(text, path) {
  const found = new Map();
  function walk(node, scope = []) {
    if (!node || typeof node !== 'object') return;
    let name;
    if (['FunctionDeclaration', 'ClassDeclaration'].includes(node.type)) name = node.id?.name;
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier') name = node.id.name;
    if (['MethodDefinition', 'Property'].includes(node.type) && !node.computed
      && (node.type === 'MethodDefinition' || /FunctionExpression/.test(node.value?.type))) name = node.key.name ?? node.key.value;
    const next = name ? [...scope, name] : scope;
    if (name) {
      const anchor = `${path}::${next.join('::')}`;
      if (found.has(anchor)) found.set(anchor, null);
      else found.set(anchor, {src:path, a:node.loc.start.line, b:node.loc.end.line,
        t:text.slice(node.start,node.end)});
    }
    for (const [key, value] of Object.entries(node)) {
      if (['loc','start','end','id','key'].includes(key)) continue;
      if (Array.isArray(value)) {
        for (const child of value) if(child?.type) walk(child,next);
      } else if (value?.type) walk(value,next);
    }
  }
  walk(parse(text,{ecmaVersion:'latest',sourceType:'module',locations:true}));
  return found;
}

export function parseRegion(text, source) {
  const pages = [], components = [], prose = [];
  let page, componentBlock = false;
  for (const raw of text.split(/\r?\n/)) {
    const start = /^```saam-page\s+(\S+)\s*$/.exec(raw);
    if (start) {
      if (page || componentBlock) fail(`${source}: nested map fence`);
      page = {key:start[1], source, title:start[1], subtitle:'', nodes:[], edges:[], inputs:[], outputs:[]};
      continue;
    }
    if (raw === '```saam-components') {componentBlock = true; continue;}
    if (raw.trim() === '```' && (page || componentBlock)) {
      if (page) pages.push(page);
      page = null; componentBlock = false; continue;
    }
    if (!page && !componentBlock) {prose.push(raw);continue;}
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (componentBlock) {
      const [id,anchor,input,output,semantics] = cells(line);
      if (!id || !anchor?.startsWith('@') || !input || !output || !semantics) fail(`${source}: incomplete component contract`);
      components.push({id,anchor:anchor.slice(1),input,output,semantics,source});continue;
    }
    const space = line.indexOf(' '), word = line.slice(0,space), rest = line.slice(space+1).trim();
    if (/^\S+\s*>/.test(line)) {
      const [src,tail] = line.split(/\s*>\s*/,2), [dst,label='',kind='data',rank] = cells(tail);
      page.edges.push({src,dst,label,kind,rank:rank!=='norank'});
    } else if (word === 'title') page.title = rest;
    else if (word === 'sub') page.subtitle = rest;
    else if (word === 'parent') page.parent = rest.split(/\s+/);
    else if (word === 'in') page.inputs.push(rest);
    else if (word === 'out') page.outputs.push(rest);
    else if (word === 'width') page.width = Number(rest);
    else if (['box','state','gap','port','ext'].includes(word)) {
      const c = cells(rest), boundary = ['port','ext'].includes(word);
      const [id,num,label,target,note] = boundary ? [c[0],null,c[1],c[2],c[3]] : c;
      page.nodes.push({id,num,label,target:target??'',note:note??'',kind:word==='box'?'stage':word});
    } else fail(`${source} [${page.key}]: unknown directive ${word}`);
  }
  if (page || componentBlock) fail(`${source}: unclosed map fence`);
  return {pages,components,prose:prose.join('\n')};
}

export async function loadModel({repo=root, directory='maps'}={}) {
  const pages = [], contracts = new Map(), specs = {};
  for (const name of (await readdir(resolve(repo,directory))).filter(n=>/^\d.*\.md$/.test(n)).sort()) {
    const source = `${directory}/${name}`, text = await readFile(resolve(repo,source),'utf8');
    const parsed = parseRegion(text,source); specs[source] = parsed.prose;
    pages.push(...parsed.pages);
    for (const component of parsed.components) {
      if (contracts.has(component.id)) fail(`Duplicate component ${component.id}`);
      contracts.set(component.id,component);
    }
  }
  const byKey = new Map(), addresses = new Set(), occurrences = new Map(), sources = new Map(), code = {};
  for (const page of pages) {
    if (!/^[a-zA-Z0-9_]+$/.test(page.key)) fail(`Invalid page key ${page.key}`);
    if (byKey.has(page.key)) fail(`Duplicate page ${page.key}`);
    byKey.set(page.key,page);
    if (page.nodes.filter(n=>!['ext','port'].includes(n.kind)).length<3) fail(`${page.key}: fewer than three operation/state nodes`);
    const ids = new Set();
    for (const node of page.nodes) {
      if (ids.has(node.id)) fail(`${page.key}: duplicate node ${node.id}`);
      ids.add(node.id);
      if (!node.label || node.label.length>38) fail(`${page.key}/${node.id}: use a short operation label (38 characters maximum)`);
      if (node.num) {
        if (!/^\d+(?:\.\d+)*$/.test(node.num)) fail(`${page.key}: invalid address ${node.num}`);
        if (addresses.has(node.num)) fail(`Duplicate address ${node.num}`);
        addresses.add(node.num);
      } else if (!['ext','port'].includes(node.kind)) fail(`${page.key}/${node.id}: missing address`);
      if (node.target.startsWith('>')) node.explodes=node.target.slice(1);
      else if (node.target.startsWith('$')) {
        node.component=node.target.slice(1);
        const contract=contracts.get(node.component);
        if (!contract) fail(`Unknown component ${node.component}`);
        node.anchor=contract.anchor;node.contract=contract;
      } else if (node.target.startsWith('@')) node.anchor=node.target.slice(1);
      else if (!['ext','port'].includes(node.kind)) fail(`${page.key}/${node.id}: missing code or child target`);
      if (node.anchor) {
        const path=node.anchor.split('::')[0];
        if (!/^(core|studio)\/.+\.mjs$/.test(path) || path.split('/').includes('..')) fail(`Map anchor outside core/Studio: ${node.anchor}`);
        if (!sources.has(path)) sources.set(path,declarations(await readFile(resolve(repo,path),'utf8'),path));
        const block=sources.get(path).get(node.anchor);
        if (!block) fail(`Missing or ambiguous declaration: ${node.anchor}`);
        node.anchor_ref=`${path}:${block.a}-${block.b}`;
        node.foot=`${path.split('/').at(-1)}:${block.a}-${block.b}`;
        node.src=path;node.line=block.a;code[node.anchor_ref]=block;
        const uses=occurrences.get(node.anchor)??[];uses.push({page:page.key,node});occurrences.set(node.anchor,uses);
      }
    }
    for (const edge of page.edges) {
      if (!ids.has(edge.src)||!ids.has(edge.dst)) fail(`${page.key}: dangling wire ${edge.src} > ${edge.dst}`);
      if (!['data','gate','io'].includes(edge.kind)) fail(`${page.key}: invalid edge kind ${edge.kind}`);
    }
    for (const node of page.nodes) if (!page.edges.some(e=>e.src===node.id||e.dst===node.id)) fail(`${page.key}: disconnected ${node.id}`);
  }
  const equalSet=(a,b)=>JSON.stringify([...new Set(a)].sort())===JSON.stringify([...new Set(b)].sort());
  for (const page of pages) {
    for (const node of page.nodes) if (node.explodes) {
      const child=byKey.get(node.explodes);
      if (!child || child.parent?.[0]!==page.key || child.parent?.[1]!==node.id) fail(`${page.key}/${node.id}: child/parent mismatch`);
      const incoming=page.edges.filter(e=>e.dst===node.id).map(e=>e.label);
      const outgoing=page.edges.filter(e=>e.src===node.id).map(e=>e.label);
      if (!equalSet(incoming,child.inputs)||!equalSet(outgoing,child.outputs)) fail(`${child.key}: parent boundary mismatch: expected in ${JSON.stringify(incoming)} out ${JSON.stringify(outgoing)}`);
    }
    if (page.parent && !byKey.get(page.parent[0])?.nodes.some(n=>n.id===page.parent[1]&&n.explodes===page.key)) fail(`${page.key}: orphan parent`);
    for (const [labels,direction] of [[page.inputs,'src'],[page.outputs,'dst']]) for (const label of labels) {
      if (!page.nodes.some(n=>n.kind==='port'&&n.label===label&&page.edges.some(e=>e[direction]===n.id))) fail(`${page.key}: missing ${direction==='src'?'input':'output'} port ${label}`);
    }
    for(const node of page.nodes.filter(n=>n.kind==='port')) {
      if(page.edges.some(e=>e.src===node.id)&&!page.inputs.includes(node.label)) fail(`${page.key}: undeclared input ${node.label}`);
      if(page.edges.some(e=>e.dst===node.id)&&!page.outputs.includes(node.label)) fail(`${page.key}: undeclared output ${node.label}`);
    }
  }
  const reached=new Set();
  function visit(key, stack=[]) {
    if(stack.includes(key)) fail(`Map hierarchy cycle: ${[...stack,key].join(' > ')}`);
    const page=byKey.get(key);if(!page)fail(`Missing ${key}`);
    reached.add(key);for(const n of page.nodes)if(n.explodes)visit(n.explodes,[...stack,key]);
  }
  visit('0_system');
  if (reached.size!==pages.length) fail(`Unreachable pages: ${pages.filter(p=>!reached.has(p.key)).map(p=>p.key).join(', ')}`);
  for (const [anchor,uses] of occurrences) {
    if (uses.length>1 && (!uses[0].node.component || uses.some(use=>use.node.component!==uses[0].node.component))) fail(`Repeated anchor requires one shared component contract: ${anchor}`);
    for (const use of uses) use.node.shared=uses.filter(other=>other!==use).map(other=>({page:other.page,address:other.node.num}));
  }
  return {pages,contracts:[...contracts.values()],specs,code};
}

export function regionContext(model, key) {
  const page=model.pages.find(p=>p.key===key), source=page?.source??Object.keys(model.specs).find(s=>s===key||s.endsWith('/'+key));
  if (!source) fail(`Unknown map ${key}; choose ${model.pages.map(p=>p.key).join(', ')}`);
  const pages=model.pages.filter(p=>p.source===source);
  const used=new Set(pages.flatMap(p=>p.nodes.map(n=>n.component)).filter(Boolean));
  return {source,prose:model.specs[source],components:model.contracts.filter(c=>used.has(c.id)),
    pages:pages.map(p=>({...p,nodes:p.nodes.map(({contract,...node})=>node)}))};
}
