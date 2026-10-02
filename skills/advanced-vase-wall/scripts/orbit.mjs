// Geometry-independent modulation of an already calculated primary spiral.
// No fitted surface, offset-contour repair, or coverage/contact-with-mesh solve.
const TAU=2*Math.PI;
function positive(v,name){if(!Number.isFinite(v)||v<=0)throw new Error(`${name} must be positive.`);}
const length=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
export function orbitSettings({wallWidthMm=2,beadWidthMm=.4,overlap=.5}={}){
  positive(wallWidthMm,'wallWidthMm');positive(beadWidthMm,'beadWidthMm');
  if(wallWidthMm<=beadWidthMm)throw new Error('Loop wall width must exceed bead width.');
  if(!Number.isFinite(overlap)||overlap<0||overlap>=1)throw new Error('Overlap must be in [0,1).');
  const amplitudeMm=(wallWidthMm-beadWidthMm)/2;
  const pitchMm=2*amplitudeMm*(1-overlap),step=TAU/2048;let orbitLengthMm=0;
  for(let i=0;i<2048;i++){const t=(i+.5)*step;orbitLengthMm+=Math.hypot(pitchMm/TAU+amplitudeMm*Math.cos(t),amplitudeMm*Math.sin(t))*step;}
  return {amplitudeMm,pitchMm,overlap,orbitLengthMm,progressRatio:pitchMm/orbitLengthMm};
}
export function orbitPrimaryPath(primary,{wallWidthMm=2,beadWidthMm=.4,speedMmS=40,stepMm=.08,widthAtHeight=null,overlap=.5}={}){
  positive(speedMmS,'speedMmS');positive(stepMm,'stepMm');
  if(!Array.isArray(primary)||primary.length<2||!primary.every(p=>p.length===3&&p.every(Number.isFinite)))throw new Error('Primary path must contain finite XYZ points.');
  const stations=[0];for(let i=1;i<primary.length;i++){const d=length(primary[i],primary[i-1]);if(!d)throw new Error('Primary path contains duplicate points.');stations.push(stations.at(-1)+d);}
  const constant=orbitSettings({wallWidthMm,beadWidthMm,overlap});
  const atWidth=z=>widthAtHeight?{amplitudeMm:(widthAtHeight(z)-beadWidthMm)/2,pitchMm:(widthAtHeight(z)-beadWidthMm)*(1-overlap)}:constant;
  const points=[],timesSeconds=[0];let segment=1,phase=0,lastS=0,previousPitch=null;
  const total=stations.at(-1),count=Math.ceil(total/stepMm);
  for(let n=0;n<=count;n++){
    const s=total*n/count;while(segment<stations.length-1&&stations[segment]<s)segment++;
    const a=primary[segment-1],b=primary[segment],f=(s-stations[segment-1])/(stations[segment]-stations[segment-1]);
    const p=a.map((v,k)=>v+f*(b[k]-v)),dx=b[0]-a[0],dy=b[1]-a[1],h=Math.hypot(dx,dy);if(!h)throw new Error('Primary path needs a nonvertical XY tangent.');
    const cfg=atWidth(p[2]);positive(cfg.amplitudeMm,'amplitudeMm');phase+=TAU*(s-lastS)/((cfg.pitchMm+(previousPitch??cfg.pitchMm))/2);lastS=s;previousPitch=cfg.pitchMm;
    const along=cfg.amplitudeMm*Math.sin(phase),inward=cfg.amplitudeMm*(1-Math.cos(phase));
    // CCW source contour: left XY normal points inward. Z stays the primary
    // spiral's monotonically increasing height, independent of orbital phase.
    points.push([p[0]+along*dx/h-inward*dy/h,p[1]+along*dy/h+inward*dx/h,p[2]]);
    if(n)timesSeconds.push(timesSeconds.at(-1)+length(points[n-1],points[n])/speedMmS);
  }
  return {points,timesSeconds,report:{primaryLengthMm:total,points:points.length,orbits:phase/TAU,durationSeconds:timesSeconds.at(-1),speedMmS,averagePrimarySpeedMmS:total/timesSeconds.at(-1),settings:constant,scope:'Explicit overlap sets pitch; no tangency/contact solve. Curved-path distortions are retained; no mesh fidelity, support or hardware validation.'}};
}
