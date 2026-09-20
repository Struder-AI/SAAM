export const catalog = [
  {id:'naca2412',name:'NACA 2412',family:'NACA',note:'Moderate camber and thickness. A useful reference for comparing a conventional wing.',tags:['balanced','trainer']},
  {id:'clarky',name:'Clark Y',family:'Clark',note:'A largely flat aft lower surface offers a useful construction comparison.',tags:['trainer','slow']},
  {id:'sd7037',name:'SD7037',family:'Selig / Donovan',note:'A thinner section to compare for a light glider. Check the available internal depth.',tags:['glider','endurance']},
  {id:'e205',name:'Eppler E205',family:'Eppler',note:'Another cambered section to compare for a glider; match performance evidence to your speed and chord.',tags:['glider','endurance']},
  {id:'n0012',name:'NACA 0012',family:'NACA',note:'Symmetric section. Useful for exploring tails and inverted-flight requirements.',tags:['aerobatic','speed']},
  {id:'s1223',name:'Selig S1223',family:'Selig',note:'Strong camber makes a useful high-lift comparison. Discuss pitching moment and construction complexity.',tags:['slow']}
].map(f=>({...f,source:`https://m-selig.ae.illinois.edu/ads/coord/${f.id}.dat`}));

export function parseDat(text){
  const lines=text.replace(/\x1a/g,'').split(/\r?\n/).map(l=>l.split('#')[0].trim()).filter(Boolean);
  const rows=lines.map(l=>l.split(/\s+/).map(Number)).filter(a=>a.length===2&&a.every(Number.isFinite));
  let upper,lower;
  if(rows[0]?.every(n=>Number.isInteger(n)&&n>1)){
    const [a,b]=rows.shift();
    if(rows.length!==a+b)throw Error('Airfoil point counts do not match.');
    upper=rows.slice(0,a);lower=rows.slice(a);
  }else{
    let nose=0;rows.forEach((p,i)=>{if(p[0]<rows[nose][0])nose=i;});
    upper=rows.slice(0,nose+1);lower=rows.slice(nose);
  }
  if(!upper||upper.length<3||lower.length<3)throw Error('Airfoil requires two identifiable surfaces.');
  upper.sort((a,b)=>a[0]-b[0]);lower.sort((a,b)=>a[0]-b[0]);
  if(upper.some(p=>!p.every(Number.isFinite))||Math.abs(upper[0][0])>.01||Math.abs(upper.at(-1)[0]-1)>.01)throw Error('Expected unit-chord coordinates.');
  const at=(arr,x)=>{let i=1;while(i<arr.length-1&&arr[i][0]<x)i++;const [a,b]=[arr[i-1],arr[i]];return a[1]+(b[1]-a[1])*(x-a[0])/Math.max(1e-12,b[0]-a[0]);};
  if(at(upper,.4)<at(lower,.4))[upper,lower]=[lower,upper];
  return {upper,lower};
}
export function ordinate(profile,x,side='upper'){
  const a=profile[side];let i=1;while(i<a.length-1&&a[i][0]<x)i++;
  const [p,q]=[a[i-1],a[i]];return p[1]+(q[1]-p[1])*(x-p[0])/Math.max(1e-12,q[0]-p[0]);
}
export function metrics(profile){
  let thickness=0,camber=0,thicknessAt=0,camberAt=0;
  for(let i=0;i<=1000;i++){const x=i/1000,u=ordinate(profile,x),l=ordinate(profile,x,'lower');if(u-l>thickness){thickness=u-l;thicknessAt=x;}if((u+l)/2>camber){camber=(u+l)/2;camberAt=x;}}
  return {thickness,camber,thicknessAt,camberAt};
}
