import {requireThat} from '../geom/tolerance.mjs';

// One optional control; neither bead width nor extrusion is inferred from a gap.
// Vase turns are vertical layer pitch.
export const SPACING_SKILLS=Object.freeze(['full-fill','planar-infill','draped-skin','supports','rimming-planar','rimming-normal','pipe-cladding']);
export function spacingFactor(settings={}) {
  const factor=settings.spacingFactor===undefined?1:settings.spacingFactor;
  requireThat(Number.isFinite(factor)&&factor>=0.5,'spacingFactor must be a finite number at least 0.5.');
  return factor;
}
export function lineSpacing(widthMm,settings={}) {
  const spacing=widthMm*spacingFactor(settings);
  requireThat(Number.isFinite(widthMm)&&widthMm>0&&Number.isFinite(spacing),'Invalid bead width or derived line spacing.');
  return spacing;
}
