import {ordinate} from './airfoils.mjs';
export const defaults={version:1,name:'Untitled wing',application:'trainer',priority:'balanced',mass:1.2,speed:15,notes:'',foil:'naca2412',span:1200,root:220,taper:.65,sweep:4,dihedral:4,twist:-2,tip:'rounded',tipBuild:'integral',ailerons:true,flaps:false,flapType:'plain',controlChord:.25,deflection:0,tail:'conventional',sparCount:2,sparDiameter:10,reinforcement:'tubes',bond:'glue',mount:'bolts',skin:1.2};
const ranges={mass:[.1,30],speed:[5,70],span:[400,2400],root:[100,450],taper:[.3,1],sweep:[0,25],dihedral:[0,12],twist:[-6,4],controlChord:[.15,.4],deflection:[-25,40],sparCount:[1,3],sparDiameter:[4,20],skin:[.6,3]};
const choices={application:['trainer','glider','aerobatic','flying-wing'],priority:['balanced','slow','endurance','speed'],foil:['naca2412','clarky','sd7037','e205','n0012','s1223'],tip:['square','rounded','tapered','winglet'],tipBuild:['integral','cap','removable'],flapType:['plain','split'],tail:['conventional','v-tail','none'],reinforcement:['tubes','embedded'],bond:['glue','struder'],mount:['bolts','bands','telescopic']};
export function validateDesign(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Choose a wing design JSON object.');
  if(Object.keys(input).some(k=>!Object.hasOwn(defaults,k)))throw Error('Design contains unsupported fields.');
  const d={...defaults,...input};
  if(d.version!==1)throw Error('Unsupported design version.');
  for(const [k,[lo,hi]] of Object.entries(ranges))if(!Number.isFinite(d[k])||d[k]<lo||d[k]>hi)throw Error(`${k} must be between ${lo} and ${hi}.`);
  if(!Number.isInteger(d.sparCount))throw Error('Spar count must be a whole number.');
  for(const [k,values] of Object.entries(choices))if(!values.includes(d[k]))throw Error(`Unsupported ${k}.`);
  for(const k of ['ailerons','flaps'])if(typeof d[k]!=='boolean')throw Error(`Invalid ${k}.`);
  for(const k of ['name','notes'])if(typeof d[k]!=='string'||d[k].length>(k==='name'?100:3000))throw Error(`Invalid ${k}.`);
  return d;
}
const rad=a=>a*Math.PI/180;
export function wingPoint(d,profile,t,x,side,hand=1){
  const chord=d.root*(1-(1-d.taper)*t),angle=rad(d.twist*t);
  const y=(x-.25)*chord,z=ordinate(profile,x,side)*chord;
  return [hand*t*d.span/2,Math.tan(rad(d.sweep))*t*d.span/2+y*Math.cos(angle)-z*Math.sin(angle),Math.tan(rad(d.dihedral))*t*d.span/2+y*Math.sin(angle)+z*Math.cos(angle)];
}
export function buildModel(d,profile,tailProfile){
  d=validateDesign(d);const parts=[],warnings=[];
  const add=(id,group,color,faces,lines=[])=>{parts.push({id,group,color,faces,lines});};
  const box=(id,group,color,p,size)=>{const [x,y,z]=p,[a,b,c]=size;const v=[[x,y,z],[x+a,y,z],[x+a,y+b,z],[x,y+b,z],[x,y,z+c],[x+a,y,z+c],[x+a,y+b,z+c],[x,y+b,z+c]];add(id,group,color,[[0,1,2,3],[4,7,6,5],[0,4,5,1],[1,5,6,2],[2,6,7,3],[3,7,4,0]].map(f=>f.map(i=>v[i])));};
  const tube=(id,group,color,a,b,r,inner=0)=>{
    const axis=b.map((v,i)=>v-a[i]),len=Math.hypot(...axis),w=axis.map(v=>v/len),ref=Math.abs(w[2])<.9?[0,0,1]:[0,1,0];
    const cross=(u,v)=>[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],raw=cross(w,ref),u=raw.map(v=>v/Math.hypot(...raw)),v=cross(w,u);
    const ring=(p,r)=>Array.from({length:12},(_,i)=>p.map((n,k)=>n+r*(u[k]*Math.cos(i*Math.PI/6)+v[k]*Math.sin(i*Math.PI/6))));
    const A=ring(a,r),B=ring(b,r),I=ring(a,inner),J=ring(b,inner),faces=[];
    for(let i=0;i<12;i++){const j=(i+1)%12;faces.push([A[i],A[j],B[j],B[i]]);if(inner){faces.push([I[j],I[i],J[i],J[j]],[A[j],A[i],I[i],I[j]],[B[i],B[j],J[j],J[i]]);}}
    if(!inner)faces.push(A,B);add(id,group,color,faces);
  };
  const shell=[],controlFaces={aileron:[],flap:[]},hingeX=1-d.controlChord;
  const controlKind=t=>d.ailerons&&t>.55&&t<.9?'aileron':d.flaps&&t>.12&&t<.48?'flap':null;
  for(const hand of [-1,1]){
    const shellStart=shell.length;
    const ts=[0,.06,.12,.2,.3,.4,.48,.55,.65,.75,.85,.9,.95,1];
    const xs=[0,.008,.025,.055,.1,.17,.25,.35,.5,.6,hingeX,1].sort((a,b)=>a-b).filter((x,i,a)=>!i||x-a[i-1]>1e-6);
    const point=(t,x,side,kind)=>{
      let p=wingPoint(d,profile,t,x,side,hand);
      if(kind){const h=wingPoint(d,profile,t,hingeX,side,hand),a=rad(d.deflection*(kind==='aileron'?hand:1)),y=p[1]-h[1],z=p[2]-h[2];p=[p[0],h[1]+y*Math.cos(a)-z*Math.sin(a)+.7,h[2]+y*Math.sin(a)+z*Math.cos(a)];}
      return p;
    };
    for(let i=0;i<ts.length-1;i++)for(let j=0;j<xs.length-1;j++)for(const side of ['upper','lower']){
      const [t,T,x,X]=[ts[i],ts[i+1],xs[j],xs[j+1]],kind=x>=hingeX-1e-6?controlKind((t+T)/2):null;
      const moves=kind&&!(kind==='flap'&&d.flapType==='split'&&side==='upper');
      const f=[[t,x],[T,x],[T,X],[t,X]].map(([a,b])=>point(a,b,side,moves?kind:null));
      (moves?controlFaces[kind]:shell).push(f);
    }
    // Inner skin is a preview offset in Z, not a manufacturing shell operation.
    const inner=[];for(const f of shell.slice(shellStart)){const avg=f.reduce((s,p)=>s+p[2],0)/4;inner.push(f.map(p=>[p[0],p[1],p[2]+(avg>Math.tan(rad(d.dihedral))*Math.abs(p[0])?-d.skin:d.skin)]));}
    add(`inner-${hand}`,'interior','#becac7',inner);
    const ribFaces=[],ribLines=[];
    for(const t of [.08,.24,.4,.56,.72,.88]){
      const ring=[...xs.map(x=>wingPoint(d,profile,t,x,'upper',hand)),...xs.toReversed().map(x=>wingPoint(d,profile,t,x,'lower',hand))];
      const center=wingPoint(d,profile,t,.4,'lower',hand);center[2]=(center[2]+wingPoint(d,profile,t,.4,'upper',hand)[2])/2;const small=ring.map(p=>p.map((v,k)=>k===0?v:center[k]+(v-center[k])*.78));
      for(let i=0;i<ring.length;i++){const j=(i+1)%ring.length;ribFaces.push([ring[i],ring[j],small[j],small[i]]);ribLines.push([ring[i],ring[j]],[small[i],small[j]]);}
    }
    add(`ribs-${hand}`,'ribs','#ceb989',ribFaces,ribLines);
    const tipFaces=[],tipLines=[];const tipXs=Array.from({length:31},(_,i)=>i/30);
    const rootRing=[...tipXs.map(x=>wingPoint(d,profile,1,x,'upper',hand)),...tipXs.toReversed().map(x=>wingPoint(d,profile,1,x,'lower',hand))];
    let last=rootRing;
    if(d.tip==='square')tipFaces.push(rootRing);
    else for(let k=1;k<=6;k++){
      const s=k/6,shrink=d.tip==='rounded'?Math.sqrt(Math.max(.002,1-s*s)):d.tip==='tapered'?1-.97*s:1-.45*s;
      const center=wingPoint(d,profile,1,.45,'lower',hand),ring=rootRing.map(p=>[p[0]+hand*(d.tip==='winglet'?22*s:45*s),center[1]+(p[1]-center[1])*shrink,p[2]*(1-s*.3)+(d.tip==='winglet'?110*s:0)]);
      for(let i=0;i<ring.length;i++){const j=(i+1)%ring.length;tipFaces.push([last[i],last[j],ring[j],ring[i]]);}last=ring;
    }
    if(d.tip!=='square')tipFaces.push(last);
    for(let i=0;i<rootRing.length;i++)tipLines.push([rootRing[i],rootRing[(i+1)%rootRing.length]]);
    add(`tip-${hand}`,'skin',d.tipBuild==='integral'?'#d7e3df':'#9eb8b0',tipFaces,d.tipBuild==='integral'?[]:tipLines);
    if(d.tipBuild==='removable')for(const x of [.3,.65]){const p=wingPoint(d,profile,.98,x,'lower',hand);tube(`tip-pin-${hand}-${x}`,'attachment','#df9959',[p[0]-hand*22,p[1],p[2]+5],[p[0]+hand*18,p[1],p[2]+5],2);}
    for(let n=0;n<d.sparCount;n++){
      const x=.26+n*.15,segments=8;
      for(let i=0;i<segments;i++){
        const at=t=>{const u=wingPoint(d,profile,t,x,'upper',hand),l=wingPoint(d,profile,t,x,'lower',hand);return [u[0],u[1],d.reinforcement==='embedded'?u[2]-d.skin-2:(u[2]+l[2])/2];};
        const a=at(i*.93/segments),b=at((i+1)*.93/segments),r=d.reinforcement==='embedded'?2:d.sparDiameter/2;
        tube(`spar-${hand}-${n}-${i}`,'spars','#566e78',a,b,r,d.reinforcement==='tubes'?Math.max(1,r-1.2):0);
      }
      const available=(ordinate(profile,x)-ordinate(profile,x,'lower'))*d.root*d.taper-2*d.skin;
      if(d.reinforcement==='tubes'&&available<d.sparDiameter)warnings.push(`Spar ${n+1}: ${d.sparDiameter} mm tube exceeds about ${available.toFixed(1)} mm tip-section depth. Reduce diameter or revise the section.`);
    }
    for(const [kind,t] of [['aileron',.7],['flap',.3]])if(d[kind==='aileron'?'ailerons':'flaps']){
      const p=wingPoint(d,profile,t,.58,'lower',hand);box(`${kind}-servo-${hand}`,'servos','#d09b56',[p[0]-10,p[1]-8,p[2]+2],[20,23,11]);
      const h=wingPoint(d,profile,t,hingeX+.06,'upper',hand);box(`${kind}-horn-${hand}`,'horns','#ab634c',[h[0]-1.5,h[1],h[2]],[3,9,14]);
      tube(`${kind}-link-${hand}`,'horns','#b47b4b',[p[0],p[1]+14,p[2]+13],[h[0],h[1]+5,h[2]+11],1);
      for(const dt of [-.065,.065]){const a=wingPoint(d,profile,t+dt,hingeX,'upper',hand);tube(`${kind}-hinge-${hand}-${dt}`,'hinges','#dba460',[a[0]-7,a[1],a[2]],[a[0]+7,a[1],a[2]],2);}
    }
  }
  add('wing-skin','skin','#d7e3df',shell);add('ailerons','controls','#7eaaa0',controlFaces.aileron);add('flaps','controls','#d4ad6b',controlFaces.flap);
  box('fuselage-reference','reference','#b5b9b5',[-28,-35,-55],[56,d.root*2.5,44]);
  if(d.mount==='bolts')for(const x of [-20,20])for(const y of [0,d.root*.5]){tube(`bolt-${x}-${y}`,'attachment','#bf8547',[x,y,-40],[x,y,15],3);box(`pad-${x}-${y}`,'attachment','#d3b889',[x-10,y-10,-8],[20,20,8]);}
  if(d.mount==='bands')for(const x of [-20,20]){tube(`band-${x}`,'attachment','#b1864c',[x,-25,12],[x,d.root*.72,14],2);tube(`peg-${x}`,'attachment','#785b3e',[-52,x<0?-25:d.root*.72,-8],[52,x<0?-25:d.root*.72,-8],4);}
  if(d.mount==='telescopic')for(const y of [d.root*.08,d.root*.38]){tube(`joiner-${y}`,'attachment','#be8a52',[-150,y,0],[150,y,0],d.sparDiameter/2,Math.max(1,d.sparDiameter/2-1));tube(`socket-${y}`,'attachment','#d5b484',[-60,y,0],[60,y,0],d.sparDiameter/2+2,d.sparDiameter/2+.3);}
  if(d.mount==='telescopic'&&(d.sweep>8||d.dihedral>4))warnings.push('Straight joiners retain zero sweep. Check seating and insertion clearance against this swept / dihedral wing.');
  if(d.bond==='struder')warnings.push('Struder welding is recorded as design intent; no welding toolpath or bond strength is established.');
  if(d.tail!=='none'){
    const tailFaces=[],elevators=[];for(const hand of [-1,1])for(let i=0;i<8;i++)for(let j=0;j<10;j++)for(const side of ['upper','lower']){
      const p=(t,x)=>{const q=wingPoint({...d,span:d.span*.34,root:d.root*.48,taper:.65,sweep:8,dihedral:d.tail==='v-tail'?35:0,twist:0},tailProfile,t,x,side,hand);return [q[0],q[1]+d.root*2.1,q[2]+5];};
      (j>=7?elevators:tailFaces).push([[i/8,j/10],[(i+1)/8,j/10],[(i+1)/8,(j+1)/10],[i/8,(j+1)/10]].map(([t,x])=>p(t,x)));
    }
    add('tail','skin','#c2d4ce',tailFaces);add('elevators','controls','#7eaaa0',elevators);
    if(d.tail==='conventional'){
      const y=d.root*2.05,z=d.root*.55;add('fin','skin','#c2d4ce',[[[0,y,0],[0,y+50,z],[0,y+105,z],[0,y+120,0]]]);add('rudder','controls','#7eaaa0',[[[0,y+105,z],[0,y+135,z],[0,y+160,0],[0,y+120,0]]]);
    }
  }
  if(d.application==='flying-wing'&&d.tail!=='none')warnings.push('Your brief says flying wing, but a tail is still present. Choose “No tail” if that is the intended configuration.');
  const vertices=parts.flatMap(p=>p.faces.flat()),bounds={min:[0,1,2].map(k=>Math.min(...vertices.map(p=>p[k]))),max:[0,1,2].map(k=>Math.max(...vertices.map(p=>p[k])))};
  return {parts,bounds,warnings:[...new Set(warnings)]};
}
