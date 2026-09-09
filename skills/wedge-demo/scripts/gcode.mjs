import { VERSION, BUILD_DATE, distance, requireThat, number } from './model.mjs';

const fmt=(n,d=5)=>Number(n.toFixed(d)).toString();
export function exportGcode(path,plan,machine) {
  requireThat(machine.outputs.some(o=>o.id===plan.output && o.flavor==='Griffin'),'Machine does not declare Griffin export.');
  const s=plan.setup, area=Math.PI*(s.filamentMm/2)**2, tool=s.tool;
  const startupZ=machine.startup.zAfterStartupMm??machine.startup.zAfterPrimeMm;
  requireThat(Number.isFinite(startupZ), 'Machine startup Z is required.');
  const points=[path.initialPosition,...path.actions.filter(a=>a.kind==='move').map(a=>a.to)];
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const point of points)for(let i=0;i<3;i++){min[i]=Math.min(min[i],point[i]);max[i]=Math.max(max[i],point[i]);}
  const volume=path.actions.reduce((v,a)=>v+(a.volumeMm3??0),0);
  let time=0,pos=path.initialPosition;
  for(const a of path.actions) {
    if(a.kind==='move'){time+=distance(pos,a.to)/a.speedMmS;pos=a.to;}
    if(a.kind==='dwell')time+=a.seconds;
    if(a.filamentMm)time+=a.filamentMm/a.speedMmS;
  }
  // S5 firmware interprets GENERATOR.VERSION as a Griffin/Cura compatibility
  // level even when GENERATOR.NAME identifies another generator.  Keep SAAM's
  // identity truthful while declaring the minimum accepted 4.4-level format.
  const lines=[';START_OF_HEADER',';HEADER_VERSION:0.1',';FLAVOR:Griffin',';GENERATOR.NAME:SAAM',';GENERATOR.VERSION:4.4.0',`;SAAM.GENERATOR.VERSION:${VERSION}`,
    `;GENERATOR.BUILD_DATE:${BUILD_DATE}`,
    ';TARGET_MACHINE.NAME:Ultimaker S5',`;EXTRUDER_TRAIN.${tool}.INITIAL_TEMPERATURE:${s.nozzleC}`,
    `;EXTRUDER_TRAIN.${tool}.MATERIAL.VOLUME_USED:${Math.ceil(volume)}`,
    `;EXTRUDER_TRAIN.${tool}.MATERIAL.GUID:${s.materialGuid}`,
    `;EXTRUDER_TRAIN.${tool}.NOZZLE.DIAMETER:${s.nozzleMm}`,`;EXTRUDER_TRAIN.${tool}.NOZZLE.NAME:${s.core}`,
    ';BUILD_PLATE.TYPE:glass',`;BUILD_PLATE.INITIAL_TEMPERATURE:${s.bedC}`,`;BUILD_VOLUME.TEMPERATURE:${s.buildVolumeC}`,`;PRINT.TIME:${Math.ceil(time)}`,';PRINT.GROUPS:1'];
  for(const [bound,values]of [['MIN',min],['MAX',max]])for(const [i,axis]of ['X','Y','Z'].entries())lines.push(`;PRINT.SIZE.${bound}.${axis}:${fmt(values[i])}`);
  lines.push(';END_OF_HEADER',';Clearance: operator responsibility for this demo',
    ';Firmware owns Griffin startup; this export does not request routine bed leveling.',
    `T${tool}`,'G21','G90','M82',`M190 S${s.bedC}`,`M109 T${tool} S${s.nozzleC}`,
    `G0 Z${fmt(startupZ)} F300`,'G92 E0');
  let e=0,tag='';
  for(const a of path.actions) {
    const nextTag=`${a.phase}:${a.layer}`;
    if(tag!==nextTag){lines.push(`;SAAM_PHASE:${a.phase}`,`;LAYER:${a.layer}`);tag=nextTag;}
    if(a.kind==='move') {
      const xyz=a.to.map((v,i)=>`${'XYZ'[i]}${fmt(v)}`).join(' ');
      if(a.volumeMm3>0){e+=a.volumeMm3/area;lines.push(`G1 ${xyz} E${fmt(e)} F${fmt(a.speedMmS*60,3)}`);}
      else lines.push(`G0 ${xyz} F${fmt(a.speedMmS*60,3)}`);
    } else if(a.kind==='retract'||a.kind==='recover') {
      e+=(a.kind==='retract'?-1:1)*a.filamentMm;
      lines.push(`G1 E${fmt(e)} F${fmt(a.speedMmS*60,3)}`);
    } else if(a.kind==='fan') lines.push(a.percent===0?'M107':`M106 S${Math.round(a.percent*255/100)}`);
    else if(a.kind==='dwell') lines.push(`G4 P${Math.ceil(a.seconds*1000)}`);
    else throw new Error(`Unsupported SAAMpath action: ${a.kind}`);
  }
  lines.push('M400',`M104 T${tool} S0`,'M140 S0','M107',';END_OF_SAAM');
  return lines.join('\n')+'\n';
}

