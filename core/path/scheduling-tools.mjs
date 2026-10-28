// Scheduler resolves logical tool assumptions; selected hardware belongs to Export.
import {DEFAULT_NOZZLE_GEOMETRY} from '../geom/convex-clearance.mjs';
import {requireThat} from '../private/toolpath/numeric.mjs';

export function nozzleType(value){
  requireThat(value&&Number.isFinite(value.includedAngleDeg)&&value.includedAngleDeg>0&&value.includedAngleDeg<180&&
    Number.isFinite(value.tipDiameterMm)&&value.tipDiameterMm>=0,
  'A scheduling nozzle needs an included angle between 0 and 180 degrees and a nonnegative external flat-tip diameter.');
  return {includedAngleDeg:value.includedAngleDeg,tipDiameterMm:value.tipDiameterMm};
}

export function resolveSchedulingTools(source,nozzleTypes={}){
  requireThat(nozzleTypes&&typeof nozzleTypes==='object'&&!Array.isArray(nozzleTypes),'Scheduling nozzleTypes must map logical tool indexes to nozzle geometry.');
  const indexes=sourceToolIndexes(source),resolved={},provenance={};
  const aggregate={includedAngleDeg:0,tipDiameterMm:0};
  for(const index of indexes){
    const supplied=nozzleTypes[index],model=nozzleType(supplied??DEFAULT_NOZZLE_GEOMETRY);
    // Defined data properties preserve ordinary record behavior even for a
    // legacy caller whose index was not admitted as a numeric Paath index.
    Object.defineProperty(resolved,index,{value:model,enumerable:true,writable:true,configurable:true});
    Object.defineProperty(provenance,index,{value:supplied==null?'default':'supplied',enumerable:true,writable:true,configurable:true});
    aggregate.includedAngleDeg=Math.max(aggregate.includedAngleDeg,model.includedAngleDeg);
    aggregate.tipDiameterMm=Math.max(aggregate.tipDiameterMm,model.tipDiameterMm);
  }
  // The aggregate encloses every used model; it does not supply its origin.
  return {default:indexes.length?aggregate:nozzleType(DEFAULT_NOZZLE_GEOMETRY),tools:resolved,provenance};
}

export function nozzleTypesContain(assumed,actual,indexes){
  return Boolean(assumed)&&indexes.every(index=>{
    const expected=assumed.tools?.[index]??assumed.default,selected=actual.tools?.[index]??actual.filaments?.[index]??actual.default;
    return expected&&selected&&selected.includedAngleDeg<=expected.includedAngleDeg&&selected.tipDiameterMm<=expected.tipDiameterMm;
  });
}

export function sourceToolIndexes(source){
  return [...new Set(Object.values(source.operations).map(operation=>operation.toolIndex??operation.filament??source.planning.selection?.filament??0))];
}
