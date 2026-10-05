// Studio colours SAAMpath moves by phase. This default palette names every
// phase the generator and exporters emit; a print's choice (bundle field
// `phaseColours`) and the home's local preference (`local/phase-colours.json`)
// override it, the print first. Colours never enter recipe, path or program identity.
// Deposition hues were checked on Studio's background (#eaf0e0-#f8faf1): contrast
// >= 3:1 and all-pairs OKLab dE >= 8 under protan/deutan simulation. Travel is
// a neutral thin line, so width also separates it.
const body='#3e8cc9',surface='#c65b19',service='#802e53';
export const DEFAULT_PHASE_COLOURS=Object.freeze({
  travel:'#7a7a7a',deposition:body,modulated:'#8244ba',
  planar:body,spiral:body,study:body,'plastic-weld':body,
  curves:surface,'vase-wall':surface,'segmented-paths':surface,inject:surface,
  supports:'#0c7b60',
  prime:service,start:service,startup:service,finish:service
});

// A partial {phase: '#rrggbb'} record; null when empty.
export function checkedPhaseColours(value,source='phaseColours'){
  if(value===null||value===undefined)return null;
  const fail=message=>{throw TypeError(`${source}: ${message}`);};
  if(typeof value!=='object'||Array.isArray(value))fail('map phase names to #rrggbb colours.');
  const entries=Object.entries(value);
  for(const [phase,colour] of entries){
    if(!Object.hasOwn(DEFAULT_PHASE_COLOURS,phase))fail(`unknown phase "${phase}"; use ${Object.keys(DEFAULT_PHASE_COLOURS).join(', ')}.`);
    if(typeof colour!=='string'||!/^#[0-9a-f]{6}$/i.test(colour))fail(`${phase} needs a #rrggbb colour.`);
  }
  return entries.length?Object.fromEntries(entries.map(([phase,colour])=>[phase,colour.toLowerCase()])):null;
}

export const resolvePhaseColours=(print,local)=>({...DEFAULT_PHASE_COLOURS,...local,...print});

// Travel, then modulation, then the move's phase; unlisted phases are deposition.
export function phaseColour(palette,move){
  if(!move.extruding)return palette.travel;
  if(move.modulated)return palette.modulated;
  return Object.hasOwn(palette,move.phase)?palette[move.phase]:palette.deposition;
}
