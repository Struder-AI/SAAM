import {PROGRAM_DECIMALS} from '../dimensions.mjs';
import {distance,requireThat} from '../private/export/numeric.mjs';
import {prepareExportPath} from './prepare-path.mjs';
import {gcodeMotion} from './gcode-motion.mjs';

const fmt=(n,d=PROGRAM_DECIMALS)=>Number(n.toFixed(d)).toString();
export function exportGriffin(path,plan,machine,{generatorVersion,buildDate}) {
  path=prepareExportPath(path,plan,machine);
  const motionLines=gcodeMotion(path,plan).lines;
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
  return lines.join('\n')+'\n';
}
