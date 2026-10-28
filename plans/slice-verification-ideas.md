# Slice verification ideas retained from contract review

These are verification ideas separated from producer statements during the
2026-10-23 review. They are not additional contracts, worker instructions,
implemented checks or the full verification pass.

- **Wall Paath — `slice-walls-masks`:** independently check physical offset and
  surface correspondence, including holes, periodic seams and split/merged or
  collapsed components. A few correct samples do not establish whole-curve
  containment or account for missing paths.
- **Infill Paath — `slice-fill-paath`:** compare the paths with the supplied
  solid/sparse regions and requested physical layout. Include curved surfaces,
  clipped intervals and periodic surface correspondence. Generate the same slice
  in different call orders and compare its geometry and path constraints.
- **Combined Paath — `slice-completed-paath`:** compare the delivered curve
  identities, intervals and attribute values with the wall/infill inputs,
  including wall-only, infill-only and empty results. Check that composition
  preserves unset attributes and defined defaults, and that optional inspection
  does not change the result.
- **Numerical qualification:** distinguish a continuous error bound from sampled
  observations when deciding whether the surface/offset tolerance is established.
  Record the method and unresolved coverage with verification evidence rather
  than requiring a checker report in each path payload.
- **Evidence reuse:** associate evidence with the exact value and contract meaning
  it covers. A changed value may preserve some conclusions and invalidate others;
  a completion receipt or an imported assertion alone does not establish them.
- **Shared wall/interior results:** compare Compose's wall read and each interior
  consumer's read with the producing link's exact result, including zero walls
  and empty infill. A consumer projection must not become another producer.
- **Finished contributions — `finished-construction-paath`:** include a later
  member failing after an earlier member succeeded, a failed hard prerequisite,
  an independent successful operation and a successful empty member. Compare the
  final work and failures with those outcomes; no partial failed operation should
  masquerade as a completed successful one.
- **External equivalence:** for the same captured request, compare numerical work
  with the work supplied to 3.6, including native completions, retained local
  sequences and resolved dependency targets. Numerical calls must complete
  without a scheduling handoff.
