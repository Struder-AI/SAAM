import test from 'node:test';
import assert from 'node:assert/strict';
import {movieTimeline,createMovieWebM,exportMovie} from '../../studio/playback.mjs';
import {createLayerFade,layerKey,LAYER_FADE_MS} from '../../studio/toolpath-view.mjs';

test('movie timing includes the final hold and normal fade, independent of encoder wall time',()=>{
  for(const speed of [1,10,30]){
    const timeline=movieTimeline(1662.12597,speed),fade=createLayerFade();
    assert.ok(Math.abs(timeline.durationSeconds-(1662.12597/speed+2))<2/30);
    assert.equal(timeline.frame(0).seconds,0);
    assert.equal(timeline.frame(timeline.count-1).seconds,1662.12597);
    for(let i=1;i<timeline.count;i++)assert.equal(timeline.frame(i-1).timestamp+timeline.frame(i-1).duration,timeline.frame(i).timestamp);
    const old={phase:'planar',layer:0},current={...old,layer:1};
    fade.frame(old,0);fade.frame(current,timeline.frame(1).now);
    assert.ok(Math.abs(fade.frame(current,timeline.frame(1).now+LAYER_FADE_MS/2).weights.get(layerKey(old))-.5)<1e-9);
    assert.equal(fade.frame(current,timeline.frame(1).now+LAYER_FADE_MS).fading,false);
  }
  assert.throws(()=>movieTimeline(0,10),/toolpath/);
});

// Independent EBML reader verifies lengths and relative seek offsets, including
// clusters crossing the signed 16-bit SimpleBlock timestamp boundary.
function elements(data,start=0,end=data.length){
  const result=[];
  while(start<end){
    const at=start,first=data[start];let idLength=1;while(!(first&(0x80>>(idLength-1))))idLength++;
    let id=0;for(let i=0;i<idLength;i++)id=id*256+data[start++];
    const sizeFirst=data[start++];let length=1;while(!(sizeFirst&(0x80>>(length-1))))length++;
    let size=sizeFirst&((1<<(8-length))-1);for(let i=1;i<length;i++)size=size*256+data[start++];
    assert.ok(start+size<=end);result.push({id,at,start,end:start+size,data:data.subarray(start,start+size)});start+=size;
  }
  assert.equal(start,end);return result;
}
const uint=data=>data.reduce((n,b)=>n*256+b,0);
const chunk=(timestamp,key=true)=>({timestamp,type:key?'key':'delta',byteLength:4,copyTo:target=>target.set([1,2,3,4])});
test('WebM carries duration, dimensions, keyframes and valid seek/cue positions',async()=>{
  const mux=createMovieWebM({width:1280,height:720,codec:'vp09.00.10.08',durationSeconds:40,fps:30});
  for(const [time,key] of [[0,true],[33333,false],[33000000,false],[34000000,true]])mux.add(chunk(time,key));
  const blob=mux.finish();assert.equal(blob.type,'video/webm');
  const data=new Uint8Array(await blob.arrayBuffer()),root=elements(data),segment=root.find(e=>e.id===0x18538067);
  const children=elements(data,segment.start,segment.end),get=id=>children.find(e=>e.id===id);
  const info=elements(get(0x1549a966).data),duration=info.find(e=>e.id===0x4489).data;
  assert.equal(new DataView(duration.buffer,duration.byteOffset,8).getFloat64(0),40000);
  const track=elements(elements(get(0x1654ae6b).data)[0].data);
  assert.equal(new TextDecoder().decode(track.find(e=>e.id===0x86).data),'V_VP9');
  assert.deepEqual(elements(track.find(e=>e.id===0xe0).data).map(e=>uint(e.data)),[1280,720]);
  for(const seek of elements(get(0x114d9b74).data)){
    const fields=elements(seek.data),id=uint(fields.find(e=>e.id===0x53ab).data),offset=uint(fields.find(e=>e.id===0x53ac).data);
    assert.equal(get(id).at-segment.start,offset);
  }
  const clusters=children.filter(e=>e.id===0x1f43b675);assert.equal(clusters.length,3);
  for(const cue of elements(get(0x1c53bb6b).data)){
    const fields=elements(cue.data),pos=elements(fields.find(e=>e.id===0xb7).data).find(e=>e.id===0xf1);
    assert.ok(clusters.some(e=>e.at-segment.start===uint(pos.data)));
  }
  assert.throws(()=>createMovieWebM({width:1,height:1,codec:'vp8',durationSeconds:1}).add(chunk(0,false)),/frame order/);
});

