// Shared browser/server decoder. This module never imports path generation.
import {distance,requireThat} from '../geom/tolerance.mjs';
import {gcodeLines} from './gcode-lines.mjs';
import {toolBounds,startupRetracted} from '../machine/rules.mjs';
import {plannedNozzleTemperatures,validateNozzleC} from '../path/process-controls.mjs';
const number=(v,min,max,name)=>requireThat(Number.isFinite(v)&&v>=min&&v<=max,`${name} outside limits.`);
const fmt=(n,d=5)=>Number(n.toFixed(d)).toString();
export const DWELL_COMMAND_MS=60000;

// A strict interpreter for the exported subset. Geometry is reconstructed from
// G-code coordinates and modal state, never from SAAMpath/display annotations.
export const interpretGriffin=(text,plan,machine,options={})=>interpretGcode(text,plan,machine,false,'absolute',options);
// Body-only interpretation starts after a dialect's checked firmware envelope.
// It still requires explicit units, modes, tool and temperature waits. This is
// the same modal engine as Griffin, without inventing a Griffin header.
export const interpretMotion=(text,plan,machine,{extrusionMode='absolute',...options}={})=>interpretGcode(text,plan,machine,true,extrusionMode,options);
// A checked dialect may interleave its own firmware service blocks with motion.
// It supplies their validated handoff state, never unchecked G-code annotations.
export function interpretMotionChunk(text,plan,machine,{position,debt=0,fan=0,startupRecoveryPending=false},moves=[]){
  const initial=initializeGcodeInterpretation(plan,machine,true,'relative');
  requireThat(Array.isArray(position)&&position.length===3&&position.every((v,i)=>Number.isFinite(v)&&v>=initial.context.bounds.min[i]&&v<=initial.context.bounds.max[i]),'Invalid motion handoff position.');
  requireThat(Number.isFinite(debt)&&debt>=0&&debt<=initial.context.maxWithdrawalMm,'Invalid motion handoff retraction.');
  initial.state={...initial.state,pos:[...position],debt,fan,startupRecoveryPending};
  const interpreted=interpretGcodeLines(text,initial,moves),s=interpreted.state;
  requireThat(s.metric&&s.absolute===true&&s.absE===false&&s.hot&&s.bedReady&&s.nozzle===plan.setup.nozzleC&&s.bed===plan.setup.bedC,'Invalid motion segment handoff state.');
  return {...gcodeProgram(s,interpreted.source,initial.context,moves,interpreted.events),state:s};
}
function interpretGcode(text,plan,machine,bodyOnly=false,extrusionMode='absolute',{moves=[]}={}) {
  const initial=initializeGcodeInterpretation(plan,machine,bodyOnly,extrusionMode);
  const interpreted=interpretGcodeLines(text,initial,moves);
  const checkedState=validateGcodeCompletion(interpreted.state,interpreted.source,initial.context);
  return gcodeProgram(checkedState,interpreted.source,initial.context,interpreted.moves,interpreted.events);
}

function interpretGcodeLines(text,initial,moves) {
  const context=initial.context,events=[];
  let state=initial.state,source=initial.source,line=0;
  for(const raw of gcodeLines(text)) {
    const parsed=readGcodeLine(raw,++line,source);
    source=parsed.source;
    if(parsed.command) {
      const step=applyGcodeCommand(state,parsed.command,context,source);
      state=step.state;
      for(const move of step.moves)moves.push(move);
      for(const event of step.events)events.push(event);
    }
  }
  return {state,source,moves,events};
}

function initializeGcodeInterpretation(plan,machine,bodyOnly,extrusionMode) {
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
  return {
    context:{plan,machine,bodyOnly,extrusionMode,bounds,s,area,maxWithdrawalMm,temperatures},
    source:{header:{},inHeader:false,endedHeader:bodyOnly,phase:'startup',layer:-1,operation:''},
    state:{pos:[...machine.tools[s.tool].startupXY,startupZ],e:0,feed:0,absolute:null,absE:null,metric:false,
      tool:bodyOnly?s.tool:null,nozzle:0,bed:0,hot:false,bedReady:false,fan:0,debt:0,startupRecoveryPending:startupRetracted(machine,plan),
      time:0,volume:0,extrusionMoves:0,motionMin:[Infinity,Infinity,Infinity],motionMax:[-Infinity,-Infinity,-Infinity]}
  };
}

