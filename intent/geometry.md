# Geometry

Authoring, representations, Booleans, offsets, import and repair. [Index](README.md)

## Geometry is authored
> "SAAM is supposed to create geometry in three ways … as the web-agent-compatible route, the manual authoring should be the main tool that SAAM is built around"; "There are to be zero templated shapes" — owner, 2026-09-27 ([D-040](../DECISIONS.md#d-040--geometry-is-authored-spline-patches-meshes-and-blob-fields))
>
> "We shouldn't need predefined splineBlock/splineBox/splineTube templates" — owner, 2026-09-28 ([D-040](../DECISIONS.md#d-040--geometry-is-authored-spline-patches-meshes-and-blob-fields))

Summary: agents author geometry directly as spline patches, meshes or blob fields (scripts may compute them); there are no templated shapes, and a tool earns its place only when authoring cannot reasonably do the job ("not even a revolve tool").

Sources: [D-040](../DECISIONS.md#d-040--geometry-is-authored-spline-patches-meshes-and-blob-fields); [0.2.0 Settled intent](../plans/0.2.0.md#settled-intent) ("Defaults contain process/setup, not a starter shape"); [GEOMETRY.md](../GEOMETRY.md).

## Blob fields
> "A field built from freely placed points … like metaballs with spline falloff" — owner, 2026-09-28 ([D-040](../DECISIONS.md#d-040--geometry-is-authored-spline-patches-meshes-and-blob-fields))

Summary: a blob field sums spline falloffs from freely placed points, is cut flat at Z = 0, extracts to a mesh and keeps its editable source.

Sources: [D-040](../DECISIONS.md#d-040--geometry-is-authored-spline-patches-meshes-and-blob-fields); [0.2.0 Settled intent](../plans/0.2.0.md#settled-intent); [0.3.6 mesh repair row](../plans/0.3.6.md) (blob field ships in 0.3.6).

## Mesh and spline backends
> "It makes more sense to have mesh be the native format (decision change)" — owner, 2026-09-09 ([D-021](../DECISIONS.md#d-021--native-mesh-geometry)); "Yes—support both backends"

Summary: mesh is the default imported-part format and spline geometry is sliced directly; both sit behind the same geometry interface (supersedes Rhino/3DM as native format, [D-020](../DECISIONS.md#d-020--rhino-geometry)).

Sources: [D-021](../DECISIONS.md#d-021--native-mesh-geometry).

## Geometry owns construction; extensions ask for ordinary geometry
> "Item 5 is now approved: move native solid-library management behind Geometry's public operations. Migrate current consumers such as heat-set inserts, text and gridfinity so they request ordinary geometric construction, transformation and booleans instead of managing kernel objects, conversions and disposal. Keep feature-specific decisions in the extensions. Remove the superseded plumbing rather than adding wrappers around each extension's implementation." — owner, 2026-10-01 (Codex 01a0f76d 12:32)
>
> "So not just grouping existing geometry consumers, but also thinking about whether consumers could switch to merged or generalized output wires." — owner, 2026-10-01 (Codex 01a0f748 11:45)

Summary: Geometry owns construction, numerical representation and native lifetime behind a small public interface designed from what its consumers need; extensions keep only their feature decisions.

Sources: Codex 01a0f748, 01a0f76d; [0.3.1 component 2](../plans/0.3.1.md) (agent wording); owner's guidance prompt 2026-10-02.

## Boundaries are curves; no trimmed surfaces without a consumer
> "Yeah I like making boundaries ordinary curves … We don't have trimmed surface support, what consumer uses trimmed surfaces? Make sure you aren't suggesting anything that no one is actually using." — owner, 2026-10-01 (Codex 01a0f755 12:20)
>
> "That's bad bundling. And I think the backend does need to represent trimmed surfaces." — owner, 2026-09-28 ([D-041](../DECISIONS.md#d-041--offsets-resolve-collisions-ribbons-displace-without-a-surface))

Summary: boundaries are ordinary curves and SAAM adds no trimmed-surface support until a consumer needs it; the 09-28 need came from ribbons, which were then cut, and joined trimmed-face solids remain 0.4.0 intent.

Sources: Codex 01a0f755, 01a0f76d ("do not introduce trimmed-surface support"); [D-041](../DECISIONS.md#d-041--offsets-resolve-collisions-ribbons-displace-without-a-surface); [0.4.0 "Joined trimmed-face solids"](../plans/0.4.0.md).

## One offset; no ribbons
> "ALL of our offsets need this behavior." — owner, 2026-09-28; "There's no such thing as a surface ribbon"; "I don't even think we need ribbons … We probably cut ribbons entirely to avoid confusion" ([D-041](../DECISIONS.md#d-041--offsets-resolve-collisions-ribbons-displace-without-a-surface))
>
> "I want "offset(region,distance)" to have a better name that specifies the planar nature." … "We need to keep offset of a curve on a spline, nonplanar, surface." — owner, 2026-10-01 (Codex 01a0f5e7 07:39)
>
> "curveToPolyline sounds like a bad idea to me. This just duplicates behavior that slicing does later" — owner, 2026-10-01 (Codex 01a0f5e7 08:14)

Summary: one offset moves curves within a reference surface (plane or spline patch) and always resolves collisions like a region offset; spline section outlines are NURBS curves, and ribbons are gone.

Sources: [D-041](../DECISIONS.md#d-041--offsets-resolve-collisions-ribbons-displace-without-a-surface); Codex 01a0f5e7; [0.2.0 Scope "Offsets"](../plans/0.2.0.md#scope-and-deferrals).

## Booleans
> "We need intersection and boolean capabilities … packaged up properly as tools" — owner, 2026-09-28 ([D-040](../DECISIONS.md#d-040--geometry-is-authored-spline-patches-meshes-and-blob-fields))
>
> "seems like we are making the mistake or checking multiple planar slices when one-time boolean operations would establish any material ownership conflicts. Material ownership is in 3d space, not 2d space." — owner, 2026-10-03 (Codex 01a102a0 20:18)
>
> "Okay so we've only been pretending to have boolean support. Have a worker assess what proper booleans look like … and schedule them for 0.4.0" — owner, 2026-10-03 (Codex 01a102a0 20:25)

Summary: Geometry offers union, difference and intersection as tools; in 0.4.0 one robust 3D Boolean operation serves both construction and material ownership, replacing per-layer probes.

Sources: [D-040](../DECISIONS.md#d-040--geometry-is-authored-spline-patches-meshes-and-blob-fields); [0.4.0 "General 3D solid Booleans and ownership"](../plans/0.4.0.md).

## STL units are assumed
> "Automatically choose reasonable units after load, based on part size. Can always be changed later if needed. This applies outside of tour as well. Note this in decisions - and we will likely change this policy later down the road." — owner, 2026-09-14 ([D-030](../DECISIONS.md#d-030--provisional-stl-units-assumption))

Summary: STL loads without a units question; SAAM assumes units from part size and the person can correct them (provisional).

Sources: [D-030](../DECISIONS.md#d-030--provisional-stl-units-assumption).

## Mesh import and repair
> "Mesh handing is a large issue area that requires discussion before green-lighting any tasks." — owner, 2026-10-03 (Codex 01a102ba 17:25)
>
> "I approve building a merge-close-vertices feature, with a tolerance" — owner, 2026-10-03 (Codex 01a102ba 18:02)
>
> "CGAL is creating a LOT of issues. We will probably move towards dropping CGAL in 0.4.0 (note that in the 0.4.0 intent file)." — owner, 2026-10-03 (Codex 01a102ba 17:50)

Summary: Studio repairs imports automatically and reports exactly which input bytes and repair outcome were involved; features far below print resolution that repair produces are closed and reported, not rejected; replacing CGAL is a probable 0.4.0 direction, not yet chosen.

Sources: [0.3.3 "Mesh import diagnostics"](../plans/0.3.3.md) (owner: "1. agree, write that into the 0.3.3 intent doc", Codex 01a0ff5c 01:46); [0.3.6 "Mesh repair redesign" and "Dimensions and tolerances"](../plans/0.3.6.md); [0.4.0 "Move away from CGAL"](../plans/0.4.0.md); [D-043](../DECISIONS.md#d-043--complete-consolidation-and-role-boundaries) (Studio owns import repair; agent wording); Codex 01a0ff63 02:04 ("We should have mesh fix tools to deal with that situation.").

## Compute in C++ where it pays
> "Okay so we can to incremental migration of select components from javascript to c++? That seems like the ideal approach" — owner, 2026-09-15 ([D-031](../DECISIONS.md#d-031--incremental-c-migration-of-selected-compute-components))

Summary: selected performance-critical components move to C++ incrementally, chosen by profiling, while Studio, agent tools and coordination stay in JavaScript.

Sources: [D-031](../DECISIONS.md#d-031--incremental-c-migration-of-selected-compute-components).
