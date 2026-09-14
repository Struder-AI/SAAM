import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjection} from '../../studio/camera.mjs';
import {toolpathStyle,CURRENT_LAYER_GAP_MM} from '../../studio/toolpath-view.mjs';
test('pan translates screen positions without changing depth or scale at every camera angle',()=>{
  for(const [yaw,tilt] of [[-.78,.62],[0,0],[0,Math.PI/2]])for(const zoom of [.08,1,4]){
    const bounds={min:[-4,2,0],max:[40,60,100]},base=createProjection(bounds,600,400,yaw,tilt,zoom);
    const panned=createProjection(bounds,600,400,yaw,tilt,zoom,[120,-85]);
    assert.equal(base.pixelsPerMm,panned.pixelsPerMm);
    for(const p of [bounds.min,bounds.max,[0,0,0]]){
      const a=base(p),b=panned(p);assert.ok(Math.abs(b[0]-a[0]-120)<1e-9);assert.ok(Math.abs(b[1]-a[1]+85)<1e-9);assert.equal(b[2],a[2]);
    }
  }
});
test('deposited stroke width uses the same millimeter scale as positions at every zoom and viewport size',()=>{
  const bounds={min:[0,0,0],max:[20,20,12]},current={layer:1,phase:'planar',extruding:true};
  for(const [width,height] of [[527,401],[1054,802]])for(const zoom of [.08,1,2,4])for(const lineWidthMm of [.3,.4,.8]){
    const project=createProjection(bounds,width,height,0,Math.PI/2,zoom),scale={lineWidthMm,pixelsPerMm:project.pixelsPerMm};
    const beadPixels=project([lineWidthMm,0,0])[0]-project([0,0,0])[0];
    const activeStyle=toolpathStyle(current,current,'planar',undefined,scale);
    assert.ok(Math.abs(beadPixels-activeStyle.width-CURRENT_LAYER_GAP_MM*project.pixelsPerMm)<1e-10,'current tracks leave a zoom-scaled 0.04 mm display gap at nominal spacing');
    for(const emphasis of [0,.5,1]){
      const style=toolpathStyle({...current,layer:0},current,'planar',emphasis,scale);
      assert.ok(Math.abs(style.width-beadPixels)<1e-10,'line width and geometry use the identical scale, even below one pixel');
    }
    assert.equal(toolpathStyle({...current,extruding:false},current,'planar',0,scale).width,.85,'travel is a guide, not deposited material');
    const doubled=createProjection(bounds,width,height,0,Math.PI/2,zoom*2);
    assert.equal(doubled.pixelsPerMm,project.pixelsPerMm*2);
  }
});
test('top and front views use right-handed machine axes and correct face depth',()=>{
  const bounds={min:[0,0,0],max:[30,20,10]};
  const top=createProjection(bounds,600,400,0,Math.PI/2,1),origin=top([0,0,0]);
  assert.ok(top([5,0,0])[0]>origin[0],'+X points right');
  assert.ok(top([0,5,0])[1]<origin[1],'+Y points toward the back of the bed');
  assert.ok(top([0,0,5])[2]>origin[2],'roof drawn in front of base');
  const front=createProjection(bounds,600,400,0,0,1),o=front([0,0,0]);
  assert.ok(front([0,0,5])[1]<o[1],'+Z points up');
  assert.ok(front([0,5,0])[2]<o[2],'back face drawn behind front face');
});
test('orthographic edges retain their size regardless of depth',()=>{
  for(const [yaw,tilt] of [[-.78,.62],[0,0],[0,Math.PI/2],[1.6,-1.4]]){
    const project=createProjection({min:[0,0,0],max:[30,20,10]},600,400,yaw,tilt,1);
    for(const edge of [[5,0,0],[0,5,0],[0,0,5]]){
      const base=project(edge).map((v,i)=>v-project([0,0,0])[i]);
      for(const offset of [[0,0,100],[40,-20,30]]){
        const start=project(offset),end=project(edge.map((v,i)=>v+offset[i]));
        base.forEach((v,i)=>assert.ok(Math.abs(end[i]-start[i]-v)<1e-9));
      }
    }
  }
});
