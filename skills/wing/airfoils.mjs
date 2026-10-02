import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const records=JSON.parse(readFileSync(new URL('./data/sources.json',import.meta.url))).records;
const notes={
  naca2412:'Moderate camber and thickness for comparing a conventional wing.',
  clarky:'A largely flat aft lower surface offers a construction comparison.',
  sd7037:'A thinner section to compare for a light glider. Check internal depth.',
  e205:'A cambered glider section; match performance evidence to speed and chord.',
  n0012:'A symmetric section for exploring tails or inverted-flight requirements.',
  s1223:'Strong camber for a high-lift comparison. Check pitching moment and construction.'
};

function parseDat(text){
  const rows=text.replace(/\x1a/g,'').split(/\r?\n/).map(line=>line.split('#')[0].trim()).filter(Boolean)
    .map(line=>line.split(/\s+/).map(Number)).filter(row=>row.length===2&&row.every(Number.isFinite));
  let upper,lower;
  if(rows[0]?.every(value=>Number.isInteger(value)&&value>1)){
    const [a,b]=rows.shift();if(rows.length!==a+b)throw Error('Airfoil point counts do not match.');
    upper=rows.slice(0,a);lower=rows.slice(a);
  }else{
    let nose=0;rows.forEach((point,i)=>{if(point[0]<rows[nose][0])nose=i;});
    upper=rows.slice(0,nose+1);lower=rows.slice(nose);
  }
  if(!upper||upper.length<3||lower.length<3)throw Error('Airfoil requires two identifiable surfaces.');
  upper.sort((a,b)=>a[0]-b[0]);lower.sort((a,b)=>a[0]-b[0]);
  if(Math.abs(upper[0][0])>.01||Math.abs(upper.at(-1)[0]-1)>.01)throw Error('Expected unit-chord coordinates.');
  if(ordinate({upper,lower},.4,'upper')<ordinate({upper,lower},.4,'lower'))[upper,lower]=[lower,upper];
  return {upper,lower};
}

function ordinate(profile,x,side){
  const points=profile[side];let low=1,high=points.length-1;
  while(low<high){const middle=(low+high)>>1;if(points[middle][0]<x)low=middle+1;else high=middle;}
  const a=points[low-1],b=points[low],t=(x-a[0])/Math.max(1e-12,b[0]-a[0]);
  return a[1]+(b[1]-a[1])*t;
}

const profiles=new Map(records.map(record=>{
  const bytes=readFileSync(new URL(`./data/${record.id}.dat`,import.meta.url));
  if(createHash('sha256').update(bytes).digest('hex')!==record.sha256)throw Error(`Airfoil coordinates changed: ${record.id}`);
  const profile=parseDat(bytes.toString('utf8')),sample=[];
  let thickness=0,camber=0;
  for(let i=0;i<=1024;i++){
    const x=i/1024,upper=ordinate(profile,x,'upper'),lower=ordinate(profile,x,'lower');
    sample.push([(upper+lower)/2,(upper-lower)/2]);
    thickness=Math.max(thickness,upper-lower);camber=Math.max(camber,(upper+lower)/2);
  }
  return [record.id,{...record,note:notes[record.id],profile,sample,thickness,camber}];
}));

export const airfoilCatalog=()=>[...profiles.values()].map(({sample,...entry})=>entry);
export const airfoilProfile=id=>{
  const profile=profiles.get(id);if(!profile)throw Error(`Unknown airfoil: ${id}`);
  return profile;
};
export function airfoilSection(id,u,thickness,camber){
  const profile=airfoilProfile(id),x=Math.max(0,Math.min(1,u))*1024,i=Math.min(1023,Math.floor(x)),t=x-i;
  const a=profile.sample[i],b=profile.sample[i+1];
  const center=(a[0]+(b[0]-a[0])*t)*(profile.camber?camber/profile.camber:0);
  const half=(a[1]+(b[1]-a[1])*t)*(thickness/profile.thickness);
  return {center,half};
}
