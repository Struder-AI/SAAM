# Roadmap

Two working lists: what planar operation categories SAAM should
eventually cover, and which machines are already designated as future
targets. Both sections are drafts for discussion, not commitments — edit
freely.

## Planar operation catalog (brainstorm, draft)

The two operations built so far (`layer-filling`, `non-planar-cladding`)
came out of testing specific parts, not a first-principles survey of what
most 3D prints actually need. This is that survey's first pass, organized
by category. Each line is a future `operations/additive/planar/*`
candidate, not yet built unless marked **available**.

Per `docs/authoring/operations.md`, none of these need to land in this
exact category grouping — `category` is reorganizable metadata, `id` is
the only thing that has to stay stable once something ships.

A follow-up pass cross-checked this list against what PrusaSlicer, Cura,
and OrcaSlicer/Bambu Studio actually ship, plus the Arachne
perimeter-generation paper (Kuipers et al., 2020) those slicers adopted.
Most categories already matched with nothing to add; the new bullets
below (and the new "Not operations" section closing out this catalog)
came out of that pass.

### Wall / perimeter generation
- Fixed-count offset perimeters — **available**, inside `layer-filling`.
- Variable-width (Arachne-style) adaptive walls, for thin features a
  fixed bead width can't resolve cleanly.
- Seam placement strategy (nearest, rear/back, aligned-to-previous-layer,
  random, or manually painted).
- Gap fill — filling sub-extrusion-width gaps a wall still can't close.
  Mostly subsumed once Arachne-style variable-width walls exist, but
  classic fixed-width offsetting needs it named explicitly.
- Wall print order (inner→outer, outer→inner, or inner→outer→inner) — a
  real, documented tradeoff between overhang quality and dimensional
  accuracy on holes and bosses, not a cosmetic toggle.
- Vase / spiral-wall mode — a single continuous spiraling wall, no seam,
  no infill, no top layers. The source project's most-developed pattern
  family; this is its category now that it's actually been checked
  against mainstream slicers rather than left unplaced.
- Elephant-foot compensation — a small inward perimeter offset on the
  first few layers only, correcting first-layer bed-squash expansion.
  A real geometry operation, not a print-speed setting.

### Infill strategies
- Rectilinear (line) — **available**, inside `layer-filling`.
- Concentric — **available**, inside `layer-filling` (circular case).
- Grid
- Triangles
- Cubic / cubic subdivision
- Gyroid
- Honeycomb
- Hilbert curve (space-filling curve)
- Lightning infill (sparse, tree-like — minimal material under a solid
  top surface rather than full-density support-style infill)
- Adaptive / variable density (denser near walls or solid transitions)

### Top/bottom solid transitions
- Solid infill cap generation
- Sparse-to-solid interface layers

### Surface finishing
- Ironing (low-flow re-trace of a top surface for smoothness)
- Fuzzy skin (deliberate surface texture)

### Support generation
- Grid/line supports
- Tree / organic supports
- Hybrid tree + grid supports — tree trunks below, a grid-style cap near
  the part; tree's easy removal with grid's reliability on critical flat
  undersides.
- Support interfaces (denser layer between support and part)
- Support blockers / enforcers (include/exclude zones)

### Cross-layer reinforcement

Everything above builds up volume: given a target shape, deposit enough
material to fill it. This category is different in kind, not just in
technique — these operations act *across* a span of already-planned
layers to change how they're bonded to each other, in service of
strength, not shape. Worth keeping as its own category rather than
folding into infill or supports, since a process-plan dependency here
points backward across a layer range instead of within one layer.

