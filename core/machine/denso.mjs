import {requireThat} from '../geom/tolerance.mjs';
import {validatePose} from '../path/pose.mjs';
export function validateDensoConfiguration(plan,{required=false}={}){
  const c=plan.setup.denso;requireThat(c,'Missing DENSO setup.');
  for(const key of ['toolFrame','workFrame','armGroup','figure','extrusionOutput'])
    requireThat(c[key]===null||(Number.isInteger(c[key])&&c[key]>=0),'Invalid DENSO '+key+'.');
  requireThat([7,8].includes(c.rotaryAxis)&&[-1,1].includes(c.rotarySign),'Invalid external rotary axis/sign.');
  requireThat(c.rotaryInterface===null||c.rotaryInterface==='rc8-relative-ex','Only the declared RC8 EX rotary interface is implemented; a separate rotary controller needs its own adapter.');
  for(const key of ['rotaryCenterMm','workOffsetMm','initialPositionMm'])requireThat(Array.isArray(c[key])&&c[key].length===3&&c[key].every(Number.isFinite),'Invalid DENSO '+key+'.');
  for(const key of ['workYawDeg','rotaryZeroDeg'])requireThat(Number.isFinite(c[key]),'Invalid DENSO frame/rotary offset.');
  for(const key of ['retreatMm','transitionSeconds'])requireThat(Number.isFinite(c[key])&&c[key]>0,'Invalid DENSO transition setting.');
  validatePose(c.initialPose);
  requireThat(c.extrusionRateMm3S===null||(Number.isFinite(c.extrusionRateMm3S)&&c.extrusionRateMm3S>0),'Invalid relay rate.');
  requireThat(c.configurationSource===null||(typeof c.configurationSource==='string'&&c.configurationSource.trim()),'Configuration needs a source.');
  requireThat(typeof c.mounting==='string'&&c.mounting.length>0&&c.temperatureControl==='external-preheated','DENSO requires mounting basis and external temperature control.');
  const missing=['configurationSource','toolFrame','workFrame','armGroup','figure','extrusionOutput','extrusionRateMm3S','rotaryInterface'].filter(k=>c[k]===null);
  if(required)requireThat(!missing.length,'DENSO installation is unconfigured; supply '+missing.join(', ')+'. Synthetic setup belongs only in development prints.');
  requireThat(plan.process.retractMm===0&&plan.process.fanPercent===0,'Relay output cannot retract or control a fan.');
  return {configured:!missing.length,missing};
}
