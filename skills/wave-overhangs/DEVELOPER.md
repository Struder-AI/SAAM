# Wave research history

The former seeded-domain engine and its tests are retired. Current authoring
uses the shared [edge construction](../../core/print/edge-paths.mjs), also
used by bridging and membranes. This historical research describes the earlier
investigation, not another supported runtime or a dependency.

## Research and license findings

Inspected 2026-09-14 for `remettub`'s request inspired by a YouTube short:

- Janis Andersons, Salomé Sanchez and Tom Vaneker, *Wave-inspired path-planning
  strategy for support-free horizontal overhangs in FDM* (2026).
  [Research dataset](https://data.mendeley.com/datasets/xhw8xkjyc2/1),
  DOI `10.17632/xhw8xkjyc2.1`, describes recursive Huygens-style fronts.
  The dataset is labeled **CC BY 4.0** and includes `wave overhangs.gh`,
  experimental G-code, scan data and a demonstrator. Its description names
  Pufferfish as a dependency of the Grasshopper loop. Those files were not
  incorporated or executed. The SSRN paper entry, DOI `10.2139/ssrn.6640458`,
  was located; access to its full contents was unavailable during this work.
  Follow-up located the published article in *Additive Manufacturing Letters* 18,
  DOI [10.1016/j.addlet.2026.100392](https://doi.org/10.1016/j.addlet.2026.100392),
  and [dataset version 2](https://data.mendeley.com/datasets/xhw8xkjyc2/2).
  Full paper contents remained inaccessible; no claim of a full-paper review.
- [PrusaSlicer WaveOverhangs](https://github.com/stmcculloch/PrusaSlicer-WaveOverhangs)
  credits the researchers and Steven McCulloch's preceding arc-overhang work.
  Its README identifies **AGPL-3.0** licensing.
- [OrcaSlicer WaveOverhangs](https://waveoverhangs.com/) describes the corresponding
  Orca port and publishes examples. Its
  [license file](https://github.com/dennisklappe/OrcaSlicer-WaveOverhangs/blob/main/LICENSE.txt)
  is **AGPL-3.0**. These slicer implementations are references, not dependencies.
- The user supplied Janis Andersons's
  [specific short](https://www.youtube.com/shorts/RxPW5A4__X4), which links to his
  [longer explanation](https://www.youtube.com/watch?v=IhAzIXTE-FE). The title,
  visible playback frames and description establish the intended research;
  a full transcript was unavailable. The author's description links the above
  slicer forks. Their [pattern settings](https://github.com/dennisklappe/OrcaSlicer-WaveOverhangs/blob/main/docs/WAVE_OVERHANG_SETTINGS.md)
  and [traversal implementation](https://github.com/dennisklappe/OrcaSlicer-WaveOverhangs/blob/main/src/libslic3r/WaveOverhangs/WaveOverhangs.cpp)
  permit branch restarts in Zig Zag mode when no short connection is available.
  They do not establish a guaranteed single pass per complete slice or a special
  perpendicular glue-jog procedure. The earlier SAAM perimeter tails were an
  implementation error, not an adopted exemplar behavior.

SAAM's producer and constrained-offset extension are original implementation
under this repository's Apache-2.0 license. No AGPL implementation, Grasshopper
script, research G-code, image or data fixture was copied. The published concept
is credited above. This license check records source terms and the chosen
implementation boundary; it is not a patent clearance investigation.
If a future change incorporates dataset material, preserve attribution, link
the [CC BY 4.0 license](https://creativecommons.org/licenses/by/4.0/), and identify
changes. Incorporating AGPL source requires a separate distribution/licensing
decision; this work does not silently relicense SAAM.
