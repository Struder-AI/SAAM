import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export async function startTray({port,token,pid=process.pid}={}){
  if(!['win32','darwin'].includes(process.platform))return {available:false,stop(){}};
  const script=fileURLToPath(new URL(process.platform==='win32'?'./tray.ps1':'./tray.applescript',import.meta.url));
  const child=process.platform==='win32'
    ?spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-STA','-File',script,'-Port',String(port),'-Token',token,'-AppPid',String(pid)],{stdio:['ignore','pipe','pipe'],windowsHide:true})
    :spawn('/usr/bin/osascript',[script,String(port),token,String(pid)],{stdio:['ignore','pipe','pipe']});
  const diagnostics={problem:null};
  await new Promise((done,fail)=>{
    const timer=setTimeout(()=>{child.kill();fail(Error('The SAAM tray did not become ready.'));},15000);
    const ready=bytes=>{
      const text=bytes.toString();
      if(text.includes('saam-tray-ready')){clearTimeout(timer);done();}
      else diagnostics.problem=text.trim();
    };
    child.stdout.on('data',ready);child.stderr.on('data',ready);
    child.once('error',error=>{clearTimeout(timer);fail(error);});
    child.once('exit',code=>{clearTimeout(timer);fail(Error(diagnostics.problem??'The SAAM tray exited ('+code+').'));});
  });
  return {available:true,diagnostics,stop(){child.kill();}};
}
