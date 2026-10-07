// Display-only aircraft context. Only wingSections enters the print handoff.
export function aircraftContext(d){
  const c=d.chordMm,parts=[],faces=[],rings=[];
  for(const [y,rx,rz,z] of [[-.9,.008,.008,-.09],[-.7,.12,.12,-.07],[-.3,.16,.17,-.03],[.45,.15,.16,-.025],[1.15,.095,.095,-.045],[2.65,.028,.03,-.05],[3.05,.008,.008,-.05]]){
    rings.push(Array.from({length:24},(_,i)=>{const a=i*Math.PI/12;return [c*rx*Math.cos(a),c*y,c*(z+rz*Math.sin(a))];}));
  }
  for(let i=1;i<rings.length;i++)for(let j=0;j<24;j++){const k=(j+1)%24;faces.push([rings[i-1][j],rings[i-1][k],rings[i][k],rings[i][j]]);}
  parts.push({id:'fuselage-context',group:'context',color:'#aeb9bc',faces,lines:[]});
  const tailSpan=d.spanMm*.3,tailY=c*2.4,half=tailSpan/2;
  for(const hand of [-1,1]){
    const root=[[0,tailY,-c*.04],[0,tailY+c*.58,-c*.04]],tip=[[hand*half,tailY+c*.18,-c*.04],[hand*half,tailY+c*.53,-c*.04]];
    const face=[root[0],tip[0],tip[1],root[1]],upper=face.map(p=>[p[0],p[1],p[2]+c*.015]);
    parts.push({id:'tail-context-'+hand,group:'context',color:'#aeb9bc',faces:[face,upper,...face.map((p,i)=>[p,face[(i+1)%4],upper[(i+1)%4],upper[i]])],lines:[[...upper,upper[0]]]});
  }
  const fin=[[0,c*2.3,0],[0,c*2.64,c*.67],[0,c*2.92,c*.55],[0,c*3.02,0]],other=fin.map(p=>[c*.016,p[1],p[2]]);
  parts.push({id:'fin-context',group:'context',color:'#9cabad',faces:[fin,other,...fin.map((p,i)=>[p,fin[(i+1)%4],other[(i+1)%4],other[i]])],lines:[[...other,other[0]]]});
  return parts;
}