function fakeCodecs({failConfigure=false,failEncode=false,supported=true}={}){
  const frames=[],encoders=[];
  class VideoFrame{
    constructor(canvas,metadata){Object.assign(this,metadata);frames.push(this);}
    close(){this.closed=true;}
  }
  class VideoEncoder{
    static async isConfigSupported(config){return {supported:supported&&config.codec==='vp8'};}
    constructor(callbacks){this.callbacks=callbacks;this.state='unconfigured';encoders.push(this);}
    configure(){if(failConfigure)throw new Error('configuration failed');this.state='configured';}
    encode(frame,{keyFrame}){if(failEncode)throw new Error('encoding failed');this.callbacks.output(chunk(frame.timestamp,keyFrame));}
    async flush(){}
    close(){this.state='closed';}
  }
  return {VideoEncoder,VideoFrame,frames,encoders};
}
test('offline export advances deterministic frames, falls back to VP8, reports progress and closes resources',async()=>{
  const codecs=fakeCodecs(),drawn=[],progress=[];let yields=0;
  const result=await exportMovie({canvas:{width:640,height:480},duration:1,speed:30,...codecs,
    draw:frame=>drawn.push(frame),onProgress:value=>progress.push(value),yieldTask:async()=>{yields++;}});
  assert.equal(result.type,'video/webm');assert.equal(drawn.length,movieTimeline(1,30).count);
  assert.equal(progress.at(-1),1);assert.ok(yields>0);assert.ok(codecs.frames.every(frame=>frame.closed));
  assert.equal(codecs.encoders[0].state,'closed');
});
test('cancel interrupts offline rendering and closes the encoder without a partial download',async()=>{
  const codecs=fakeCodecs(),controller=new AbortController();
  await assert.rejects(exportMovie({canvas:{width:640,height:480},duration:100,speed:1,...codecs,
    signal:controller.signal,draw:()=>{},yieldTask:async()=>controller.abort()}),{name:'AbortError'});
  assert.ok(codecs.frames.length<movieTimeline(100,1).count);assert.equal(codecs.encoders[0].state,'closed');
  assert.ok(codecs.frames.every(frame=>frame.closed));
});
test('movie waits for an asynchronous machine pose before capturing each frame',async()=>{
  const codecs=fakeCodecs();let drawn=0;
  class Frame extends codecs.VideoFrame {constructor(canvas,metadata){assert.equal(drawn,codecs.frames.length+1);super(canvas,metadata);}}
  await exportMovie({canvas:{width:640,height:480},duration:.1,speed:10,...codecs,VideoFrame:Frame,
    draw:async()=>{await Promise.resolve();drawn++;},yieldTask:async()=>{}});
  assert.equal(drawn,codecs.frames.length);
});
test('unsupported codecs and encoder errors are actionable and release frames',async()=>{
  for(const options of [{supported:false},{failConfigure:true},{failEncode:true}]){
    const codecs=fakeCodecs(options);
    await assert.rejects(exportMovie({canvas:{width:640,height:480},duration:1,speed:10,...codecs,draw:()=>{}}),/cannot encode|failed/);
    assert.ok(codecs.encoders.every(encoder=>encoder.state==='closed'));assert.ok(codecs.frames.every(frame=>frame.closed));
  }
});
