// External facts: the only authored rows the map carries. Code cannot state a measured number,
// a vendor's behaviour or a recorded decision, so those are read from `dev-map/facts.tsv` and
// attached to the page of the declaration or file they are about. Nothing else here is authored:
// a row names an existing declaration or it is reported as an orphan, never dropped.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

export const factsPath='dev-map/facts.tsv';
export const COLUMNS=['declaration','kind','fact','source','date'];
export const KINDS=['measurement','vendor','decision'];
const HEADER=COLUMNS.join('\t');

const anchor=title=>title.toLowerCase().replace(/<[^>]*>/g,'').replace(/[^\p{L}\p{N}_\-\s]/gu,'').replace(/\s/g,'-');

// The anchors a `decision` row may cite: the headings of DECISIONS.md, by the same rule the
// repository's own link checking uses.
export async function decisionAnchors(repo) {
  const text=await readFile(resolve(repo,'DECISIONS.md'),'utf8').catch(()=>null);
  if(text===null)return null;
  const found=new Set(),counts=new Map();
  let fenced=false;
  for(const line of text.split(/\r?\n/)) {
    if(/^\s*(```|~~~)/.test(line)){fenced=!fenced;continue;}
    if(fenced)continue;
    const heading=/^#{1,6}\s+(.+?)(?:\s+#+)?$/.exec(line);
    if(!heading)continue;
    const base=anchor(heading[1]),count=counts.get(base)??0;
    counts.set(base,count+1);found.add(count?`${base}-${count}`:base);
  }
  return found;
}

// Every row of the file, with the rows that cannot be used named by line and content.
export async function readFacts({repo,readSource=file=>readFile(resolve(repo,file),'utf8')}={}) {
  const text=await Promise.resolve(readSource(factsPath)).catch(error=>{
    if(error.code==='ENOENT')return null;throw error;});
  if(text===null||text===undefined)return {present:false,rows:[],errors:[{line:0,row:'',reason:`Missing ${factsPath}.`}]};
  const anchors=await decisionAnchors(repo);
  const lines=text.split(/\r?\n/),rows=[],errors=[];
  const bad=(line,row,reason)=>errors.push({line,row,reason});
  if(lines[0]?.replace(/\r$/,'')!==HEADER)bad(1,lines[0]??'',`First row must be the header ${COLUMNS.join(', ')}.`);
  for(let i=1;i<lines.length;i++) {
    const raw=lines[i];
    if(!raw.trim())continue;
    const cells=raw.split('\t');
    if(cells.length!==COLUMNS.length){bad(i+1,raw,`${cells.length} tab-separated fields; ${COLUMNS.length} are required.`);continue;}
    const [declaration,kind,fact,source,date]=cells.map(c=>c.trim());
    const empty=COLUMNS.filter((name,at)=>![declaration,kind,fact,source,date][at]);
    if(empty.length){bad(i+1,raw,`Empty ${empty.join(', ')}.`);continue;}
    if(!KINDS.includes(kind)){bad(i+1,raw,`Unknown kind ${kind}; use ${KINDS.join(', ')}.`);continue;}
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))){bad(i+1,raw,`Date ${date} is not an ISO date.`);continue;}
    if(kind==='decision'&&anchors&&!anchors.has(source)){bad(i+1,raw,`No DECISIONS.md anchor ${source}.`);continue;}
    if(kind==='decision'&&!anchors){bad(i+1,raw,'DECISIONS.md is unreadable, so no decision anchor can be checked.');continue;}
    rows.push({line:i+1,declaration:declaration.replaceAll('\\','/'),kind,fact,source,date});
  }
  return {present:true,rows,errors};
}

// Rows grouped by what they are about, and the rows that are about nothing the map holds.
export function bindFacts(rows,known) {
  const byTarget=new Map(),orphans=[];
  for(const row of rows) {
    if(!known.has(row.declaration)){orphans.push(row);continue;}
    const {line,declaration,...fact}=row;
    (byTarget.get(declaration)??byTarget.set(declaration,[]).get(declaration)).push(fact);
  }
  return {byTarget,orphans};
}
