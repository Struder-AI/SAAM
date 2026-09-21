import {Worker} from 'node:worker_threads';
import {attachCheckedProgramWorker} from '../core/print/program-handoff.mjs';
import {generationControl} from '../core/print/generation-control.mjs';

const asError=value=>value instanceof Error?value:new Error(String(value));

export class PreparedGenerationJob {
  #detachSource;
  #failure=null;
  #pending=null;
  #termination=null;
  #onMessage;
  #onError;
  #onExit;

  constructor({key,directory,generationHash,createWorker,attachSource=attachCheckedProgramWorker,createControl=generationControl}){
    this.key=key;this.directory=directory;this.generationHash=generationHash;
    this.status='preparing';this.progress={stage:'Preparing geometry'};
    this.control=createControl();this.worker=null;this.started=false;
    try{
      this.worker=createWorker(this.control.buffer);
      this.started=true;
      if(!(this.worker instanceof Worker)&&attachSource===attachCheckedProgramWorker)throw new TypeError('Expected the Studio generation worker.');
      this.#detachSource=attachSource(this.worker,generationHash);
      this.#onMessage=message=>this.#receive(message);
      this.#onError=error=>{this.#fail(error,true);};
      this.#onExit=code=>{if(code&&this.worker)this.#fail(new Error('Toolpath preparation stopped unexpectedly.'),true);};
      this.worker.on('message',this.#onMessage);
      this.worker.on('error',this.#onError);
      this.worker.on('exit',this.#onExit);
      this.worker.unref();
    }catch(error){this.#fail(error,true);}
  }

  get error(){return this.#failure?.message??null;}
  get cancellable(){return this.started&&this.status!=='disposed'&&!this.control.committing;}

  generate(development){
    if(this.status==='failed')return Promise.reject(this.#failure);
    if(this.status==='disposed')return Promise.reject(new Error('The prepared toolpath is no longer available.'));
    if(this.status==='generating')return Promise.reject(new Error('Toolpath generation is already running.'));
    this.status='generating';
    const pending=new Promise((resolve,reject)=>{this.#pending={resolve,reject};});
    try{this.worker.postMessage({type:'generate',development});}
    catch(error){this.#fail(error,true);}
    return pending;
  }

  cancel(){
    if(!this.control.cancel())return {cancelled:false,committing:this.control.committing,done:Promise.resolve()};
    return {cancelled:true,committing:false,done:this.dispose(this.control.error())};
  }

  dispose(error=new Error('The prepared print changed.')){
    if(this.status==='disposed')return this.#termination??Promise.resolve();
    this.status='disposed';
    this.#stopListening();this.#detach();
    const pending=this.#pending;this.#pending=null;pending?.reject(error);
    return this.#terminate();
  }

  #receive(message){
    if(this.status==='disposed')return;
    if(message.type==='progress'){this.progress=message.progress;return;}
    if(message.type==='prepared'){
      if(message.error)this.#fail(new Error(message.error));
      else if(this.status==='preparing')this.status='ready';
      return;
    }
    if(message.type!=='generated'||this.status!=='generating')return;
    if(message.error){
      const error=Object.assign(new Error(message.error),{code:message.code});
      this.#fail(error);return;
    }
    const pending=this.#pending;this.#pending=null;
    Promise.resolve(this.dispose()).then(()=>pending?.resolve(message.checks),error=>pending?.reject(error));
  }

  #fail(value,terminate=false){
    if(this.status==='disposed')return;
    const error=asError(value);this.#failure=error;this.status='failed';this.#detach();
    const pending=this.#pending;this.#pending=null;pending?.reject(error);
    if(terminate){this.#stopListening();void this.#terminate().catch(()=>{});}
  }

  #detach(){const detach=this.#detachSource;this.#detachSource=null;detach?.();}

  #stopListening(){
    if(!this.worker)return;
    if(this.#onMessage)this.worker.off('message',this.#onMessage);
    if(this.#onError)this.worker.off('error',this.#onError);
    if(this.#onExit)this.worker.off('exit',this.#onExit);
  }

  #terminate(){
    if(this.#termination)return this.#termination;
    const worker=this.worker;this.worker=null;
    if(!worker)return Promise.resolve();
    try{return this.#termination=Promise.resolve(worker.terminate());}
    catch(error){return this.#termination=Promise.reject(error);}
  }
}
