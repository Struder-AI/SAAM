// Periodic tensor-product cubic exterior and an exact rational circular bore.
// The control net describes the substrate/cladding interface, in millimeters.
import {shellFromSurfaces} from './shapes.mjs';
import {assertClosed} from './shell.mjs';
import {requireThat} from './tolerance.mjs';

export function validateSplineTube(g){
  const net=g.controlPoints,nu=net?.length,nv=net?.[0]?.length;
  requireThat(Number.isInteger(nu)&&nu>=8&&nu<=64&&Number.isInteger(nv)&&nv>=4&&nv<=32,'Spline tube needs 8–64 periodic columns and 4–32 vertical control points.');
  requireThat(Number.isFinite(g.innerRadiusMm)&&g.innerRadiusMm>0&&Number.isFinite(g.heightMm)&&g.heightMm>0,'Invalid spline tube bore/height.');
  requireThat(net.every(row=>Array.isArray(row)&&row.length===nv&&row.every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite))),'Spline tube needs a rectangular XYZ control net.');
  // Four consecutive angular columns support each cubic span. Their convex
  // hull stays outside the bore when its projection on the sector bisector
  // exceeds the bore radius. This bounds geometry, not robot clearance.
  requireThat(net.every((row,i)=>row.every(p=>{
    const a=2*Math.PI*i/nu,r=Math.hypot(p[0],p[1]);
    return Math.abs(p[0]-r*Math.cos(a))<1e-7&&Math.abs(p[1]-r*Math.sin(a))<1e-7&&r*Math.cos(3*Math.PI/nu)>g.innerRadiusMm;
  })),'Spline tube angular columns must enclose the circular bore without touching it.');
  // Greville heights make V linear in physical height; arbitrary XYZ skins
  // remain a separate explicit surface-region input, not this shape builder.
  const knots=clampedKnots(nv,3),greville=j=>(knots[j+1]+knots[j+2]+knots[j+3])/3;
  requireThat(net.every(row=>row.every((p,j)=>Math.abs(p[2]-g.heightMm*greville(j))<1e-7)),'Spline tube control heights must follow the clamped cubic Greville grid.');
}
export const clampedKnots=(n,p)=>Array.from({length:n+p+1},(_,i)=>i<=p?0:i>=n?1:(i-p)/(n-p));

export function splineTubeShell(rhino,g){
  validateSplineTube(g);
  const nu=g.controlPoints.length,nv=g.controlPoints[0].length;
  const outer=rhino.NurbsSurface.create(3,false,4,4,nu+3,nv);
  const ku=outer.knotsU(),kv=outer.knotsV(),vKnots=clampedKnots(nv,3);
  for(let i=0;i<nu+5;i++)ku.set(i,i-2);
  for(let i=0;i<nv+2;i++)kv.set(i,vKnots[i+1]);
  for(let i=0;i<nu+3;i++)for(let j=0;j<nv;j++)outer.points().set(i,j,[...g.controlPoints[i%nu][j],1]);
  const circle=z=>{const c=new rhino.Circle(g.innerRadiusMm);const curve=c.toNurbsCurve();curve.translate([0,0,z]);return curve;};
  const bottom=circle(0),top=circle(g.heightMm);
  const ruled=(a,b)=>rhino.NurbsSurface.createRuledSurface(a,b);
  return assertClosed(shellFromSurfaces(rhino,[{name:'outer',surface:outer},
    {name:'bore',surface:ruled(bottom,top)},
    {name:'bottom',surface:ruled(bottom,outer.isoCurve(0,outer.domain(1)[0]))},
    {name:'top',surface:ruled(top,outer.isoCurve(0,outer.domain(1)[1]))}],'spline-tube'));
}
