# Developer measurements

These optional tools exercise shared production operations. They create no print
approvals or machine deliveries. [DEVLOG.md](../../DEVLOG.md) owns historical
results; compare identical inputs and recorded source versions when measuring changes.

The obsolete print/slicing harnesses and their private fixture helper are retired.
Current print checks use the shared Bundle generation, scheduling and export route;
they must not assume a persisted expanded action array.

- [Region kernel verification](region-reference.md) owns intersection and offset
  comparisons against independent references.
- [Surface Boolean measurements](surface-boolean.mjs) and
  [stress examples](surface-boolean-stress.mjs) exercise shared solid operations.
- [Region diagnosis](diagnose-regions.mjs) reads an STL and saves failing numerical
  queries without changing production settings or the original input.
- [Profile summary](profile-summary.mjs) reads saved CPU profiles.
- [Archived slicing reports](report.mjs) formats existing results without generating paths.

Keep generated reports under an ignored workspace directory. Record input and
source hashes, Node/CPU, timing boundaries, wall/CPU time and peak memory. Separate
profiling from timing; failed attempts are not successful performance results.
Measurements do not establish printability or replace Studio review.

See [validation ownership](../../core/print/README.md#validate-at-the-boundary-that-owns-the-data)
and [numerical precision](../../core/geom/README.md#precision-belongs-to-a-quantity-and-an-operation).