// A strict interpreter for the exported subset. Geometry is reconstructed from
// G-code coordinates and modal state, never from SAAMpath/display annotations.
export function interpretGcode(text,plan,machine) {
  requireThat(typeof text==='string'&&text.length<25_000_000,'Invalid/oversized G-code.');
  const s=plan.setup, area=Math.PI*(s.filamentMm/2)**2;
  const startupZ=machine.startup.zAfterStartupMm??machine.startup.zAfterPrimeMm;
  requireThat(Number.isFinite(startupZ), 'Machine startup Z is required.');
  let pos=[...machine.tools[s.tool].startupXY,startupZ],e=0,feed=0,absolute=null,absE=null,metric=false;
  let tool=null,nozzle=0,bed=0,hot=false,bedReady=false,fan=0,debt=0,phase='startup',layer=-1,time=0,volume=0;
  const moves=[],events=[],header={};
  let inHeader=false,endedHeader=false;
  const tokens=/([A-Z])([+-]?(?:\d+(?:\.\d*)?|\.\d+))/g;
  for(const [index,raw]of text.split(/\r?\n/).entries()) {
    const line=index+1,trim=raw.trim();
    if(trim===';START_OF_HEADER'){requireThat(!inHeader&&!endedHeader&&line===1,'Malformed Griffin header.');inHeader=true;continue;}
    if(trim===';END_OF_HEADER'){requireThat(inHeader,'Malformed Griffin header.');inHeader=false;endedHeader=true;continue;}
    if(inHeader) {
      const m=trim.match(/^;([^:]+):(.*)$/);requireThat(m&&!Object.hasOwn(header,m[1]),`Invalid header at line ${line}.`);header[m[1]]=m[2];continue;
    }
    if(trim.startsWith(';SAAM_PHASE:'))phase=trim.slice(12);
    if(trim.startsWith(';LAYER:'))layer=Number(trim.slice(7));
    const code=raw.split(';')[0].trim();if(!code)continue;
    requireThat(endedHeader,`Command before Griffin header at line ${line}.`);
    const parts=[...code.matchAll(tokens)];
    requireThat(parts.length&&code.replace(tokens,'').trim()==='',`Malformed command at line ${line}.`);
    const command=parts[0][1]+parts[0][2],args={};
    for(const m of parts.slice(1)){requireThat(!Object.hasOwn(args,m[1]),`Duplicate argument at line ${line}.`);args[m[1]]=Number(m[2]);}
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
      case 'G4':only('P','P');number(args.P,0,60000,'Dwell milliseconds');events.push({line,kind:'dwell',seconds:args.P/1000,startSeconds:time});time+=args.P/1000;break;
      case 'G0':case 'G1': {
        only('XYZEF');requireThat(Object.keys(args).length>0,'Empty move.');
        requireThat(metric&&absolute!==null&&absE!==null&&tool===s.tool&&hot&&bedReady,'Unknown initial motion state.');
        if(args.F!==undefined){requireThat(args.F>0,'Feed must be positive.');feed=args.F/60;}
        requireThat(feed>0,'Move has no feed.');
        const next=pos.map((v,i)=>args['XYZ'[i]]===undefined?v:(absolute?args['XYZ'[i]]:v+args['XYZ'[i]]));
        for(let i=0;i<3;i++)requireThat(next[i]>=machine.bounds.min[i]-1e-5&&next[i]<=machine.bounds.max[i]+1e-5,`Out-of-bounds ${'XYZ'[i]} move at line ${line}.`);
        const length=distance(pos,next),nextE=args.E===undefined?e:(absE?args.E:e+args.E),de=nextE-e;
        if(length>1e-9) {
          const duration=length/feed;
          for(let i=0;i<3;i++)requireThat(Math.abs(next[i]-pos[i])/duration<=machine.maxFeedMmS['xyz'[i]]+0.002,`Axis speed exceeds limit at line ${line}.`);
          requireThat(Math.abs(de)/duration<=machine.maxFeedMmS.e+0.002,`Extruder speed exceeds limit at line ${line}.`);
          requireThat(de>=-1e-8,'Moving retractions are outside this demo subset.');
          if(de>1e-8){requireThat(hot&&bedReady&&nozzle===s.nozzleC&&bed===s.bedC,'Extrusion without the planned temperature waits.');requireThat(debt<1e-4,'Extrusion while retracted.');}
          const v=Math.max(0,de)*area;
          requireThat(v/duration<=plan.process.maxFlowMm3S+0.03,`Flow exceeds locked limit at line ${line}.`);
          moves.push({line,from:[...pos],to:next,extruding:de>1e-8,volumeMm3:v,speedMmS:feed,phase,layer,fan,startSeconds:time,durationSeconds:duration});
          volume+=v;time+=duration;
        } else if(Math.abs(de)>1e-9) {
          requireThat(feed<=machine.maxFeedMmS.e,'Stationary extrusion speed exceeds limit.');
          if(de<0)debt-=de;
          else{requireThat(de<=debt+1e-4,'Unexpected stationary extrusion.');debt=Math.max(0,debt-de);}
          requireThat(debt<=8.001,'Excessive retraction.');
          events.push({line,kind:de<0?'retract':'recover',filamentMm:Math.abs(de),startSeconds:time,seconds:Math.abs(de)/feed});time+=Math.abs(de)/feed;
        }
        pos=next;e=nextE;break;
      }
      default:throw new Error(`Unsupported command ${command} at line ${line}.`);
    }
  }
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
  requireThat(moves.some(m=>m.extruding)&&nozzle===0&&bed===0&&fan===0,'Missing deposition or shutdown.');
  for(const [i,axis]of ['X','Y','Z'].entries()) {
    const lo=Number(header[`PRINT.SIZE.MIN.${axis}`]),hi=Number(header[`PRINT.SIZE.MAX.${axis}`]);
    requireThat(Number.isFinite(lo)&&Number.isFinite(hi)&&lo<=hi,'Missing/invalid header bounds.');
    requireThat(moves.every(m=>m.to[i]>=lo-1e-4&&m.to[i]<=hi+1e-4&&m.from[i]>=lo-1e-4&&m.from[i]<=hi+1e-4),'Moves exceed header bounds.');
  }
  requireThat(Math.abs(Number(header[`EXTRUDER_TRAIN.${s.tool}.MATERIAL.VOLUME_USED`])-volume)<1.1,'Header material volume mismatch.');
  return {moves,events,header,summary:{moves:moves.length,extrusionMoves:moves.filter(m=>m.extruding).length,
    volumeMm3:volume,filamentMm:volume/area,motionSeconds:time,
    startup:'Firmware startup and heating time are not simulated; this export does not request routine bed leveling.',clearance:'Operator responsibility; not checked.'}};
}
