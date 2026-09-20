export const circle=(r,x=0,count=256)=>Array.from({length:count},(_,i)=>{const a=2*Math.PI*i/count;return [x+r*Math.cos(a),r*Math.sin(a)];});
export const ring=thickness=>[circle(10+thickness),circle(10).reverse()];
export function perimeterFixtures(){
  const cases=[];
  for(const thickness of [1.6,2,2.4])for(const inset of [.2,.6,1,1.4])cases.push({name:`ring-${thickness}-${inset}`,region:ring(thickness),inset});
  for(const [name,region] of [['islands',[...ring(2),circle(3),circle(3,20)]],['cut-track',[...ring(2),circle(.2,11).reverse()]],['uneven',[circle(12),circle(10,.1).reverse()]],['empty',[]],['no-hole',[circle(12)]]])cases.push({name,region,inset:1});
  cases.push({name:'invalid-inset',region:ring(2),inset:NaN},{name:'invalid-coordinate',region:[[[NaN,0],[1,0],[0,1]]],inset:1});
  return cases;
}
