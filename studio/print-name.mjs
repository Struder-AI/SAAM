export {printName} from '../core/print/view-values.mjs';
const NAME_CHARACTERS=120;
// A file-system-safe stem: reserved characters become '-', trailing dots and spaces go.
const safeStem=name=>name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').replace(/[. ]+$/,'');
export function downloadName(name,exportName){const extension=exportName?.endsWith('.gcode.3mf')?'.gcode.3mf':exportName?'.'+exportName.split('.').pop():'';return safeStem(name)+extension;}
// The requested name shortened to 120 characters; an empty one is the print's own.
export function requestedDownloadName(value,suggested,exportName){
  const requested=safeStem([...(typeof value==='string'?value.trim():'')].slice(0,NAME_CHARACTERS).join(''));
  return downloadName(requested||suggested,exportName);
}
