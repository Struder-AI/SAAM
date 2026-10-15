// Cover choices and fit constraints belong to this workspace; dimensions are mm.
export const initialDesign={schema:'saam-switch-cover/1',country:'US',familyId:'na-wallplate',installation:'flush',coverage:'standard',width:115.8875,height:114.3,pitch:46.0375,thickness:3,cornerRadius:4,rearPocketDepth:1.2,rimWidth:4,screwDiameter:3.6,screwHeadDiameter:6.5,countersinkDepth:1,labelSize:7,reliefDepth:0.6,treatment:'raised',faceOrientation:'up',plateColor:'#eee5d7',textColor:'#334d43',decorationPrompt:'',decoration:[],devices:[{kind:'toggle',width:10.31,height:23.8,screwPitch:60.325,label:'LIGHTS',labelPosition:'bottom'},{kind:'toggle',width:10.31,height:23.8,screwPitch:60.325,label:'PORCH',labelPosition:'bottom'}]};
export function requireCover(condition,message){if(!condition)throw Error(message);}
function range(value,min,max,name){requireCover(Number.isFinite(value)&&value>=min&&value<=max,`${name} must be ${min}–${max} mm.`);}
export function normalizeDesign(input){
  requireCover(input?.schema===initialDesign.schema,'Unsupported design format.');
  const d=structuredClone(input);d.faceOrientation??=['raised','two-color'].includes(d.treatment)?'up':'down';
  requireCover(['up','down'].includes(d.faceOrientation),'Choose face up or face down.');
  if(['raised','two-color'].includes(d.treatment))d.faceOrientation='up';
  requireCover(['flush','surface-device-box','surface-square-overlay'].includes(d.installation),'Choose a recessed box, surface device box or square-box overlay.');
  requireCover(['raised','recessed','two-color','two-color-flush'].includes(d.treatment),'Unknown lettering treatment.');
  requireCover(typeof d.country==='string'&&typeof d.familyId==='string','Select a location and cover family.');
  requireCover(Array.isArray(d.devices)&&d.devices.length>=1&&d.devices.length<=6,'Choose 1–6 positions.');
  for(const [key,min,max] of [['width',35,340],['height',50,300],['pitch',20,100],['thickness',2,8],['cornerRadius',0,15],['rearPocketDepth',0,4],['rimWidth',2,12],['screwDiameter',2,8],['screwHeadDiameter',3,12],['countersinkDepth',0,3],['labelSize',4,20],['reliefDepth',0.2,2]])range(d[key],min,max,key);
  requireCover(d.cornerRadius<Math.min(d.width,d.height)/2,'Corner radius exceeds the plate.');
  requireCover(d.rearPocketDepth+d.countersinkDepth<d.thickness-0.4,'Rear pocket and countersink leave too little material.');
  requireCover(d.reliefDepth<d.thickness-d.rearPocketDepth-0.5,'Letter recess must preserve the plate face.');
  requireCover(d.screwHeadDiameter>=d.screwDiameter,'Screw head diameter must exceed hole diameter.');
  for(const device of d.devices){
    requireCover(['toggle','rocker','blank','custom'].includes(device.kind),'Unknown opening type.');
    range(device.width,3,80,'Opening width');range(device.height,3,100,'Opening height');range(device.screwPitch,15,160,'Screw spacing');
    requireCover(typeof device.label==='string'&&device.label.length<=80,'Labels must be at most 80 characters.');
    requireCover(['top','bottom'].includes(device.labelPosition),'Choose top or bottom labels.');
  }
  requireCover(/^#[a-f0-9]{6}$/i.test(d.plateColor)&&/^#[a-f0-9]{6}$/i.test(d.textColor),'Choose valid colors.');
  requireCover(typeof d.decorationPrompt==='string'&&d.decorationPrompt.length<=4000,'Decoration request is too long.');
  requireCover(Array.isArray(d.decoration)&&d.decoration.length<=40,'Decoration supports up to 40 motifs.');
  for(const m of d.decoration){
    requireCover(['circle','diamond','stripe'].includes(m.shape),'Unknown motif shape.');range(m.x,0,d.width,'Motif X');range(m.y,0,d.height,'Motif Y');range(m.size,0.8,20,'Motif size');range(m.depth,0.2,1,'Motif depth');
    requireCover(m.depth<d.thickness-d.rearPocketDepth-0.5,'Motif recess leaves too little face material.');requireCover(['raised','recessed'].includes(m.mode),'Unknown motif relief.');
  }
  fitLayout(d);return d;
}
export function layout(d){return d.devices.map((v,i)=>({...v,x:d.width/2+(i-(d.devices.length-1)/2)*d.pitch,y:d.height/2}));}
export function overlaps(a,b,pad=0){return a[0]<b[2]+pad&&a[2]>b[0]-pad&&a[1]<b[3]+pad&&a[3]>b[1]-pad;}
export function fitLayout(d){
  const slots=layout(d),holes=[],openings=[];
  for(const s of slots){
    if(s.kind!=='blank')openings.push([s.x-s.width/2,s.y-s.height/2,s.x+s.width/2,s.y+s.height/2]);
    for(const y of [s.y-s.screwPitch/2,s.y+s.screwPitch/2])holes.push([s.x-d.screwHeadDiameter/2,y-d.screwHeadDiameter/2,s.x+d.screwHeadDiameter/2,y+d.screwHeadDiameter/2]);
  }
  const protectedRects=[...openings,...holes];
  for(const r of protectedRects)requireCover(r[0]>=2&&r[1]>=2&&r[2]<=d.width-2&&r[3]<=d.height-2,'Openings or screws fall too close to an edge; increase plate size or correct measurements.');
  for(let i=0;i<protectedRects.length;i++)for(let j=i+1;j<protectedRects.length;j++)requireCover(!overlaps(protectedRects[i],protectedRects[j],0.7),'Openings and screw heads overlap; correct dimensions or spacing.');
  return {slots,protectedRects};
}
