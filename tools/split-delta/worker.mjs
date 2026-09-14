import {geometry,assessCylinder,findCylinder} from '/core/machine/split-delta.mjs';
onmessage=({data})=>{
  try{const g=geometry(data.geometry),options={...data.options,spinValues:data.options.spinRangeDeg?[-data.options.spinRangeDeg,0,data.options.spinRangeDeg]:[0]};
    const search=data.search?findCylinder(g,{...options,maxDiameterMm:400,toleranceMm:1}):null;
    if(search)options.diameterMm=search.diameterMm;
    const reserved=search?.assessment??assessCylinder(g,options),operating=assessCylinder(g,{...options,reserve:false,spinValues:data.options.spinRangeDeg?[-data.options.spinRangeDeg,0,data.options.spinRangeDeg]:[0]});
    postMessage({reserved,operating,search});
  }catch(error){postMessage({error:error.message});}
};
