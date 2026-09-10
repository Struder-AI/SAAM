import fs from 'node:fs';

const rect=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
const star=(cx,cy,r,n,phase=0)=>Array.from({length:n*2},(_,i)=>{
  const a=phase+i*Math.PI/n,d=i%2?r/2:r;return[cx+d*Math.cos(a),cy+d*Math.sin(a)];
});
const pairs=[
  {name:'nested',a:[rect(0,0,24,24),rect(4,4,16,16).reverse(),rect(8,8,8,8)],b:[rect(2,-1,12,26)]},
  {name:'shared-edge',a:[rect(0,0,10,10)],b:[rect(10,0,10,10)]},
  {name:'point-touch',a:[rect(0,0,10,10)],b:[rect(10,10,10,10)]},
  {name:'empty',a:[rect(0,0,10,10)],b:[]},
  {name:'coincident',a:[rect(0,0,10,10)],b:[rect(0,0,10,10)]},
  {name:'sliver',a:[rect(0,0,10,10)],b:[rect(10-1e-8,0,10,10)]},
  ...Array.from({length:30},(_,i)=>({name:`stars-${i}`,a:[star(0,0,10,5+i%7,i/7)],b:[star(3+i/10,2,8,7+i%5,-i/5)]})),
  ...Array.from({length:9},(_,i)=>({name:`near-parallel-${i}`,a:[rect(0,0,10,2)],b:[[[-1,-(2**(-i*4))],[11,2**(-i*4)],[11,3],[-1,3]]]})),
  {name:'rhino-stl',...JSON.parse(fs.readFileSync(new URL('../../core/tests/fixtures/intersection-stl.json',import.meta.url)))}
];
export const intersectionFixtures=pairs.flatMap(({name,a,b})=>['intersect','union','difference'].map(operation=>({
  name:`${name}-${operation}`,a,b,operation,precisionMm:1e-9
})));
