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
- Pinning (tip design at the support-to-part contact point — needs a
  firmer definition before it becomes a manifest; flagging the term as
  understood, not yet specified)

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

**A scope note worth flagging explicitly:** Tormach and Avid CNC are
subtractive (milling/routing) controllers, not additive ones. SAAM's
charter currently states "SAAM begins with additive manufacturing." The
schemas built so far — `capabilityRequirements` values like
`extrusion-on-off`, the process-plan's `toolState: on/off/travel-only` —
are shaped around additive deposition and don't obviously fit a spindle
speed, a tool-change carousel, or a pocketing/contouring strategy.
Designating these two now is a real, deliberate signal about where the
project is headed, not a scope mismatch to quietly ignore — but building
their post-processors for real will likely need new operation and
capability vocabulary for subtractive work, not just a new
`postProcessor` value on the existing additive schemas. Worth a
deliberate decision when their turn comes, not an assumption that the
current schemas already cover it.
