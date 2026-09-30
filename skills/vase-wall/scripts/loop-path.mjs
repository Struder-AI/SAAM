// Example authoring geometry. The recipe stores only the returned explicit path.
export function loopPath({loops=20,widthCells=1.3,depthMm=4.8,samples=64,beadHeightMm=.2,riseMm=.2,exterior='smooth'}={}){
  if(!Number.isSafeInteger(loops)||loops<1||!Number.isSafeInteger(samples)||samples<4||!Number.isSafeInteger(loops*samples+1))throw Error('Choose representable positive loop counts and at least four samples per loop.');
  if(![widthCells,depthMm,beadHeightMm,riseMm].every(v=>Number.isFinite(v)&&v>0)||!['smooth','scalloped','both-scalloped'].includes(exterior))throw Error('Invalid loop geometry.');
  const points=[],offsetMm=[];
  for(let cell=0;cell<loops;cell++)for(let i=cell?1:0;i<=samples;i++){
    const t=i/samples,angle=2*Math.PI*t,depth=depthMm*(1-Math.cos(angle))/2,u=i===samples?1:t+widthCells/2*Math.sin(angle),phase=(cell+u)/loops;
    points.push([phase,.03*depth+phase*riseMm]);
    offsetMm.push(exterior==='both-scalloped'?depthMm/2-depth:exterior==='scalloped'?depth:-depth);
  }
  return {points,offsetMm,beadHeightMm};
}
