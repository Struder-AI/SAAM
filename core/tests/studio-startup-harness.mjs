import vm from 'node:vm';
import {parse} from 'acorn';

export function startupHarness(source,{loadError}={}){
  const trace=[],listeners=new Map(),timers=new Map(),pending=[],controls={};let timerId=0;
  const declarations=new Set(['initializeAgentInterface','connectViewPersistence','startPreparationPolling','seekTourLayer',
    'createStudioTour','loadStudio','studioChanged','studioVisible','connectStudioUpdates','disposeStudioSession',
    'restoreStudioSession','connectStudioSession','initializeStudio','scheduleChange']);
  const startupCalls=new Set(['connectViewPersistence','startPreparationPolling','initializeStudio']);
  const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});
  let code;
  if(source.includes('function initializeStudio('))code=ast.body.filter(node=>
    node.type==='FunctionDeclaration'&&declarations.has(node.id.name)||
    node.type==='VariableDeclaration'&&node.declarations.some(d=>['agentUI','changeTimer'].includes(d.id.name))||
    node.type==='ExpressionStatement'&&startupCalls.has(node.expression.callee?.name)
  ).map(node=>source.slice(node.start,node.end)).join('\n');
  else {
    const agent=ast.body.find(n=>n.type==='VariableDeclaration'&&n.declarations.some(d=>d.id.name==='agentUI'));
    code=source.slice(agent.start,agent.end)+"\nwindow.addEventListener('pagehide',saveView);\nsetInterval(pollPreparation,250);\n"+
      source.slice(source.indexOf('tourUI=createTourUI('));
  }
  const register=target=>(name,fn)=>{trace.push(['listen',target,name]);const key=target+':'+name;listeners.set(key,[...(listeners.get(key)??[]),fn]);};
  const context=vm.createContext({tourUI:undefined,state:{tour:{active:false},work:{},program:{moves:[]}},busy:false,polling:false,tab:'geometry',
    createAgentUI(options){trace.push(['agent-ui']);controls.agent=options;return {};},
    createTourUI(options){trace.push(['tour-ui']);controls.tour=options;return {load:async()=>{trace.push(['tour-load']);if(loadError)throw Error(loadError);},activity:active=>trace.push(['activity',active])};},
    working(label,action){trace.push(['working',label]);const task=action();pending.push(task.catch(()=>{}));return task;},
    refresh:async(...args)=>{trace.push(['refresh',...args]);},message:(...args)=>trace.push(['message',...args]),
    saveView:()=>trace.push(['save-view']),machineSession:{dispose:()=>trace.push(['dispose'])},viewer:{dispose(){}},
    poll:()=>trace.push(['poll']),pollPreparation:()=>trace.push(['poll-preparation']),
    setInterval(fn,ms){trace.push(['interval',ms]);timers.set(++timerId,{fn,ms,interval:true});return timerId;},
    setTimeout(fn,ms){trace.push(['timeout',ms]);timers.set(++timerId,{fn,ms});return timerId;},
    clearTimeout(id){trace.push(['clear-timeout']);timers.delete(id);},
    window:{addEventListener:register('window')},document:{visibilityState:'visible',addEventListener:register('document')},
    needsTourToolpath:()=>false,acknowledgeDisplayedView:async()=>{},api(){},setTab(){},stop(){trace.push(['stop']);},
    seconds:0,layerFade:{reset(){trace.push(['reset-fade']);}},requestDraw(){trace.push(['draw']);},$:()=>controls.scrub??=( {})
  });
  vm.runInContext(code,context);
  return {trace,context,controls,timers,async settle(){await Promise.all(pending);await Promise.resolve();},
    emit(target,name,event={}){for(const fn of listeners.get(target+':'+name)??[])fn(event);},
    tick(ms){for(const [id,timer]of [...timers])if(timer.ms===ms){if(!timer.interval)timers.delete(id);timer.fn();}}};
}
