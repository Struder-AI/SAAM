import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadMachine} from '../../core/machine/profile.mjs';
import {densoGeometry,densoForward} from '../../core/machine/denso-kinematics.mjs';
import {rigid} from '../../core/machine/rigid.mjs';
import {interpretMachineStudy} from '../../core/export/machine-study.mjs';

const euler=r=>[Math.atan2(r[2][1],r[2][2]),Math.asin(Math.max(-1,Math.min(1,-r[2][0]))),Math.atan2(r[1][0],r[0][0])].map(v=>v*180/Math.PI);
export async function createStudy(directory,machineId='ultimaker-s5',{source,model={}}={}){
  const dir=resolve(directory);
  try{const existing=JSON.parse(await readFile(resolve(dir,'plan.json'),'utf8'));if(existing.schema!=='saam-machine-study/1')throw Error('Choose a study directory; an existing print must not be replaced');}
  catch(error){if(error.code!=='ENOENT')throw error;}
  const machine=loadMachine(machineId),setup={...machine.defaultSetup},seed=[0,0,0,0,35,0];
  let center=[0,0,25],angles=[0,0,0];
  if(machineId==='dobot-mg400'){
    center=[250,0,150];setup.kinematicModel={worldFromBase:rigid(),toolLengthMm:100,basis:'Synthetic base/design alignment for a nominal mechanism study.'};
  }else if(machineId==='denso-vp6242-rc8'){
    const pose=densoForward(densoGeometry(),seed);center=pose.tcp;angles=euler(pose.rotation);
    setup.kinematicModel={worldFromBase:rigid(),toolLengthMm:70,modelSeedDeg:seed,basis:'Synthetic floor installation; drawing-based model angles, not RC8 FIG or calibration.'};
  }else if(['ultimaker-s5','bambu-h2d'].includes(machineId))center=[150,110,25];
  machine.kinematicModel={...machine.kinematicModel,...model};setup.kinematicModel={...setup.kinematicModel,...model};
  if(!source){
    const moves=Array.from({length:48},(_,i)=>{const a=(i+1)*Math.PI/24;return {tcp:[center[0]+8*Math.cos(a),center[1]+8*Math.sin(a),center[2]+4*Math.sin(a*2)],
      anglesDeg:angles,seconds:.5};});
    source={schema:'saam-machine-study-source/1',orientation:'euler-xyz',initial:{tcp:[center[0]+8,center[1],center[2]],anglesDeg:angles},moves};
  }
  const program=interpretMachineStudy(source);
  const bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
  for(const move of program.moves)for(const p of [move.from,move.to])for(let i=0;i<3;i++){bounds.min[i]=Math.min(bounds.min[i],p[i]-10);bounds.max[i]=Math.max(bounds.max[i],p[i]+10);}
  const plan={schema:'saam-machine-study/1',output:'machine-study',setup,placement:{xMm:0,yMm:0},studyBounds:bounds,
    geometry:{runMm:bounds.max[0]-bounds.min[0],widthMm:bounds.max[1]-bounds.min[1],baseMm:bounds.min[2],angleDeg:0},
    process:{layerMm:.2,firstLayerMm:.2,lineWidthMm:.4,skinLayers:0,skinNormalMm:.2,liftMm:0},skills:{}};
  await mkdir(dir,{recursive:true});
  for(const [name,data] of [['plan.json',plan],['machine.json',machine],['motion.json',source]])await writeFile(resolve(dir,name),typeof data==='string'?data:JSON.stringify(data,null,2)+'\n');
  return {directory:dir,machine:machineId,seconds:program.seconds};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [machineId,directory,sourceFile,modelFile]=process.argv.slice(2);
  if(!machineId||!directory)throw Error('Usage: node tools/kinematics/create-study.mjs <machine-id> <directory> [motion.json] [model.json]');
  const text=sourceFile?await readFile(sourceFile,'utf8'):undefined;
  const source=text===undefined?undefined:JSON.parse(text),model=modelFile?JSON.parse(await readFile(modelFile,'utf8')):{};
  console.log(JSON.stringify(await createStudy(directory,machineId,{source,model})));
}
