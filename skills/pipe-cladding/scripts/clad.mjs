import {requireThat} from '../../../core/geom/tolerance.mjs';
import {validateSurfaceSelection} from '../../../core/geom/surface-region.mjs';
import {CLADDING_PATTERNS} from './course.mjs';

export const PIPE_CLADDING_DEFAULTS={enabled:false,part:null,pattern:'axial-hoop',spacingFactor:1,shells:4,normalMm:0.2,tiltDeg:45,sampleStepMm:1,toleranceMm:0.01,surface:null,offsetTightness:1};
export function validateCladding(plan,machine){
  const s=plan.skills['pipe-cladding'];
  requireThat(CLADDING_PATTERNS.includes(s.pattern),'Cladding pattern must be axial-hoop or crossed-helices.');
  requireThat(s.part===null||typeof s.part==='string','Cladding part must be null or a component ID.');
  requireThat(typeof s.enabled==='boolean'&&Number.isInteger(s.shells)&&s.shells>0,'Cladding needs a positive integer shell count.');
  for(const k of ['normalMm','sampleStepMm','toleranceMm'])requireThat(Number.isFinite(s[k])&&s[k]>0,'Invalid cladding '+k+'.');
  requireThat(Number.isFinite(s.offsetTightness)&&s.offsetTightness>=0&&s.offsetTightness<=1,'Cladding offsetTightness must be between zero and one.');
  requireThat(Number.isFinite(s.tiltDeg)&&s.tiltDeg>0&&s.tiltDeg<90,'Cladding tilt must be between 0 and 90 degrees from downward.');
  if(s.surface)validateSurfaceSelection(s.surface);
  if(!s.enabled)return;
  requireThat(machine.capabilities?.includes('tool-orientation')&&machine.capabilities?.includes('coordinated-rotary'),'Pipe cladding requires tool orientation and a coordinated rotary.');
  requireThat(s.surface,'Cladding needs an explicit surface selection.');
  requireThat(plan.geometry.shape==='assembly'?plan.geometry.parts.some(part=>part.id===s.part):s.part===null,'Select the printed component whose finished surface will be clad.');
}
