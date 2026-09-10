// Shared deterministic development cases, also fed to the original C# library.
const rect=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
const nested=[rect(0,0,20,20),rect(3,3,14,14).reverse(),rect(7,7,6,6),rect(9,9,2,2).reverse()];
const neck=[[0,0],[4,0],[4,1.8],[8,1.8],[8,0],[12,0],[12,4],[8,4],[8,2.2],[4,2.2],[4,4],[0,4]];
const star=Array.from({length:18},(_,i)=>{const a=i*Math.PI/9,r=i%2?3:10;return [r*Math.cos(a),r*Math.sin(a)];});
export const offsetFixtures=[];
for(const [name,loops] of [['nested',nested],['neck',[neck]],['star',[star]],['islands',[rect(0,0,2,2),rect(2.3,0,2,2)]],['thin',[[[0,0],[10,0],[0,0.001]]]]])
  for(const delta of [-0.2,0.2,-1,1,-4,4])for(const join of ['round','miter','square'])offsetFixtures.push({name:`${name}/${delta}/${join}`,loops,delta,join,precisionMm:1e-9,arcToleranceMm:0.002});
