import {requireThat} from '../geom/tolerance.mjs';

// Iterate a string or synchronous stream of text chunks without allocating an
// array containing every program line. Chunk boundaries have no modal meaning;
// even CRLF and individual commands can straddle them. Retain only an unfinished
// line. There is no file-size policy here; callers still validate every command.
export function* gcodeLines(source) {
  requireThat(typeof source==='string'||(source!=null&&typeof source[Symbol.iterator]==='function'),
    'G-code must be text or an iterable of text chunks.');
  const chunks=typeof source==='string'?[source]:source;
  let pending=[];
  for(const chunk of chunks) {
    requireThat(typeof chunk==='string','G-code chunks must be text.');
    let start=0,end;
    while((end=chunk.indexOf('\n',start))!==-1) {
      let line;
      if(pending.length){pending.push(chunk.slice(start,end));line=pending.join('');pending=[];}
      else line=chunk.slice(start,end);
      yield line.endsWith('\r')?line.slice(0,-1):line;
      start=end+1;
    }
    if(start<chunk.length)pending.push(chunk.slice(start));
  }
  yield pending.join('');
}
