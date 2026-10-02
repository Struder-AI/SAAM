import {requireThat} from '../private/bundle/numeric.mjs';
// Recipe values are authored intent. Installed-device compatibility is checked
// by export; selecting a machine supplies defaults but does not limit geometry.

const common=['tool','core','material','firmwareVersion','nozzleMm','filamentMm','nozzleC','bedC','buildVolumeC','startupVerified','materialGuid'];
const allowed=new Set([...common,'filamentColor','ams','bambu','dobot','denso']);
export function validateRecipeSetup(plan){
  const s=plan.setup;
  requireThat(s&&typeof s==='object'&&!Array.isArray(s)&&common.every(k=>Object.hasOwn(s,k))&&Object.keys(s).every(k=>allowed.has(k)),'Invalid recipe setup fields.');
  requireThat(Number.isSafeInteger(s.tool)&&s.tool>=0,'Tool must be a nonnegative integer.');
  for(const k of ['core','material','firmwareVersion'])requireThat(typeof s[k]==='string',`Setup ${k} must be text.`);
  for(const k of ['nozzleMm','filamentMm'])requireThat(Number.isFinite(s[k])&&s[k]>0,`Setup ${k} must be positive.`);
  for(const k of ['nozzleC','bedC','buildVolumeC'])requireThat(Number.isFinite(s[k])&&s[k]>=0,`Setup ${k} must be nonnegative.`);
  requireThat(typeof s.startupVerified==='boolean'&&(s.materialGuid===null||typeof s.materialGuid==='string'),'Invalid setup identity.');
  requireThat(s.filamentColor==null||/^#[0-9a-f]{6}$/i.test(s.filamentColor),'Filament color must be a six-digit hex color.');
  for(const name of ['bambu','dobot','denso'])if(s[name]!==undefined){
    requireThat(s[name]&&typeof s[name]==='object'&&!Array.isArray(s[name]),`Invalid ${name} configuration fields.`);
  }
  return plan;
}
