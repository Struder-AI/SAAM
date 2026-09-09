import { VERSION, distance, requireThat, validatePlan, wedgeMesh } from './model.mjs';

export function generatePath(plan, machine) {
  validatePlan(plan, machine);
  const {geometry:g, placement:o, process:p, setup:s} = plan;
  // zAfterPrimeMm was recorded in pre-0.2.3 bundle snapshots.  It remains a
  // compatible read only; the current machine contract no longer primes or
  // levels as part of every job.
  const startupZ=machine.startup.zAfterStartupMm??machine.startup.zAfterPrimeMm;
  requireThat(Number.isFinite(startupZ), 'Machine startup Z is required.');
  const angle = g.angleDeg*Math.PI/180, slope=Math.tan(angle), cosine=Math.cos(angle);
  const skinZ=p.skinNormalMm/cosine, coreBase=g.baseMm-p.skinLayers*skinZ, w=p.lineWidthMm;
  const partMaxZ=wedgeMesh(g).vertices.reduce((z,v)=>Math.max(z,v[2]),0);
  const clearanceZ=partMaxZ+p.liftMm;
  const actions=[];
  // A completed SAAM wedge leaves this amount retracted.  Begin the next job
  // from that state, so its first recovery cancels it instead of retracting a
  // second time before the first deposited line.
  let position=[...machine.tools[s.tool].startupXY, startupZ], high=0, retracted=p.startupRetracted;
  const start=[...position];
  const world=q=>[o.xMm+q[0],o.yMm+q[1],q[2]];
  let phase='prime', layer=0, layerSeconds=0;
  function move(to, speed, volume=0, extra={}) {
    const length=distance(position,to);
    if (length<1e-8) return;
    if (volume>0) speed=Math.min(speed, p.maxFlowMm3S*length/volume);
    const dz=Math.abs(to[2]-position[2]);
    if (dz>0) speed=Math.min(speed,p.zSpeedMmS*length/dz);
    actions.push({kind:'move',to:[...to],speedMmS:speed,volumeMm3:volume,phase,layer,...extra});
    layerSeconds+=length/speed;
    if(volume>0) high=Math.max(high,to[2],position[2]);
    position=[...to];
  }
  function retract() {
    if(!retracted && p.retractMm>0) {actions.push({kind:'retract',filamentMm:p.retractMm,speedMmS:p.retractSpeedMmS,phase,layer});retracted=true;}
  }
  function recover() {
    if(retracted) {actions.push({kind:'recover',filamentMm:p.retractMm,speedMmS:p.retractSpeedMmS,phase,layer});retracted=false;}
  }
  function travel(q) {
    const target=world(q), span=distance(position,target);
    // Stay down for nearby starts. The bounded wedge's planar and adjacent
    // sloped strokes are over material, so a direct combed move avoids a
    // retract/lift/recover cycle and its associated seam.
    if(!retracted&&span>1e-8&&span<=p.combTravelMm) {move(target,p.travelSpeedMmS,0,{travel:'combed'});return;}
    retract();
    // Fixed profile clearance above the complete native wedge, even on layer 1.
    const z=clearanceZ;
    move([position[0],position[1],z],p.zSpeedMmS);
    move([target[0],target[1],z],p.travelSpeedMmS);
    move(target,p.zSpeedMmS); recover();
  }
  function line(points,height,speed,role='fill') {
    travel(points[0]);
    for(const q of points.slice(1)) {const to=world(q);move(to,speed,distance(position,to)*w*height,{role});}
  }
  function finishLayer() {
    if(layerSeconds<p.minimumLayerSeconds) {
      retract(); move([position[0],position[1],clearanceZ],p.zSpeedMmS);
      const remaining=p.minimumLayerSeconds-layerSeconds;
      if(remaining>0) actions.push({kind:'dwell',seconds:remaining,phase,layer});
    }
    layerSeconds=0;
  }
  actions.push({kind:'fan',percent:0,phase,layer});
  line([[0,-4,p.firstLayerMm],[g.runMm,-4,p.firstLayerMm]],p.firstLayerMm,p.firstLayerSpeedMmS);
  phase='planar';
  const zs=[];
  for(let i=0;;i++) {
    const z=p.firstLayerMm+i*p.layerMm;
    if(z>coreBase+(g.runMm-w)*slope+1e-9) break;
    zs.push(z);
  }
  for(const [index,z] of zs.entries()) {
    layer=index; const h=index===0?p.firstLayerMm:p.layerMm;
    const speed=index===0?p.firstLayerSpeedMmS:p.planarSpeedMmS;
    if(index===1) actions.push({kind:'fan',percent:p.fanPercent,phase,layer});
    const left=Math.max(0,(z-coreBase)/slope), a=left+w/2, b=g.runMm-w/2, low=w/2, top=g.widthMm-w/2;
    if(b-a<1e-8) {const points=[[a,low,z],[a,top,z]];line(index%2?points.reverse():points,h,speed);finishLayer();continue;}
    const strokes=[{role:'perimeter',points:[[a,low,z],[b,low,z],[b,top,z],[a,top,z],[a,low,z]]}];
    const insideA=a+w, insideB=b-w, y0=low+w, y1=top-w;
    if(insideB>=insideA) {
      const intervals=Math.max(1,Math.ceil((insideB-insideA)/w)), points=[];
      for(let j=0;j<=intervals;j++) {
        const x=insideA+(insideB-insideA)*j/intervals;
        points.push([x,j%2?y1:y0,z],[x,j%2?y0:y1,z]);
      }
      strokes.push({role:'fill',points});
    }
    // Reverse the complete course on odd layers: start near the previous
    // course's end, reverse fill traversal and reverse perimeter winding.
    if(index%2){strokes.reverse();for(const stroke of strokes)stroke.points.reverse();}
    for(const stroke of strokes)line(stroke.points,h,speed,stroke.role);
    finishLayer();
  }
  const substrateHeight=x=>{
    // Use the downhill bead edge to account for finite-width perimeter support.
    const target=coreBase+Math.max(0,x-w/2)*slope;
    if(target<p.firstLayerMm) return 0;
    return p.firstLayerMm+Math.floor((target-p.firstLayerMm+1e-9)/p.layerMm)*p.layerMm;
  };
  const transitionGaps=[];
  phase='inclined';
  const rows=Math.max(2,Math.round(g.widthMm/w));
  const spacing=g.widthMm/rows;
  // Include every substrate step in the first skin's extrusion integration.
  const x0=w/2, x1=g.runMm-w/2;
  const breaks=[x0,x1];
  for(const z of zs) {
    const x=(z-coreBase)/slope+w/2;
    if(x>x0+1e-8 && x<x1-1e-8) breaks.push(x);
  }
  breaks.sort((a,b)=>a-b);
  function sampledXs(start) {
    const nodes=[start,...breaks.filter(x=>x>start+1e-8&&x<x1-1e-8),x1].sort((a,b)=>a-b);
    const xs=[];
    for(let i=0;i<nodes.length-1;i++) {
      const count=Math.max(1,Math.ceil((nodes[i+1]-nodes[i])/0.5));
      for(let j=0;j<count;j++) xs.push(nodes[i]+(nodes[i+1]-nodes[i])*j/count);
    }
    xs.push(x1);return xs;
  }
  for(let k=1;k<=p.skinLayers;k++) {
    layer=zs.length+k-1;
    const zAt=x=>coreBase+k*skinZ+x*slope;
    // A thin downhill end cannot hold every inner skin below the final
    // surface. Start each skin where it reaches first-layer height; later
    // skins therefore extend farther downhill than the earliest ones.
    const startX=Math.max(x0,(p.firstLayerMm-coreBase-k*skinZ)/slope);
    if(startX>=x1-1e-8) continue;
    const xs=sampledXs(startX);
    for(let row=0;row<rows;row++) {
      const y=spacing*((k%2?row:rows-1-row)+0.5);
      const stroke=(k-1)*rows+row;
      const rowXs=stroke%2?[...xs].reverse():xs;
      travel([rowXs[0],y,zAt(rowXs[0])]);
      for(let i=1;i<rowXs.length;i++) {
        const mid=(rowXs[i-1]+rowXs[i])/2;
        const gap=k===1?zAt(mid)-substrateHeight(mid):skinZ;
        requireThat(gap>0 && gap<=skinZ+p.layerMm+w*slope/2+1e-6, 'Transition gap exceeds the substrate model.');
        if(k===1) transitionGaps.push(gap);
        const to=world([rowXs[i],y,zAt(rowXs[i])]);
        // Rectangular bead approximation: true 3D length times normal gap.
        // The first gap varies above the stairs; later skins are parallel.
        const volume=distance(position,to)*spacing*gap*cosine;
        move(to,p.skinSpeedMmS,volume,{gapMm:gap,normalHeightMm:gap*cosine,stroke});
      }
    }
    finishLayer();
  }
  phase='finish';retract();move([position[0],position[1],clearanceZ],p.zSpeedMmS);
  actions.push({kind:'fan',percent:0,phase,layer});
  return {schema:'saampath/1',generatorVersion:VERSION,units:'mm',materialUnits:'mm3',initialPosition:start,
    actions,summary:{planarLayers:zs.length,skinLayers:p.skinLayers,skinRows:rows,clearanceZMm:clearanceZ,
      minTransitionGapMm:transitionGaps.reduce((a,b)=>Math.min(a,b),Infinity),maxTransitionGapMm:transitionGaps.reduce((a,b)=>Math.max(a,b),-Infinity),
      clearance:'operator responsibility; not checked',physicalValidation:'not performed'}};
}
