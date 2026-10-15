// Three quarters of free memory currently available to this process, shared
// by concurrent workers. Node accounts for OS/process constraints. A ceiling
// reserves no memory; an explicit smaller ceiling still wins.
export function heapCeilingMb({workers=1,limitMb}={}){
  const count=Number.isSafeInteger(workers)&&workers>=1?workers:1;
  return Math.floor(Math.min(process.availableMemory()*3/4/count/1048576,limitMb??Infinity));
}
