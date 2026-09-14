import {writeFile} from 'node:fs/promises';
import {geometry,assessCylinder,DEFAULT_GEOMETRY} from '../../core/machine/split-delta.mjs';
const fine=process.argv.includes('--fine'),grid=fine?{radialSteps:6,azimuthSteps:36,tiltSteps:14}:{radialSteps:4,azimuthSteps:24,tiltSteps:7};
const candidates=[
  {name:'150-compact',diameterMm:150,config:{rodLengthMm:400}},
  {name:'200-compact',diameterMm:200,config:{}},
  {name:'200-reduced-articulation',diameterMm:200,config:{rodLengthMm:600,jointConeDeg:80,railMaxMm:1000}},
  {name:'200-long-tool',diameterMm:200,config:{rodLengthMm:500,toolLengthMm:160}}
];
const report={schema:'saam-split-delta-assessment/1',createdAt:new Date().toISOString(),jointLayers:2,effectivePivotCentersPerRodEnd:1,method:'Disk and tilt-cone grid, nominal spin zero; reserve tilt49 and spin[-4,0,4]; no physical evidence',candidates:[]};
for(const c of candidates){
  const g=geometry(c.config),options={...grid,diameterMm:c.diameterMm,heightMm:200};
  const reserved=assessCylinder(g,{...options,spinValues:[-4,0,4]}),operating=assessCylinder(g,{...options,reserve:false});
  report.candidates.push({name:c.name,geometry:{...DEFAULT_GEOMETRY,...c.config},reserved,operating});
  console.log(`${c.name}: ${reserved.passed?'PASS':'FAIL'}, ${reserved.samples} samples, joint ${reserved.requiredJointConeDeg.toFixed(2)}°, track H + ${reserved.overheadMm.toFixed(2)} mm`);
}
const out=new URL(fine?'./assessment-fine.json':'./assessment.json',import.meta.url);await writeFile(out,JSON.stringify(report,null,2)+'\n');console.log(out.pathname);
