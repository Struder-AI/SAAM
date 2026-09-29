import {requireThat} from '../geom/tolerance.mjs';
import {validateSurfaceSelection} from '../geom/surface-region.mjs';
import {CLADDING_PATTERNS} from '../path/surface-courses.mjs';
import {lineSpacing} from '../path/spacing.mjs';

export const CLADDING_DEFAULTS={pattern:'axial-hoop',spacingFactor:1,shells:4,normalMm:.2,tiltDeg:45,sampleStepMm:1,toleranceMm:.01,surface:null,offsetTightness:1};
export const claddingAssignment=({id,...options})=>structuredClone({id,construction:'cladding',part:null,filament:null,process:null,after:[],source:null,...CLADDING_DEFAULTS,...options});

export function validateCladdingAssignment(a,{parts,lineWidthMm=.4}={}){
  requireThat(a&&a.construction==='cladding'&&Object.keys(a).sort().join()===Object.keys(claddingAssignment({id:a.id})).sort().join(),'Invalid cladding assignment fields.');
  requireThat(typeof a.id==='string'&&/^[a-z][a-z0-9-]*$/.test(a.id),'Invalid cladding assignment id.');
  requireThat(a.part===null||parts?.includes(a.part),'Cladding names an unknown part.');
  requireThat(a.filament===null||Number.isInteger(a.filament)&&a.filament>=0,'Cladding filament must be null or a filament index.');
  requireThat(Array.isArray(a.after)&&a.after.every(id=>typeof id==='string'&&id.length),'Cladding after lists operation ids.');
  requireThat(a.source===null||typeof a.source==='string'&&/^[a-z][a-z0-9-]*$/.test(a.source)&&a.source!==a.id,'Cladding source must be null or a separate assignment ID.');
  requireThat(CLADDING_PATTERNS.includes(a.pattern),'Cladding pattern must be axial-hoop or crossed-helices.');
  requireThat(Number.isInteger(a.shells)&&a.shells>0,'Cladding needs a positive whole shell count.');
  for(const key of ['normalMm','sampleStepMm','toleranceMm'])requireThat(Number.isFinite(a[key])&&a[key]>0,`Cladding ${key} must be positive.`);
  requireThat(Number.isFinite(a.offsetTightness)&&a.offsetTightness>=0&&a.offsetTightness<=1,'Cladding offsetTightness must be 0–1.');
  requireThat(Number.isFinite(a.tiltDeg)&&a.tiltDeg>0&&a.tiltDeg<90,'Cladding tilt must be between 0 and 90 degrees from downward.');
  lineSpacing(lineWidthMm,a);validateSurfaceSelection(a.surface);
  requireThat(a.surface.periodicU,'Cladding needs a periodic U surface; open-patch raster coverage is not implemented.');
}
