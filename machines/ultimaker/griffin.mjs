const requireThat=(condition,message)=>{if(!condition)throw Error(message);};
// The Griffin adapter (UltiMaker S5); it has no installation block.
export const createAdapter=Export=>({output:'griffin-gcode',poses:false,
  settings:{validate:({setup})=>requireThat(/^[a-f0-9-]{36}$/i.test(setup.materialGuid),'A material GUID is required for Griffin.')},
  export:(prepared,settings)=>exportGriffin(prepared,settings,settings.machine,settings.release,Export)});
// Header and report use the shared writer's actual command totals.
function exportGriffin(path,plan,machine,{generatorVersion,buildDate},Export) {
  const {lines:motionLines,tally}=Export.gcodeMotion(path,plan),fmt=n=>String(Export.number(n,'xyz'));
  requireThat(machine.outputs.some(o=>o.id===plan.output && o.flavor==='Griffin'),'Machine does not declare Griffin export.');
  const s=plan.setup, tool=s.tool;
  const startupZ=machine.startup.zAfterStartupMm;
  requireThat(Number.isFinite(startupZ), 'Machine startup Z is required.');
  const min=[...path.initialPosition],max=[...path.initialPosition];
  for(const action of path.actions)if(action.kind==='move')for(let i=0;i<3;i++){
    min[i]=Math.min(min[i],action.to[i]);max[i]=Math.max(max[i],action.to[i]);
  }
  const envelope=machine.outputs.find(o=>o.id===plan.output).program;
  requireThat(envelope, 'Neither the print\'s machine snapshot nor the installed profile has Griffin program templates.');
  const values={...s,tool,generatorVersion,buildDate,volume:Math.ceil(tally.volumeMm3),seconds:Math.ceil(tally.seconds),startupZ:fmt(startupZ)};
  for(const [bound,points] of [['min',min],['max',max]]) for(const [i,axis] of ['X','Y','Z'].entries()) values[bound+axis]=fmt(points[i]);
  const render=lines=>{
    requireThat(Array.isArray(lines)&&lines.every(line=>typeof line==='string'&&!/[\r\n]/.test(line)), 'Invalid machine program template.');
    return lines.map(line=>line.replace(/\{([A-Za-z]+)\}/g,(_match,key)=>{
      requireThat(Object.hasOwn(values,key)&&values[key]!==undefined&&values[key]!==null&&!/[\r\n]/.test(String(values[key])), 'Unknown or invalid template value: '+key);
      return String(values[key]);
    }));
  };
  const lines=[...render(envelope.header),...render(envelope.start)];
  // Large paths exceed the engine's argument limit when spread into push().
  for(const line of motionLines)lines.push(line);
  for(const line of render(envelope.end))lines.push(line);
  return {bytes:lines.join('\n')+'\n',report:{seconds:tally.seconds,untimedMoves:tally.untimedMoves,volumeMm3:tally.volumeMm3,collapsedDepositMoves:tally.collapsedDepositMoves,terminalUnwrittenVolumeMm3:tally.terminalUnwrittenVolumeMm3,
    limitations:tally.terminalUnwrittenVolumeMm3>tally.filamentStepVolumeMm3?[`${tally.collapsedDepositMoves} depositing move(s) collapsed at written XYZ precision; ${Number(tally.terminalUnwrittenVolumeMm3.toPrecision(6))} mm³ remained without a later writable deposition.`]:[],
    notice:'Time and material totals cover written motion, including prepared startup travel and priming; firmware startup and heating time are excluded.'}};
}
