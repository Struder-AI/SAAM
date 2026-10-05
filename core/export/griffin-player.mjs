import {distance,requireThat} from '../private/export/numeric.mjs';
// Shared browser/server decoder. This module never imports path generation.

import {gcodeLines} from './gcode-lines.mjs';
import {startupRetracted} from '../machine/rules.mjs';
export const DWELL_COMMAND_MS=60000;

// A decoder for the supported output subset. Geometry is reconstructed from
// G-code coordinates and modal state, never from SAAMpath/display annotations.
export const interpretGriffin=(text,plan,machine,options={})=>interpretGcode(text,plan,machine,false,'absolute',options);
// Body decoding shares Griffin's modal engine after firmware service motion.
// Coordinates come from commands and known units/modes, never display labels.
export const interpretMotion=(text,plan,machine,{extrusionMode='absolute',...options}={})=>interpretGcode(text,plan,machine,true,extrusionMode,options);
// Firmware service blocks hand the known body position and extrusion state to
// this decoder; service motion itself is outside the playback model.
export function interpretMotionChunk(text,plan,machine,{position,debt=0,fan=0,startupRecoveryPending=false},moves=[]){
  const initial=initializeGcodeInterpretation(plan,machine,true,'relative');
  requireThat(Array.isArray(position)&&position.length===3&&position.every(Number.isFinite),'Invalid motion handoff position.');
  requireThat(Number.isFinite(debt)&&debt>=0,'Invalid motion handoff retraction.');
  initial.state={...initial.state,pos:[...position],debt,fan,startupRecoveryPending};
  const interpreted=interpretGcodeLines(text,initial,moves),s=interpreted.state;
  return {...gcodeProgram(s,interpreted.source,initial.context,moves,interpreted.events),state:s};
}
function interpretGcode(text,plan,machine,bodyOnly=false,extrusionMode='absolute',{moves=[]}={}) {
  const initial=initializeGcodeInterpretation(plan,machine,bodyOnly,extrusionMode);
  const interpreted=interpretGcodeLines(text,initial,moves);
  return gcodeProgram(interpreted.state,interpreted.source,initial.context,interpreted.moves,interpreted.events);
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
  requireThat(['absolute','relative'].includes(extrusionMode),'Unsupported extrusion mode.');
  const s=plan.setup, area=Math.PI*(s.filamentMm/2)**2;
  const startupZ=machine.startup.zAfterStartupMm;
  requireThat(Number.isFinite(startupZ), 'Machine startup Z is required.');
  return {
    context:{plan,machine,bodyOnly,extrusionMode,s,area},
    source:{header:{},inHeader:false,endedHeader:bodyOnly,phase:'startup',layer:-1,operation:''},
    state:{pos:[...machine.tools[s.tool].startupXY,startupZ],e:0,feed:0,absolute:null,absE:null,metric:false,
      tool:bodyOnly?s.tool:null,nozzle:0,bed:0,hot:false,bedReady:false,fan:0,debt:0,startupRecoveryPending:startupRetracted(machine,plan),
      time:0,volume:0,extrusionMoves:0}
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
  let {pos,e,feed,absolute,absE,metric,tool,nozzle,bed,hot,bedReady,fan,debt,startupRecoveryPending,time,volume,extrusionMoves}=previousState;
  const {command,args,line}=record,{plan,machine,s,area}=context;
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
      only('S','S');bed=args.S;bedReady=command==='M190';events.push({line,kind:'bed',target:bed,wait:bedReady});break;
    case 'M109':case 'M104':
      only('ST','S');requireThat(args.T===undefined||args.T===s.tool,'Temperature addressed to unexpected tool.');
      nozzle=args.S;hot=command==='M109';events.push({line,kind:'nozzle',target:nozzle,wait:hot});break;
    case 'G92':only('E','E');e=args.E;break;
    case 'M106':only('S','S');fan=args.S;events.push({line,kind:'fan',value:fan});break;
    case 'M107':only('');fan=0;events.push({line,kind:'fan',value:fan});break;
    case 'M400':only('');events.push({line,kind:'synchronize'});break;
    case 'G4':only('P','P');requireThat(args.P>=0,'Dwell milliseconds must be nonnegative.');events.push({line,kind:'dwell',seconds:args.P/1000,startSeconds:time});time+=args.P/1000;break;
    case 'G0':case 'G1': {
      only('XYZEF');requireThat(Object.keys(args).length>0,'Empty move.');
      requireThat(metric&&absolute!==null&&absE!==null&&tool===s.tool,'Unknown initial motion state.');
      if(args.F!==undefined){requireThat(args.F>0,'Feed must be positive.');feed=args.F/60;}
      requireThat(feed>0,'Move has no feed.');
      const next=pos.map((v,i)=>args['XYZ'[i]]===undefined?v:(absolute?args['XYZ'[i]]:v+args['XYZ'[i]]));
      const length=distance(pos,next),nextE=args.E===undefined?e:(absE?args.E:e+args.E),de=nextE-e;
      if(length>1e-9) {
        const duration=length/feed,recovered=de>0?Math.min(de,debt):0,deposited=Math.max(0,de-recovered);
        debt=de<0?debt-de:Math.max(0,debt-recovered);
        const v=deposited*area;
        moves.push({line,from:[...pos],to:next,extruding:deposited>1e-8,volumeMm3:v,speedMmS:feed,phase,layer,operation,fan,startSeconds:time,durationSeconds:duration});
        if(deposited>1e-8)extrusionMoves++;
        volume+=v;time+=duration;
      } else if(Math.abs(de)>1e-9) {
        const startupRecovery=de>0&&debt===0&&startupRecoveryPending;
        const recovered=de>0?Math.min(de,startupRecovery?plan.process.retractMm:debt):0;
        debt=de<0?debt-de:Math.max(0,debt-recovered);
        if(debt<1e-4)debt=0;
        if(startupRecovery)startupRecoveryPending=false;
        const withdrawn=de<0?-de:recovered;
        if(withdrawn>0){
          const seconds=withdrawn/feed;
          events.push({line,kind:de<0?'retract':startupRecovery?'startup-recover':'recover',filamentMm:withdrawn,startSeconds:time,seconds});time+=seconds;
        }
        const deposited=Math.max(0,de-recovered);
        if(deposited>1e-9){
          const seconds=deposited/feed,v=deposited*area;
          moves.push({line,from:[...pos],to:[...pos],extruding:true,volumeMm3:v,speedMmS:0,phase,layer,operation,fan,startSeconds:time,durationSeconds:seconds});
          events.push({line,kind:'injection',positionMm:[...pos],volumeMm3:v,nozzleC:nozzle,phase,layer,operation,startSeconds:time,seconds});
          volume+=v;time+=seconds;extrusionMoves++;
        }
      }
      pos=next;e=nextE;break;
    }
    default:throw new Error(`Unsupported command ${command} at line ${line}.`);
  }
  return {state:{pos,e,feed,absolute,absE,metric,tool,nozzle,bed,hot,bedReady,fan,debt,startupRecoveryPending,time,volume,extrusionMoves},moves,events};
}

function gcodeProgram(state,source,context,moves,events) {
  const {pos,time,volume,extrusionMoves}=state,{header}=source,{area}=context;
  return {moves,events,header,seconds:time,volumeMm3:volume,finalPosition:pos,summary:{moves:moves.length,extrusionMoves,
    volumeMm3:volume,filamentMm:volume/area,motionSeconds:time,
    startup:'Firmware startup and heating time are not simulated; this export does not request routine bed leveling.',clearance:'Operator responsibility; not checked.'}};
}

