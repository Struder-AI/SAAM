---
name: wing
description: Experimental interactive wing design workspace with source-backed airfoils and self-contained print bundles.
metadata:
  saam-kind: workspace
---
# Wing workspace

Open `wing` with `saam call open_workspace --extension-id wing`. Read or update the complete design and replace the current exported set through the returned controls. The staged controls, source-backed airfoil cards and camera presets are design aids. Sliders update the preview while dragging; release saves the final design. The six coordinate files and their source URLs/SHA-256 records are in [data/sources.json](data/sources.json); they carry geometry, not aerodynamic performance. Selecting a card sets its measured camber/thickness as the starting shape, except S1223 starts at 14% thickness to fit the default pivot. The sliders can scale both values; a section that cannot fit its straight rods is rejected.

Sweep is measured at the quarter chord from 0–25°. Each half-wing has its own straight slanted reinforcement rod, with an elliptical horizontal passage sized for rod clearance; the flap pivot spans only the flap. The two rods do not continue as one straight member through the root. Section joints are glued, and the root load path, insertion clearance and strength remain unqualified. The integrated winglet retains a flat outer face as its print bed face. Fuselage and tail in the viewer are display context only.

**Save all bundles** completes a self-contained set before replacing its predecessor; failure/interruption preserves the prior set. Close its parts in Studio before replacement. Independently edited parts retain their exact bundle and construction provenance, including a removed piece; the result labels retention. Older historical sets remain, and a legacy set without an original manifest digest is retained conservatively. Ordinary SAAM sessions edit, generate, review and share each part; [workspace handoff](../AUTHORING.md) owns provenance. No live synchronization or flight qualification is claimed. [Dihedral/twist proposal](DIHEDRAL-TWIST-PROPOSAL.md).
