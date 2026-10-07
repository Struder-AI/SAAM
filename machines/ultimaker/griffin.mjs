const requireThat=(condition,message)=>{if(!condition)throw Error(message);};
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
// The Griffin adapter (UltiMaker S5); it has no installation block.
export const createAdapter=Export=>({output:'griffin-gcode',poses:false,
  settings:{validate:({setup})=>requireThat(/^[a-f0-9-]{36}$/i.test(setup.materialGuid),'A material GUID is required for Griffin.')},
  export:(prepared,settings)=>exportGriffin(prepared,settings,settings.machine,settings.release,Export)});
// Writes a prepared path. The header's estimates are the path's; the report's
// are the written commands'.
function exportGriffin(path,plan,machine,{generatorVersion,buildDate},Export) {
  const {lines:motionLines,tally}=Export.gcodeMotion(path,plan),fmt=n=>String(Export.number(n));
  requireThat(machine.outputs.some(o=>o.id===plan.output && o.flavor==='Griffin'),'Machine does not declare Griffin export.');
  const s=plan.setup, area=Math.PI*(s.filamentMm/2)**2, tool=s.tool;
  const startupZ=machine.startup.zAfterStartupMm;
  requireThat(Number.isFinite(startupZ), 'Machine startup Z is required.');
  const points=[path.initialPosition,...path.actions.filter(a=>a.kind==='move').map(a=>a.to)];
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const point of points)for(let i=0;i<3;i++){min[i]=Math.min(min[i],point[i]);max[i]=Math.max(max[i],point[i]);}
  const volume=path.actions.reduce((v,a)=>v+(a.volumeMm3??0),0);
  let time=0,pos=path.initialPosition;
  for(const a of path.actions) {
    if(a.kind==='move'){time+=distance(pos,a.to)/a.speedMmS;pos=a.to;}
    if(a.kind==='dwell')time+=a.seconds;
    if(a.kind==='extrude')time+=a.volumeMm3/a.flowMm3S;
    if(a.filamentMm)time+=a.filamentMm/a.speedMmS;
  }
  const envelope=machine.outputs.find(o=>o.id===plan.output).program;
  requireThat(envelope, 'Machine snapshot has no program templates; recreate this print from the current machine profile.');
  const values={...s,tool,generatorVersion,buildDate,volume:Math.ceil(volume),seconds:Math.ceil(time),startupZ:fmt(startupZ)};
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
  return {bytes:lines.join('\n')+'\n',report:{seconds:tally.seconds,volumeMm3:tally.volumeMm3,
    notice:'Firmware startup and heating time are not simulated; this export does not request routine bed leveling.'}};
}
