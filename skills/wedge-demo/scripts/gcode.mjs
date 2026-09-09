// Compatibility entry point; all G-code behavior lives in the shared exporter.
import { VERSION, BUILD_DATE } from './model.mjs';
import { exportGriffin, interpretGriffin } from '../../../core/export/griffin.mjs';
export const exportGcode = (path,plan,machine) => exportGriffin(path,plan,machine,{generatorVersion:VERSION,buildDate:BUILD_DATE});
export const interpretGcode = interpretGriffin;
