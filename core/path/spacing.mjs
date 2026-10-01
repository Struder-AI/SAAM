import {requireThat} from '../private/toolpath/numeric.mjs';


// One optional control; neither bead width nor extrusion is inferred from a gap.
// Which skills take it is catalog metadata (skills/catalog.mjs SPACING_SKILLS).
// Vase turns are vertical layer pitch.
export function spacingFactor(settings={}) {
  const factor=settings.spacingFactor===undefined?1:settings.spacingFactor;
  requireThat(Number.isFinite(factor)&&factor>0,'spacingFactor must be positive and finite.');
  return factor;
}
export function lineSpacing(widthMm,settings={}) {
  const spacing=widthMm*spacingFactor(settings);
  requireThat(Number.isFinite(widthMm)&&widthMm>0&&Number.isFinite(spacing),'Invalid bead width or derived line spacing.');
  return spacing;
}
