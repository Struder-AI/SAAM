// Studio colours SAAMpath moves by phase. This default palette names every
// phase the generator and exporters emit; a print's choice (bundle field
// `phaseColours`) and the home's local preference (`local/phase-colours.json`)
// override it, the print first. Colours never enter recipe, path or program identity.
// The defaults are Studio's colours before 0.3.3 (owner, 2026-10-06): sky blue
// body, orange vase walls, lavender modulation, rust injection markers.
const skyBlue='#5b9fd3',orange='#c65b19';
export const DEFAULT_PHASE_COLOURS=Object.freeze({
  travel:'#657fa3',deposition:skyBlue,modulated:'#a799dc',
  planar:skyBlue,spiral:skyBlue,study:skyBlue,'plastic-weld':skyBlue,curves:skyBlue,supports:skyBlue,
  'vase-wall':orange,'segmented-paths':orange,inject:'#b85c28',
  prime:'#5b92a3',start:skyBlue,startup:skyBlue,finish:skyBlue
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
