import {requireThat} from '../../../core/geom/tolerance.mjs';

// A bead prints wider than the width it is commanded at, because it is squashed under the nozzle
// and spreads sideways. This is the simplest correction that fits the one physical measurement
// there is: the width-calibration ladder, printed 2026-10-02 on an H2D 0.4 mm nozzle, PLA at
// 215 C, flow limited to 4 mm3/s, layer height half the commanded width. Seven walls, one caliper
// reading each, commanded 0.5 to 3.5 mm, measured 0.65 to 4.39 mm: the excess over the commanded
// width was 0.4 to 0.66 of the layer height (mean 0.565) at every wall.
//
// The ladder cannot tell that apart from "about 30% wider", because its layer height was always
// half the width. They disagree at other proportions. This takes the layer-height reading: spread
// belongs to how hard the bead is squashed, so a thin layer spreads little however wide the bead.
// Filament, temperature, speed and flow all change it, and none has been measured yet.
export const WIDTH_SPREAD_PER_LAYER = 0.565;

// The width to command so the bead prints `printedMm` wide at this layer height.
export function commandedWidthMm(printedMm, layerMm, spreadPerLayer = WIDTH_SPREAD_PER_LAYER) {
  requireThat(printedMm > 0 && layerMm > 0 && spreadPerLayer >= 0, 'A printed width, a layer height and a non-negative spread are needed.');
  const commanded = printedMm - spreadPerLayer * layerMm;
  requireThat(commanded > 0, `A ${printedMm} mm bead cannot be commanded at a ${layerMm} mm layer: the spread alone is wider.`);
  return +commanded.toFixed(4);
}

// What a commanded width is expected to print at.
export const printedWidthMm = (commandedMm, layerMm, spreadPerLayer = WIDTH_SPREAD_PER_LAYER) => +(commandedMm + spreadPerLayer * layerMm).toFixed(4);
