// Shared with a calculation worker: cancellation can win only before saving.
// Once commit wins, let the short sequence of bundle writes finish intact.
export function generationControl(buffer=new SharedArrayBuffer(4)){
  const state=new Int32Array(buffer);
  const error=()=>Object.assign(new Error('Toolpath calculation cancelled.'),{code:'GENERATION_CANCELLED'});
  return {buffer,
    get cancelled(){return Atomics.load(state,0)===1;},
    get committing(){return Atomics.load(state,0)===2;},
    cancel(){return Atomics.compareExchange(state,0,0,1)===0;},
    check(){if(Atomics.load(state,0)===1)throw error();},
    beforeCommit(){if(Atomics.compareExchange(state,0,0,2)===1)throw error();},
    error
  };
}
