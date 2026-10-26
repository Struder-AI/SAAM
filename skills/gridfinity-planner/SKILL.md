---
name: gridfinity-planner
description: Experimental workspace that fits a gridfinity grid to a drawer, paints bins into it by filament colour and packs them onto build plates as ordinary print bundles.
metadata:
  saam-kind: workspace
---
# Gridfinity planner

Open it with `saam call open_workspace --extension-id gridfinity-planner`. It
plans; the [gridfinity](../gridfinity/SKILL.md) extension builds every bin and
baseplate and the [text](../text/SKILL.md) extension builds every label.

1. **Size the frame.** A new plan starts empty. Fit a drawer (inside width, depth and optional height in mm, cm or
   in) or choose a grid in cells or rough inches. In drawer mode the **grid gap**
   (default 4 mm) is how much smaller the baseplate is than the drawer in each
   direction. Whole 42 mm cells fill the rest; leftover width becomes equal side
   borders and leftover depth goes behind the bins, so they sit centred and at
   the front. A drawer height limits bin height with 1 mm headroom above the
   baseplate.
2. **Pick & colour bins.** Pick a bin type, height and intended filament, then click or drag
   across empty cells: each footprint is one bin to print. Bins show their
   filament colour and a type code (`2×1 · 3u`; `|3` for three cups, `B` for a
   solid blank). Click a bin to change its height, cups, lip, magnet pockets,
   label or filament; right-click to delete it. **Select** (or Shift-drag) draws a
   window that selects every bin it touches; height, filament (a pick-one list of
   colours), lip and magnets then apply to all of them, and Delete removes them.
3. **Stage plates.** The chosen printer sets the build-plate size used for layout.
   Plates hold one filament each, or mix filaments on printers with filament
   changes. Filaments are the ones you intend to use; nothing needs to be loaded.
   Plates appear only in this step and the next.
4. **Print.** **Create print bundles** builds one print bundle per plate
   through the shared workspace host. SAAM opens each in Studio, where you choose
   the printer, setup and filaments; generation, review and export follow the
   normal workflow. Re-creating replaces the previous set; plates already edited
   in Studio are kept.

Baseplates larger than the bed are split into tiles on cell boundaries; only
edges on the drawer boundary keep their border. Bins and tiles are shelf-packed
with a 10 mm bed margin and 6 mm gaps. Labels are raised 0.6 mm on the floor of
the front-left cup (or the top of a blank) in the bundled
[Abel font](fonts/README.md), sized to the cup width; change or remove them in
Studio with the text tool.

Bundles are neutral, like every workspace handoff: no machine and no logical
filaments. Each records its intended printer and, under
`requirements.materialRoles`, each part's intended colour; a mixed plate has one
slice assignment per bin so each can take its own filament in Studio.

An agent edits the saved design as JSON (`schema: saam-gridfinity-planner/1`):
`sizing`, `baseplate`, `filaments` (`{name, colour}`), `printer`
(`{machineId, packing: "filament"|"mixed"}`) and `bins`
(`{type, x, y, heightUnits, filament, label, compartmentsX, compartmentsY, stackingLip, magnetHoles}`,
cells counted from the front-left). [design.mjs](design.mjs) lists the bin types
and checks every rule.

The interface follows SAAM Studio's visual language: numbered stages in the
header, one view and a review panel ending in the next action.

Physical fit, the grid-gap default, label legibility and stacking are untested;
print one tile and one bin first. Concept and workflow requested by tkeller on
2026-10-07. No maintainer is designated.