- **Z-pinning / Z-stitching** — depositing material vertically through a
  stack of layers to reinforce otherwise-weak interlayer bonding. This
  turns out to be a real, published technique, not something invented
  for SAAM: FDM/AM research literature under the terms "Z-pinning" and
  "Z-stitching" reports Z-direction tensile strength and toughness gains
  of 3.5x or more over conventional infill of the same density,
  addressing exactly the interlayer-adhesion weakness that limits
  FDM part strength generally (sources below). It has not, as far as
  this search found, been adopted by any mainstream commercial slicer —
  consistent with the read that got this added to the roadmap.

  Published implementations typically deposit the reinforcing pin
  progressively as printing proceeds, sometimes using a secondary
  material (carbon-fiber tow plus epoxy) drawn into a pre-formed
  channel. SAAM's candidate mechanism, as described for this roadmap, is
  more specific and not yet confirmed identical to the published
  approach: print an aligned vertical channel through a defined span of
  layers (e.g. layers 2–7 of an 8-layer stack), optionally tapering the
  channel wider at the top; then, on the final layer's own pass, return
  to each channel and deposit downward under pressure — a single
  monolithic plug locking the whole stack together in one motion, rather
  than building the pin incrementally layer by layer. This needs real
  development and physical proof before it's anything more than a
  documented concept.

  Sources: [Z-Stitching Technique for Improved Mechanical Performance in Fused Filament Fabrication (MDPI)](https://www.mdpi.com/2504-4494/9/3/97), [Z-Pinning Approach for 3D Printing Mechanically Isotropic Materials (ScienceDirect)](https://www.sciencedirect.com/science/article/abs/pii/S2214860418310492), [same, OSTI full text](https://www.osti.gov/servlets/purl/1808415), [Modeling the interfacial failure of z-pinned AM composites (ScienceDirect)](https://www.sciencedirect.com/science/article/abs/pii/S2352492823004269).

### Bed adhesion
- Skirt
- Brim
- Raft

### Bridging
- Unsupported-span detection and bridging fill strategy
- **Arc overhangs** — concentric self-supporting arcs that print true
  horizontal overhangs off a vertical wall with zero support material, a
  genuinely different algorithm family from filling a span between two
  already-supported edges. Worth an EXPERIMENTAL label rather than
  treating it as a "catch up to slicers" item: even in the mainstream
  slicer world this exists only as third-party scripts and forks, not as
  a natively-shipped feature anywhere yet. Source:
  [stmcculloch/arc-overhang](https://github.com/stmcculloch/arc-overhang).

### Travel and seam optimization
- Combing (keep travel moves inside perimeters)
- Retraction / wipe strategy
- Z-hop
- Coasting — stop extrusion just before a line's end so residual nozzle
  pressure finishes it, preventing end-of-line blobbing without a full
  retraction.

### Multi-material / multi-tool
- Tool change sequencing
- Purge tower / prime blob ("prime tower," "wipe tower," and "purge
  tower" are used near-interchangeably across slicers for the same
  structure — it stabilizes nozzle pressure after a tool change, not
  just flushes color)

### Z strategy
- Adaptive layer height (varies with local slope)

### Not operations (deliberately excluded)

The same slicer-feature survey pass also surfaced a lot of real,
heavily-documented slicer functionality that still doesn't belong in
this catalog: calibration numbers tuned per machine and material, layered
on top of whichever operation runs, rather than a strategy for how a
path itself is laid out. SAAM's schema already separates these from an
operation's own strategy — `settings` for process parameters shared
across operations, machine `capabilities` for what a platform can
physically do — so listing them here would just be scope creep dressed
up as thoroughness:

- Nozzle / bed temperature — material calibration.
- Fan speed profiles, including per-feature overrides for bridges and
  overhangs — applied atop whichever operation runs, not a strategy of
  its own.
- Retraction distance and speed — the numeric tuning; combing, Z-hop,
  and coasting above are the genuine geometric strategies.
- Pressure advance / input shaping and jerk / junction deviation —
  firmware and motion-controller tuning, below the toolpath layer
  entirely.
- Flow rate / extrusion multiplier — material calibration against a
  specific filament batch.
- Multi-part build sequencing ("print one at a time" object ordering
  across a full bed) — a build-orchestration problem, not a single
  part's toolpath strategy.

## Machine and post-processor roadmap

**Available now:**

- `reference-dobot-mg400-struderbot` — Dobot MG400 desktop robotic arm,
  DobotStudio Pro Lua. See `machines/reference-dobot-mg400-struderbot/`.

**Designated, in development — no post-processor implementation yet:**

| Machine | Controller | Class |
|---|---|---|
| Tormach PCNC | PathPilot | CNC mill (subtractive) |
| Avid CNC | Mach3 | CNC router/mill (subtractive) |
| Ultimaker S5 | Marlin-family G-code | FDM printer (additive) |
| BambuLab H2D | Bambu firmware | Multi-tool additive printer (understood to combine FDM with at least one non-extrusion tool head — worth confirming exact tool-head capabilities before scoping its operation support) |

**Scope clarification:** the intent for Tormach/PathPilot and Avid
CNC/Mach3 is not that SAAM does full CNC milling as a first-class
citizen today. The intent is that Struder — SAAM's additive tool —
mounts onto essentially any motion platform, either directly in the
machine's spindle or offset to the side with a known mounting
transform, turning that platform into an additive machine. Onboarded
this way, a Tormach or an Avid CNC satisfies the same additive
`capabilityRequirements` (`planar-motion`, `extrusion-on-off`,
`coordinated-xyz-motion`) as the Dobot reference machine does — it's a
different motion platform carrying the same kind of tool, not a
different operation vocabulary. Nothing about onboarding these as
additive platforms needs new schema work.

The platform's *native* subtractive capability (milling, routing) is a
separate, optional door being left open, not built now: using the same
machine for subtractive cleanup on a part after printing it. That would
need its own new operation and capability vocabulary — spindle speed,
tool changes, pocketing/contouring strategy — genuinely distinct from
the additive schemas built so far. Worth a deliberate decision when that
day comes, not an assumption that today's schemas already cover it.
