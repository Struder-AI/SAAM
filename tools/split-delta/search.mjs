import {geometry,assessCylinder} from '../../core/machine/split-delta.mjs';
const rows=[];
for(const towerRadiusMm of [180,220,260,300])for(const platformRadiusMm of [35,55,75])for(const platformPairMm of [80,120,160])for(const rodLengthMm of [350,450,550])for(const railSeparationMm of [50,100,160]){
  const config={towerRadiusMm,platformRadiusMm,platformPairMm,rodLengthMm,railSeparationMm,toolLengthMm:120,jointConeDeg:115};
  try{const g=geometry(config),a=assessCylinder(g,{diameterMm:200,radialSteps:2,azimuthSteps:12,tiltSteps:4,stopEarly:true});if(a.passed)rows.push({config,overhead:a.overheadMm,ratio:a.minSingularRatio,joint:a.requiredJointConeDeg});}catch{}
}
rows.sort((a,b)=>(a.config.towerRadiusMm*2+a.config.rodLengthMm+a.overhead)-(b.config.towerRadiusMm*2+b.config.rodLengthMm+b.overhead));
console.log(JSON.stringify(rows.slice(0,12),null,2));
