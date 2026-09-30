// Declarative defaults shared by recipe presets and the family producer.
import {requireThat} from '../geom/tolerance.mjs';
export const SLICE_DEFAULTS=Object.freeze({loops:2,fillDensity:.2,fillPattern:'rectilinear',fillAnglesDeg:[45,135],rotateFill:true,solidTop:3,solidBottom:3,fillOverlap:.15,spacingFactor:1,sampleStepMm:.2});
export const SLICE_PRESETS=Object.freeze({brim:{loops:5,fillDensity:0,solidTop:0,solidBottom:0,within:[{kind:'outline'}]},support:{loops:1,fillDensity:.15,fillAnglesDeg:[0,90],solidTop:2,solidBottom:0}});
export function ordinarySliceAssignment({id,part=null,preset=null,...overrides}){
  requireThat(preset===null||Object.hasOwn(SLICE_PRESETS,preset),`Unknown slice preset ${preset}.`);
  return structuredClone({id,part,preset,filament:null,process:null,...SLICE_DEFAULTS,within:[],surface:{kind:'horizontal'},stack:null,join:null,fillOrder:null,contact:null,toolPose:null,
    dependencies:{afterParts:[],beforeParts:[],after:[]},description:'',...(preset?SLICE_PRESETS[preset]:{}),...overrides,...(overrides.toolPose?{toolPose:{alignToSliceNormal:false,...overrides.toolPose}}:{})});
}

// Canonical family drives both generation routing and pre-generation discovery.
export function assignmentFamily(assignment){
  if(assignment.construction==='inject')return 'inject';
  return assignment.construction==='curves'||assignment.construction==='sleeve'&&assignment.pattern!==null?'trace':'slice';
}
