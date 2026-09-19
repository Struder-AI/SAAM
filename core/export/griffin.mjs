import { distance, requireThat } from '../geom/tolerance.mjs';
import {gcodeLines} from './gcode-lines.mjs';
import {toolBounds,startupRetracted} from '../machine/rules.mjs';
import {plannedNozzleTemperatures,validateNozzleC} from '../path/process-controls.mjs';
const number = (v,min,max,name) => requireThat(Number.isFinite(v) && v>=min && v<=max, `${name} outside limits.`);
// One G4 carries at most this many milliseconds; it is what the firmware reads
// from a single command, not a limit on how long a path may pause.
const DWELL_COMMAND_MS=60000;

const fmt=(n,d=5)=>Number(n.toFixed(d)).toString();
export function exportGriffin(path,plan,machine,{generatorVersion,buildDate}) {
  const motionLines=exportMotion(path,plan);
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

// The same volumetric SAAMpath actions and rounding rules feed every dialect.
export function exportMotion(path,plan,{extrusionMode='absolute'}={}) {
  validatePath(path);
  requireThat(['absolute','relative'].includes(extrusionMode),'Unsupported extrusion mode.');
  const relativeE=extrusionMode==='relative';
  const lines=[],area=Math.PI*(plan.setup.filamentMm/2)**2;
  let e=0,tag='',operation='',writtenE=0,writtenPosition=[...path.initialPosition];
  // This body is also embedded in machine templates. Establish XYZ and feed on
  // its first use, then rely only on modal state written by this exporter.
  const modal={};
  const field=(key,value)=>{
    // Preserve the old writer's treatment of non-decimal representations.
    // Supported machine coordinates/feed use ordinary decimal notation.
    if(!Number.isFinite(value)||Math.abs(value)>=1e21)return ` ${key}${value}`;
    if(modal[key]===value)return '';
    modal[key]=value;return ` ${key}${value}`;
  };
  const motion=(command,target,extrusion,feed)=>{
    let line=command;
    if(target)for(let i=0;i<3;i++)line+=field('XYZ'[i],target[i]);
    if(extrusion!==undefined)line+=` E${extrusion}`;
    line+=field('F',Number(feed.toFixed(3)));
    lines.push(line);
  };
  for(const a of path.actions) {
    if((a.operation??'')!==operation){operation=a.operation??'';requireThat(!/[\r\n]/.test(operation),'Invalid operation label.');lines.push(`;SAAM_OPERATION:${operation}`);}
    const nextTag=`${a.phase}:${a.layer}`;
    if(tag!==nextTag){lines.push(`;SAAM_PHASE:${a.phase}`,`;LAYER:${a.layer}`);tag=nextTag;}
    if(a.kind==='move') {
      // Quantize once: command text, flow calculation and following position
      // must all use these same written coordinates and extrusion value.
      const target=a.to.map(v=>Number(v.toFixed(5)));
      if(a.volumeMm3>0){
        const filamentMm=a.volumeMm3/area;
        if(!relativeE)e+=filamentMm;
        const nextE=Number((relativeE?filamentMm:e).toFixed(5));
        const length=distance(writtenPosition,target),de=relativeE?nextE:nextE-writtenE;
        requireThat(length>0, 'A deposition move collapsed at export precision.');
        // Quantized E and XYZ must still obey the locked flow limit, including
        // very short section segments. Check the actual written command.
        const speed=Math.min(a.speedMmS,de>0?plan.process.maxFlowMm3S*length/(de*area):a.speedMmS);
        const feed=Math.floor(speed*60*1000)/1000;
        requireThat(feed>0,'Deposition feed collapsed at export precision.');
        motion('G1',target,nextE,feed);
        if(!relativeE)writtenE=nextE;
      }
      else motion('G0',target,undefined,a.speedMmS*60);
      writtenPosition=target;
    } else if(a.kind==='extrude') {
      const filamentMm=a.volumeMm3/area;
      if(!relativeE)e+=filamentMm;
      const nextE=Number((relativeE?filamentMm:e).toFixed(5));
      const de=relativeE?nextE:nextE-writtenE;
      requireThat(de>0,'Stationary extrusion collapsed at export precision.');
      const feed=Math.floor(Math.min(a.flowMm3S,plan.process.maxFlowMm3S)/area*60*1000)/1000;
      requireThat(feed>0,'Stationary extrusion feed collapsed at export precision.');
      motion('G1',null,nextE,feed);
      if(!relativeE)writtenE=nextE;
    } else if(a.kind==='temperature') {
      requireThat(plannedNozzleTemperatures(plan).has(a.targetC),'Unplanned operation temperature.');
      lines.push(`M400`,`M109 S${fmt(a.targetC)}`);
    } else if(a.kind==='retract'||a.kind==='recover') {
      const filamentMm=(a.kind==='retract'?-1:1)*a.filamentMm;
      if(!relativeE)e+=filamentMm;
      const nextE=Number((relativeE?filamentMm:e).toFixed(5));
      motion('G1',null,nextE,a.speedMmS*60);
      if(!relativeE)writtenE=nextE;
    } else if(a.kind==='fan') lines.push(a.percent===0?'M107':`M106 S${Math.round(a.percent*255/100)}`);
    else if(a.kind==='dwell'){
      // A longer pause is the same pause in commands the firmware accepts; the
      // parts sum to the requested milliseconds, so the wait is not shortened.
      let remaining=Math.ceil(a.seconds*1000);
      do{const part=Math.min(remaining,DWELL_COMMAND_MS);lines.push(`G4 P${part}`);remaining-=part;}while(remaining>0);
    }
    else throw new Error(`Unsupported SAAMpath action: ${a.kind}`);
  }
  return lines;
}

// A strict interpreter for the exported subset. Geometry is reconstructed from
// G-code coordinates and modal state, never from SAAMpath/display annotations.
export const interpretGriffin=(text,plan,machine,options={})=>interpretGcode(text,plan,machine,false,'absolute',options);
// Body-only interpretation starts after a dialect's checked firmware envelope.
// It still requires explicit units, modes, tool and temperature waits. This is
// the same modal engine as Griffin, without inventing a Griffin header.
export const interpretMotion=(text,plan,machine,{extrusionMode='absolute',...options}={})=>interpretGcode(text,plan,machine,true,extrusionMode,options);
function interpretGcode(text,plan,machine,bodyOnly=false,extrusionMode='absolute',{moves=[]}={}) {
  const bounds=toolBounds(machine,plan.setup.tool);
  requireThat(['absolute','relative'].includes(extrusionMode),'Unsupported extrusion mode.');
  const s=plan.setup, area=Math.PI*(s.filamentMm/2)**2;
  // Withdrawn filament that has not been recovered. The material profile states
  // how far this feeder may withdraw; the plan's own retraction is never more.
  const maxWithdrawalMm=Math.max(machine.materials?.[s.material]?.maxRetractMm??0,plan.process.retractMm);
  const temperatures=plannedNozzleTemperatures(plan);
  for(const target of temperatures)validateNozzleC(target,plan,machine);
  const startupZ=machine.startup.zAfterStartupMm;
  requireThat(Number.isFinite(startupZ), 'Machine startup Z is required.');
  let pos=[...machine.tools[s.tool].startupXY,startupZ],e=0,feed=0,absolute=null,absE=null,metric=false;
  let tool=bodyOnly?s.tool:null,nozzle=0,bed=0,hot=false,bedReady=false,fan=0,debt=0,startupRecoveryPending=startupRetracted(machine,plan),phase='startup',layer=-1,time=0,volume=0,operation='';
  const events=[],header={};
  let extrusionMoves=0;
  const motionMin=[Infinity,Infinity,Infinity],motionMax=[-Infinity,-Infinity,-Infinity];
  let inHeader=false,endedHeader=bodyOnly;
  const tokens=/([A-Z])([+-]?(?:\d+(?:\.\d*)?|\.\d+))/g;
  let line=0;
  for(const raw of gcodeLines(text)) {
    line++;
    const trim=raw.trim();
    if(trim===';START_OF_HEADER'){requireThat(!inHeader&&!endedHeader&&line===1,'Malformed Griffin header.');inHeader=true;continue;}
    if(trim===';END_OF_HEADER'){requireThat(inHeader,'Malformed Griffin header.');inHeader=false;endedHeader=true;continue;}
    if(inHeader) {
      const m=trim.match(/^;([^:]+):(.*)$/);requireThat(m&&!Object.hasOwn(header,m[1]),`Invalid header at line ${line}.`);header[m[1]]=m[2];continue;
    }
    if(trim.startsWith(';SAAM_PHASE:'))phase=trim.slice(12);
    if(trim.startsWith(';LAYER:'))layer=Number(trim.slice(7));
    if(trim.startsWith(';SAAM_OPERATION:'))operation=trim.slice(16);
    const comment=trim.indexOf(';'),code=comment<0?trim:trim.slice(0,comment).trim();if(!code)continue;
    requireThat(endedHeader,`Command before Griffin header at line ${line}.`);
    // Parse once, checking the gaps as we go. Collecting all regex matches and
    // stripping them in a second pass allocated several arrays per move.
    tokens.lastIndex=0;
    let token=tokens.exec(code);
    requireThat(token&&code.slice(0,token.index).trim()==='',`Malformed command at line ${line}.`);
    const command=token[1]+token[2],args={};let end=tokens.lastIndex;
    while((token=tokens.exec(code))){
      requireThat(code.slice(end,token.index).trim()==='',`Malformed command at line ${line}.`);
      requireThat(!Object.hasOwn(args,token[1]),`Duplicate argument at line ${line}.`);
      args[token[1]]=Number(token[2]);end=tokens.lastIndex;
    }
    requireThat(code.slice(end).trim()==='',`Malformed command at line ${line}.`);
    const only=(allowed,required='')=>{
      requireThat(Object.keys(args).every(k=>allowed.includes(k))&&[...required].every(k=>Object.hasOwn(args,k)),`Unsupported arguments for ${command} at line ${line}.`);
      requireThat(Object.values(args).every(Number.isFinite),`Nonfinite argument at line ${line}.`);
    };
    switch(command) {
      case 'G21':only('');metric=true;break;
      case 'G90':only('');absolute=true;break;
      case 'G91':only('');absolute=false;break;
      case 'M82':only('');absE=true;break;
      case 'M83':only('');absE=false;break;
      case 'T0':case 'T1':only('');requireThat(Number(command[1])===s.tool,'Unexpected tool change.');tool=Number(command[1]);break;
      case 'M190':case 'M140':
        only('S','S');number(args.S,...machine.temperatureLimitsC.bed,'Bed temperature');bed=args.S;bedReady=command==='M190';events.push({line,kind:'bed',target:bed,wait:bedReady});break;
      case 'M109':case 'M104':
        only('ST','S');requireThat(args.T===undefined||args.T===s.tool,'Temperature addressed to unexpected tool.');
        requireThat(args.S===0||(args.S>=machine.temperatureLimitsC.nozzle[0]&&args.S<=machine.temperatureLimitsC.nozzle[1]),'Nozzle temperature outside limits.');
        nozzle=args.S;hot=command==='M109';events.push({line,kind:'nozzle',target:nozzle,wait:hot});break;
      case 'G92':only('E','E');e=args.E;break;
      case 'M106':only('S','S');number(args.S,0,255,'Fan');fan=args.S;events.push({line,kind:'fan',value:fan});break;
      case 'M107':only('');fan=0;events.push({line,kind:'fan',value:fan});break;
      case 'M400':only('');events.push({line,kind:'synchronize'});break;
      case 'G4':only('P','P');number(args.P,0,DWELL_COMMAND_MS,'Dwell milliseconds');events.push({line,kind:'dwell',seconds:args.P/1000,startSeconds:time});time+=args.P/1000;break;
      case 'G0':case 'G1': {
        only('XYZEF');requireThat(Object.keys(args).length>0,'Empty move.');
        requireThat(metric&&absolute!==null&&absE!==null&&tool===s.tool&&hot&&bedReady,'Unknown initial motion state.');
        if(args.F!==undefined){requireThat(args.F>0,'Feed must be positive.');feed=args.F/60;}
        requireThat(feed>0,'Move has no feed.');
        const next=pos.map((v,i)=>args['XYZ'[i]]===undefined?v:(absolute?args['XYZ'[i]]:v+args['XYZ'[i]]));
        for(let i=0;i<3;i++)requireThat(next[i]>=bounds.min[i]-1e-5&&next[i]<=bounds.max[i]+1e-5,`Out-of-bounds ${'XYZ'[i]} move at line ${line} (selected tool bounds).`);
        const length=distance(pos,next),nextE=args.E===undefined?e:(absE?args.E:e+args.E),de=nextE-e;
        if(length>1e-9) {
          const duration=length/feed;
          for(let i=0;i<3;i++)requireThat(Math.abs(next[i]-pos[i])/duration<=machine.maxFeedMmS['xyz'[i]]+0.002,`Axis speed exceeds limit at line ${line}.`);
          requireThat(Math.abs(de)/duration<=machine.maxFeedMmS.e+0.002,`Extruder speed exceeds limit at line ${line}.`);
          requireThat(de>=-1e-8,'Moving retractions are outside this demo subset.');
          if(de>1e-8){requireThat(hot&&bedReady&&temperatures.has(nozzle)&&bed===s.bedC,'Extrusion without the planned temperature waits.');requireThat(debt<1e-4,'Extrusion while retracted.');}
          const v=Math.max(0,de)*area;
          requireThat(v/duration<=plan.process.maxFlowMm3S+0.03,`Flow exceeds locked limit at line ${line}.`);
          moves.push({line,from:[...pos],to:next,extruding:de>1e-8,volumeMm3:v,speedMmS:feed,phase,layer,operation,fan,startSeconds:time,durationSeconds:duration});
          if(de>1e-8)extrusionMoves++;
          for(let i=0;i<3;i++){motionMin[i]=Math.min(motionMin[i],pos[i],next[i]);motionMax[i]=Math.max(motionMax[i],pos[i],next[i]);}
          volume+=v;time+=duration;
        } else if(Math.abs(de)>1e-9) {
          requireThat(feed<=machine.maxFeedMmS.e,'Stationary extrusion speed exceeds limit.');
          let startupRecovery=false;
          if(de<0)debt-=de;
          else if(debt>0){requireThat(de<=debt+1e-4,'Unexpected stationary extrusion.');debt=Math.max(0,debt-de);}
          else if(startupRecoveryPending){requireThat(de<=plan.process.retractMm+1e-4,'Unexpected stationary extrusion.');startupRecovery=true;startupRecoveryPending=false;}
          else {
            requireThat(hot&&bedReady&&temperatures.has(nozzle)&&bed===s.bedC,'Stationary extrusion without planned temperature waits.');
            const seconds=de/feed,v=de*area;
            requireThat(v/seconds<=plan.process.maxFlowMm3S+0.003,'Stationary extrusion exceeds locked material flow.');
            moves.push({line,from:[...pos],to:[...pos],extruding:true,volumeMm3:v,speedMmS:0,phase,layer,operation,fan,startSeconds:time,durationSeconds:seconds});
            events.push({line,kind:'injection',positionMm:[...pos],volumeMm3:v,nozzleC:nozzle,phase,layer,operation,startSeconds:time,seconds});
            volume+=v;time+=seconds;extrusionMoves++;
            for(let i=0;i<3;i++){motionMin[i]=Math.min(motionMin[i],pos[i]);motionMax[i]=Math.max(motionMax[i],pos[i]);}
            pos=next;e=nextE;
            break;
          }
          requireThat(debt<=maxWithdrawalMm+1e-3,`Retraction beyond the ${fmt(maxWithdrawalMm,3)} mm this material and plan allow.`);
          events.push({line,kind:de<0?'retract':startupRecovery?'startup-recover':'recover',filamentMm:Math.abs(de),startSeconds:time,seconds:Math.abs(de)/feed});time+=Math.abs(de)/feed;
        }
        pos=next;e=nextE;break;
      }
      default:throw new Error(`Unsupported command ${command} at line ${line}.`);
    }
  }
  if(!bodyOnly) {
  requireThat(!inHeader&&endedHeader&&header.FLAVOR==='Griffin'&&header['HEADER_VERSION']==='0.1'&&header['TARGET_MACHINE.NAME']==='Ultimaker S5','Invalid Griffin target/header.');
  // libCharon's Griffin reader requires all three generator fields before a
  // USB file can be selected. Motion round trips alone cannot catch omissions.
  for(const key of ['GENERATOR.NAME','GENERATOR.VERSION','GENERATOR.BUILD_DATE'])requireThat(header[key]?.trim(),`${key} must be set in the Griffin header.`);
  requireThat(/^\d{4}-\d{2}-\d{2}$/.test(header['GENERATOR.BUILD_DATE'])&&Number.isFinite(Date.parse(header['GENERATOR.BUILD_DATE'])),'Invalid generator build date.');
  requireThat(/^\d+$/.test(header['PRINT.TIME'])&&Number.isSafeInteger(Number(header['PRINT.TIME'])),'PRINT.TIME must be a nonnegative integer.');
  requireThat(Number(header[`EXTRUDER_TRAIN.${s.tool}.INITIAL_TEMPERATURE`])===s.nozzleC&&Number(header[`EXTRUDER_TRAIN.${s.tool}.NOZZLE.DIAMETER`])===s.nozzleMm&&header[`EXTRUDER_TRAIN.${s.tool}.NOZZLE.NAME`]===s.core,'Header does not match installed setup.');
  requireThat(Number(header['BUILD_PLATE.INITIAL_TEMPERATURE'])===s.bedC,'Header bed temperature mismatch.');
  requireThat(header['BUILD_VOLUME.TEMPERATURE']?.trim()&&Number(header['BUILD_VOLUME.TEMPERATURE'])===s.buildVolumeC,'Missing or mismatched BUILD_VOLUME.TEMPERATURE in S5 header.');
  requireThat(header[`EXTRUDER_TRAIN.${s.tool}.MATERIAL.GUID`]===s.materialGuid,'Missing or mismatched MATERIAL.GUID in S5 header.');
  requireThat(extrusionMoves>0&&nozzle===0&&bed===0&&fan===0,'Missing deposition or shutdown.');
  for(const [i,axis]of ['X','Y','Z'].entries()) {
    const lo=Number(header[`PRINT.SIZE.MIN.${axis}`]),hi=Number(header[`PRINT.SIZE.MAX.${axis}`]);
    requireThat(Number.isFinite(lo)&&Number.isFinite(hi)&&lo<=hi,'Missing/invalid header bounds.');
    requireThat(motionMin[i]>=lo-1e-4&&motionMax[i]<=hi+1e-4,'Moves exceed header bounds.');
  }
  requireThat(Math.abs(Number(header[`EXTRUDER_TRAIN.${s.tool}.MATERIAL.VOLUME_USED`])-volume)<1.1,'Header material volume mismatch.');
  } else requireThat(extrusionMoves>0&&metric&&absolute===true&&absE===(extrusionMode==='absolute')&&hot&&bedReady&&nozzle===s.nozzleC&&bed===s.bedC,'Invalid body or terminal machine state.');
  return {moves,events,header,seconds:time,volumeMm3:volume,finalPosition:pos,summary:{moves:moves.length,extrusionMoves,
    volumeMm3:volume,filamentMm:volume/area,motionSeconds:time,
    startup:'Firmware startup and heating time are not simulated; this export does not request routine bed leveling.',clearance:'Operator responsibility; not checked.'}};
}

export function validatePath(path) {
  const point=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
  requireThat(path?.schema==='saampath/1'&&point(path.initialPosition)&&Array.isArray(path.actions), 'Invalid SAAMpath or initial position.');
  for(const a of path.actions) {
    requireThat(typeof a.phase==='string'&&!/[\r\n]/.test(a.phase)&&Number.isFinite(a.layer),'Invalid SAAMpath context.');
    if(a.kind==='move') requireThat(point(a.to)&&Number.isFinite(a.speedMmS)&&a.speedMmS>0&&Number.isFinite(a.volumeMm3)&&a.volumeMm3>=0, 'Invalid SAAMpath move.');
    else if(a.kind==='retract'||a.kind==='recover') requireThat(Number.isFinite(a.filamentMm)&&a.filamentMm>=0&&Number.isFinite(a.speedMmS)&&a.speedMmS>0, 'Invalid filament action.');
    else if(a.kind==='extrude')requireThat(Number.isFinite(a.volumeMm3)&&a.volumeMm3>0&&Number.isFinite(a.flowMm3S)&&a.flowMm3S>0,'Invalid stationary deposition.');
    else if(a.kind==='temperature')requireThat(Number.isFinite(a.targetC)&&a.targetC>0,'Invalid nozzle temperature.');
    else if(a.kind==='fan') number(a.percent,0,100,'Fan');
    else if(a.kind==='dwell') requireThat(Number.isFinite(a.seconds)&&a.seconds>=0,'Dwell outside limits.');
    else throw new Error('Unsupported SAAMpath action: '+a.kind);
  }
}
