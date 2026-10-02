// Recognition drawings illustrate a family; dimensional captions use catalog evidence.
const drawings={
 'na-wallplate':'toggle','na-screwless':'rocker','na-adorne':'modules',
 'na-square-4':'square','na-square-4-11-16':'square','na-handy':'toggle',
 'uk-86':'square-rocker','uk-146':'double-rocker','uk-architrave':'narrow',
 'au-standard':'small-rockers','au-architrave':'narrow','au-mini-architrave':'narrow',
 'au-intermediate':'narrow','au-large-square':'square-rocker','au-round':'round',
 'eu-system55':'frame','eu-round-box':'box','eu-jung-ls':'frame','eu-niko':'double-frame',
 'eu-simon':'frame','mosaic45':'modules','italy-modular':'box','italy-vimar-plana':'modules',
 'swiss-feller':'frame','denmark-fuga':'narrow-frame','asia-panasonic-a':'small-rockers',
 'asia-panasonic-bs':'square-rocker','asia-avataron':'square-rocker','india-livia':'modules',
 'brazil-pial':'double-modules','south-africa-arteor':'modules','custom-measured':'custom'
};
export function familyVisual(f){
 const d=f.referenceDimensionsMm;
 const outerKeys=['standardOuter','oneGangOuter','twoGangOuter','exampleOuter','example878Outer','example865Outer','onePositionFrameOuter','exampleParitoOuter','example618512Outer','threeModuleOuter'];
 const key=outerKeys.find(k=>Array.isArray(d[k]));
 let size=key?d[key].slice(0,2):null,kind='Plate example';
 if(!size&&d.nominalBoxSide){size=[d.nominalBoxSide,d.nominalBoxSide];kind='Nominal box';}
 if(!size&&d.outerDiameter){size=[d.outerDiameter,d.outerDiameter];kind='Plate diameter';}
 if(!size&&d.historical503EBox){size=d.historical503EBox.slice(0,2).reverse();kind='Historical box';}
 if(!size&&d.functionalModuleFace){size=d.functionalModuleFace;kind='Module face';}
 if(!size&&d.twoModuleFace){size=d.twoModuleFace;kind='Module face';}
 const fmt=n=>Number(n.toFixed(2)).toString();
 const caption=size?(d.outerDiameter?`Ø ${fmt(d.outerDiameter)} mm`:`${fmt(size[0])} × ${fmt(size[1])} mm`):'Dimensions need measurement';
 const fixing=d.boxFixingSeparation??d.fixingSeparation??d.exampleMountingSeparation??d.oneGangFixingSeparation??d.exampleBoxFixingSeparation;
 return {drawing:drawings[f.id]??'custom',size,kind,caption,detail:fixing?`Fixing centers: ${fmt(fixing)} mm`:d.exampleCombinationPitch?`Position spacing: ${fmt(d.exampleCombinationPitch)} mm`:d.exampleWidth?`Published width: ${fmt(d.exampleWidth)} mm`:'Match the original mounting interface'};
}
export function familySVG(f){
 const v=familyVisual(f),aspect=v.size?v.size[0]/v.size[1]:v.drawing.includes('double')||v.drawing==='modules'?1.5:v.drawing==='narrow'||v.drawing==='narrow-frame'?.4:1;
 const w=Math.min(112,92*aspect),h=Math.min(92,112/aspect),x=(160-w)/2,y=(132-h)/2;
 const rect=(a,b,c,d,r=3,cls='opening')=>`<rect x="${a}" y="${b}" width="${c}" height="${d}" rx="${r}" class="${cls}"/>`;
 const hole=(a,b)=>`<circle cx="${a}" cy="${b}" r="2" class="screw"/>`;
 let body=v.drawing==='round'?`<circle cx="80" cy="66" r="42" class="plate"/>`:rect(x,y,w,h,6,'plate');
 const center=(width,height,dx=0)=>rect(80-width/2+dx,66-height/2,width,height);
 if(v.drawing==='toggle'||v.drawing==='narrow')body+=center(w*.18,h*.23)+hole(80,y+h*.22)+hole(80,y+h*.78);
 else if(v.drawing==='mixed')body+=center(w*.13,h*.2,-w*.22)+center(w*.3,h*.57,w*.22)+hole(80-w*.22,y+h*.24)+hole(80-w*.22,y+h*.76)+hole(80+w*.22,y+h*.1)+hole(80+w*.22,y+h*.9);
 else if(['rocker','square-rocker','double-rocker'].includes(v.drawing)){body+=center(w*(v.drawing==='double-rocker'?.28:.5),h*.62,v.drawing==='double-rocker'?-w*.23:0);if(v.drawing==='double-rocker')body+=center(w*.28,h*.62,w*.23);if(f.id!=='na-screwless')body+=hole(x+5,66)+hole(x+w-5,66);}
 else if(v.drawing==='square')body+=center(w*.2,h*.23,-w*.22)+center(w*.2,h*.23,w*.22)+hole(x+7,y+7)+hole(x+w-7,y+h-7);
 else if(v.drawing==='round')body+=center(15,20)+hole(55,66)+hole(105,66);
 else if(v.drawing==='small-rockers')for(let i=0;i<3;i++)body+=rect(80-w*.22,y+h*.18+i*h*.23,w*.44,h*.16);
 else if(v.drawing.includes('frame')){body+=center(w*.68,h*.68);if(v.drawing==='double-frame')body=rect(x,y,w,h,6,'plate')+center(w*.33,h*.65,-w*.22)+center(w*.33,h*.65,w*.22);}
 else if(v.drawing.includes('modules')){for(let row=0;row<(v.drawing==='double-modules'?2:1);row++)for(let i=0;i<3;i++)body+=rect(x+w*.15+i*w*.24,y+h*(row?.57:.23),w*.21,h*.25,2);}
 else if(v.drawing==='box')body=rect(x,y,w,h,5,'box')+rect(x+6,y+6,w-12,h-12,2)+hole(x+3,66)+hole(x+w-3,66);
 else body+=`<text x="80" y="74" text-anchor="middle" class="question">?</text>`;
 const arrows=v.size?`<path d="M${x} ${y+h+9}h${w} M${x} ${y+h+6}v6 M${x+w} ${y+h+6}v6 M${x+w+9} ${y}v${h} M${x+w+6} ${y}h6 M${x+w+6} ${y+h}h6" class="measure"/>`:'';
 return `<svg viewBox="0 0 160 142" aria-hidden="true" focusable="false">${body}${arrows}</svg>`;
}
