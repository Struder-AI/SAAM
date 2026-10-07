import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// The tray is optional: SAAM runs without it and Studio's Quit still stops SAAM.
// The result's problem says why a tray this platform supports did not start.
export async function startTray({port,token,pid=process.pid}={}){
  if(!['win32','darwin'].includes(process.platform))return {problem:null,stop(){}};
  const script=fileURLToPath(new URL(process.platform==='win32'?'./tray.ps1':'./tray.applescript',import.meta.url));
  // A tray click shows Studio from the tray process, which received it (studio/browser.mjs showOpened).
  const raise=fileURLToPath(new URL(process.platform==='win32'?'../studio/raise-window.ps1':'../studio/raise-window.jxa',import.meta.url));
  const child=process.platform==='win32'
    ?spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-STA','-File',script,'-Port',String(port),'-Token',token,'-AppPid',String(pid),'-RaiseScript',raise],{stdio:['ignore','pipe','pipe'],windowsHide:true})
    :spawn('/usr/bin/osascript',[script,String(port),token,String(pid),raise],{stdio:['ignore','pipe','pipe']});
  try{
    await new Promise((done,fail)=>{
      const output={problem:null},timer=setTimeout(()=>{child.kill();fail(Error('The SAAM tray did not become ready.'));},15000);
      const ready=bytes=>{
        const text=bytes.toString();
        if(text.includes('saam-tray-ready')){clearTimeout(timer);done();}
        else output.problem=text.trim();
      };
      child.stdout.on('data',ready);child.stderr.on('data',ready);
      child.once('error',error=>{clearTimeout(timer);fail(error);});
      child.once('exit',code=>{clearTimeout(timer);fail(Error(output.problem??'The SAAM tray exited ('+code+').'));});
    });
  }catch(error){return {problem:error.message,stop(){}};}
  // The tray removes its icon itself when this process ends (it watches pid): a tray ended
  // from here leaves Windows showing a dead process's icon until the pointer passes over it.
  return {problem:null,stop(){child.stdout.destroy();child.stderr.destroy();child.unref();}};
}
