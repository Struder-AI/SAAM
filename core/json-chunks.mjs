// Pure bounded JSON/text encoding. File creation and artifact lifetime belong
// to the consuming persistence/capture owner, never to this encoder.
// Split before a high surrogate so JSON escaping and UTF-8 encoding agree.
export function* stringPieces(value,size=8192){
  for(let start=0;start<value.length;){let end=Math.min(value.length,start+size);
    if(end<value.length&&value.charCodeAt(end-1)>=0xd800&&value.charCodeAt(end-1)<=0xdbff)end--;
    if(end===start)end++;yield value.slice(start,end);start=end;}
}
export function* jsonChunks(value){
  if(typeof value==='string'){
    yield '"';for(const piece of stringPieces(value))yield JSON.stringify(piece).slice(1,-1);yield '"';return;
  }
  if(value===null||typeof value!=='object'){yield JSON.stringify(value);return;}
  if(Array.isArray(value)){
    yield '[';for(let i=0;i<value.length;i++){if(i)yield ',';yield* jsonChunks(value[i]);}yield ']';return;
  }
  yield '{';let first=true;
  for(const key of Object.keys(value)){if(!first)yield ',';first=false;yield* jsonChunks(key);yield ':';yield* jsonChunks(value[key]);}
  yield '}';
}
export function* textChunks(value){for(const piece of stringPieces(value))yield piece;}
