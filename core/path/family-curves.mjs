import {requireThat,dot,cross,normalize,distance} from '../geom/tolerance.mjs';
import {sampleAuthoredCurve,referenceCurvePoint} from './authored-curves.mjs';

// Family boundaries are already offset/clipped/mapped. A sleeve is their
// around/layer correspondence, so joins never reslice geometry or select a skill.
export function boundarySleeve(family){
  requireThat(family?.layers?.length>=2,'A boundary sleeve needs at least two layers.');
  for(const layer of family.layers)requireThat(layer.curves?.length===1&&layer.curves[0].closed&&layer.curves[0].points.length>=3,'Spiral joining needs one closed boundary per family layer, with no holes.');
  return {layers:family.layers,direction:normalize(family.direction??[0,0,1])};
}

function familyNormal(sleeve,u,v){
  const at=index=>{
    const layer=sleeve.layers[index],curve=layer.curves[0];
    if(layer.slice?.kind==='plane')return layer.slice.normal;
    requireThat(curve.frameSamples?.length===curve.points.length,'Curved family joins need boundary frame normals.');
    const points=[...curve.points,curve.points[0]],lengths=[0];for(let i=1;i<points.length;i++)lengths.push(lengths.at(-1)+distance(points[i-1],points[i]));
    const along=((u%1)+1)%1*lengths.at(-1);let i=1;while(i<lengths.length-1&&lengths[i]<along)i++;
    const t=(along-lengths[i-1])/(lengths[i]-lengths[i-1]),a=curve.frameSamples[i-1].normal,b=curve.frameSamples[i%curve.points.length].normal;
    return normalize(a.map((x,k)=>x+(b[k]-x)*t));
  };
  const coordinate=Math.max(0,Math.min(sleeve.layers.length-1,v)),lo=Math.floor(coordinate),hi=Math.min(sleeve.layers.length-1,lo+1),t=coordinate-lo,a=at(lo),b=at(hi);
  return normalize(a.map((x,k)=>x+(b[k]-x)*t));
}

export function spiralFamilyCurve({family,firstHeightMm,widthMm,speedMmS,levelEnd=true,sampleStepMm=.4,toleranceMm=.02}){
  const sleeve=boundarySleeve(family),n=sleeve.layers.length;
  requireThat(firstHeightMm>0&&widthMm>0&&speedMmS>0,'Spiral joining needs positive bead/process values.');
  const points=[[0,0],[1,0],[n,n-1],...(levelEnd?[[n+1,n-1]]:[])];
  const curve=sampleAuthoredCurve({role:'spiral',closed:false,uv:{reference:{kind:'sleeve',assignment:'family'},points,normalMm:0},sampleStepMm,toleranceMm},{references:{'sleeve:family':sleeve}});
  const surfaceNormals=[];
  const heightsMm=curve.points.slice(1).map((point,i)=>{
    const a=curve.frameSamples[i].point,b=curve.frameSamples[i+1].point,u=(a[0]+b[0])/2,v=(a[1]+b[1])/2;
    const normal=familyNormal(sleeve,u,v);surfaceNormals.push(normal);
    if(u<=1)return firstHeightMm;
    const current=referenceCurvePoint(sleeve,[u,v]).point,previous=referenceCurvePoint(sleeve,[u,Math.max(0,Math.min(n-1,u-2))]).point;
    const gap=dot(current.map((x,k)=>x-previous[k]),normal);
    requireThat(gap>=-1e-8,'Spiral family reverses its deposited layer gap.');return Math.max(0,gap);
  });
  // The sleeve chart's radial normal describes its reference surface. The bead
  // rests on a family layer, whose cutting normal controls gap and tool motion.
  const frameSamples=curve.frameSamples.map(frame=>{
    const normal=familyNormal(sleeve,frame.point[0],frame.point[1]);
    const u=normalize(frame.u.map((v,k)=>v-dot(frame.u,normal)*normal[k]));
    return {...frame,u,v:cross(normal,u),normal};
  });
  return {...curve,frameSamples,heightsMm,beadWidthMm:widthMm,speedMmS,segmentMetadata:heightsMm.map((h,i)=>({surfaceNormal:surfaceNormals[i],beadHeightMm:h,layer:Math.min(n-1,Math.max(0,Math.floor(curve.frameSamples[i].point[1])))}))};
}

export function joinCurveSequence(curves,{mode='separate',toleranceMm=1e-6,transition='travel',speedMmS,heightMm}={}){
  requireThat(['separate','ordered','continuous'].includes(mode)&&['travel','deposit'].includes(transition)&&toleranceMm>=0,'Invalid curve joining rule.');
  if(mode==='separate'||mode==='ordered')return {curves,continuous:mode==='ordered'};
  const output=[];
  for(const curve of curves){
    const previous=output.at(-1);
    if(previous&&distance(previous.points.at(-1),curve.points[0])>toleranceMm){
      requireThat(transition==='deposit','Continuous curve join has a gap; declare a depositing connector or separate travel.');
      output.push({role:'connector',closed:false,points:[previous.points.at(-1),curve.points[0]],speedMmS:speedMmS??curve.speedMmS,heightMm:heightMm??curve.heightMm});
    }
    output.push(curve);
  }
  return {curves:output,continuous:true};
}