function readGcodeLine(raw,line,previousSource) {
  let {header,inHeader,endedHeader,phase,layer,operation}=previousSource;
  const trim=raw.trim();
  if(trim===';START_OF_HEADER'){
    requireThat(!inHeader&&!endedHeader&&line===1,'Malformed Griffin header.');
    return {source:{...previousSource,inHeader:true},command:null};
  }
  if(trim===';END_OF_HEADER'){
    requireThat(inHeader,'Malformed Griffin header.');
    return {source:{...previousSource,inHeader:false,endedHeader:true},command:null};
  }
  if(inHeader) {
    const m=trim.match(/^;([^:]+):(.*)$/);requireThat(m&&!Object.hasOwn(header,m[1]),`Invalid header at line ${line}.`);
    const nextHeader={...header};nextHeader[m[1]]=m[2];
    return {source:{...previousSource,header:nextHeader},command:null};
  }
  if(trim.startsWith(';SAAM_PHASE:'))phase=trim.slice(12);
  if(trim.startsWith(';LAYER:'))layer=Number(trim.slice(7));
  if(trim.startsWith(';SAAM_OPERATION:'))operation=trim.slice(16);
  const source={header,inHeader,endedHeader,phase,layer,operation};
  const comment=trim.indexOf(';'),code=comment<0?trim:trim.slice(0,comment).trim();
  if(!code)return {source,command:null};
  requireThat(endedHeader,`Command before Griffin header at line ${line}.`);
  return {source,command:parseGcodeCommand(code,line)};
}

function parseGcodeCommand(code,line) {
  const tokens=/([A-Z])([+-]?(?:\d+(?:\.\d*)?|\.\d+))/g;
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
  return {command,args,line};
}

function applyGcodeCommand(previousState,record,context,source) {
  let {pos,e,feed,absolute,absE,metric,tool,nozzle,bed,hot,bedReady,fan,debt,startupRecoveryPending,time,volume,extrusionMoves,motionMin,motionMax}=previousState;
  const {command,args,line}=record,{plan,machine,bounds,s,area,maxWithdrawalMm,temperatures}=context;
  const {phase,layer,operation}=source,moves=[],events=[];
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
        motionMin=[...motionMin];motionMax=[...motionMax];
        for(let i=0;i<3;i++){motionMin[i]=Math.min(motionMin[i],pos[i],next[i]);motionMax[i]=Math.max(motionMax[i],pos[i],next[i]);}
        volume+=v;time+=duration;
      } else if(Math.abs(de)>1e-9) {
        requireThat(feed<=machine.maxFeedMmS.e,'Stationary extrusion speed exceeds limit.');
        let startupRecovery=false;
        if(de<0)debt-=de;
        else if(debt>0){requireThat(de<=debt+1e-4,'Unexpected stationary extrusion.');debt=Math.max(0,debt-de);if(debt<1e-4)debt=0;}
        else if(startupRecoveryPending){requireThat(de<=plan.process.retractMm+1e-4,'Unexpected stationary extrusion.');startupRecovery=true;startupRecoveryPending=false;}
        else {
          requireThat(hot&&bedReady&&temperatures.has(nozzle)&&bed===s.bedC,'Stationary extrusion without planned temperature waits.');
          const seconds=de/feed,v=de*area;
          requireThat(v/seconds<=plan.process.maxFlowMm3S+0.003,'Stationary extrusion exceeds locked material flow.');
          moves.push({line,from:[...pos],to:[...pos],extruding:true,volumeMm3:v,speedMmS:0,phase,layer,operation,fan,startSeconds:time,durationSeconds:seconds});
          events.push({line,kind:'injection',positionMm:[...pos],volumeMm3:v,nozzleC:nozzle,phase,layer,operation,startSeconds:time,seconds});
          volume+=v;time+=seconds;extrusionMoves++;
          motionMin=[...motionMin];motionMax=[...motionMax];
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
  return {state:{pos,e,feed,absolute,absE,metric,tool,nozzle,bed,hot,bedReady,fan,debt,startupRecoveryPending,time,volume,extrusionMoves,motionMin,motionMax},moves,events};
}

function validateGcodeCompletion(state,source,context) {
  const {absolute,absE,metric,nozzle,bed,hot,bedReady,fan,volume,extrusionMoves,motionMin,motionMax}=state;
  const {header,inHeader,endedHeader}=source;
  const {bodyOnly,extrusionMode,s}=context;
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
  return state;
}

function gcodeProgram(state,source,context,moves,events) {
  const {pos,time,volume,extrusionMoves}=state,{header}=source,{area}=context;
  return {moves,events,header,seconds:time,volumeMm3:volume,finalPosition:pos,summary:{moves:moves.length,extrusionMoves,
    volumeMm3:volume,filamentMm:volume/area,motionSeconds:time,
    startup:'Firmware startup and heating time are not simulated; this export does not request routine bed leveling.',clearance:'Operator responsibility; not checked.'}};
}

