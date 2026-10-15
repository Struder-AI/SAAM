---
name: light-switch-covers
description: Experimental workspace for labeled light switch covers with measured openings, raised or recessed text, color parts and relief motifs.
metadata:
  saam-kind: geometry
---

# Light Switch Covers

Open with `saam call open_workspace`, supplying `extensionId: "light-switch-covers"`.
The common workspace host saves the design, provides actual geometry previews
and creates a self-contained `cover` Bundle for ordinary Studio editing and Export.

Choose location, family, installation, 1–6 positions, toggle/rocker/blank/measured
rectangular openings and labels. Dimensions include plate size, spacing, rear
pocket, screw holes/head seats and countersinks. Raised lettering prints face up;
recessed and flush two-color lettering permit either orientation. Rear-pocket
support and face-down raised-motif clearance appear in preview and source notes.

Save/load JSON preserves the design; successful preview also saves through the
host. STL and separate color-part downloads share coordinates. Two-color handoffs retain separate plate/label Slice assignments. Configure two
logical filaments and assign these components in Studio; preview colors are intent. Colors do not infer AMS trays. Bundle geometry is
ordinary meshes; the workspace design is historical provenance, not authority.

The fire-safety responsibility popup opens once per browser session and can be
reopened. Users are responsible for the fire safety of their covers. Fit and
electrical material qualification have not been established.

The [catalog](catalog.json), [research](RESEARCH.md), [parameter specification](PARAMETERS.md)
and [two-color example](designs/kitchen-porch.json) belong to this same workspace.
International drawings are references, not implemented proprietary mounting
interfaces. Measured geometry currently supports rectangular openings and
vertical screw pairs. Square-box mode is a decorative overlay retaining the
original metal cover. General retained-cover overlays and label strips remain
planned. Arbitrary clip/bayonet interfaces and imported reliefs are not implemented.

For conversational decoration, inspect/edit the workspace through
`get_workspace`/`update_workspace` and preserve unrelated settings. Each motif
is `{shape, x, y, size, depth, mode}`: circle, diamond or horizontal stripe;
raised/recessed; mm in the installed front view, origin lower left. The saved
decoration prompt does not invoke a separate LLM.

The [port record](PORT.md) owns source/provenance details; font identity and its
SIL Open Font License are in [fonts](fonts/README.md). Credits and community
support status appear in the host's common About area.
