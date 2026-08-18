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

### Wall / perimeter generation
- Fixed-count offset perimeters — **available**, inside `layer-filling`.
- Variable-width (Arachne-style) adaptive walls, for thin features a
  fixed bead width can't resolve cleanly.
- Seam placement strategy (aligned, random, sharpest-corner, hidden).

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

### Travel and seam optimization
- Combing (keep travel moves inside perimeters)
- Retraction / wipe strategy
- Z-hop

### Multi-material / multi-tool
- Tool change sequencing
- Purge tower / prime blob

### Z strategy
- Adaptive layer height (varies with local slope)

Not yet placed in a category, worth deciding on: vase/spiral-wall
strategies (the private source project's most-developed pattern family)
belong somewhere in this catalog too, likely as their own category rather
than folded into infill.

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
