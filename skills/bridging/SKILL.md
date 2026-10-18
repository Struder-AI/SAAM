---
name: bridging
description: Extension for Trace spans between supporting rims, including attachment motions.
metadata:
  saam-kind: extension
---

# Bridging

Author span and attachment centerlines as ordinary [Trace](../trace/SKILL.md) curves. The helper requires attachment/span order within each one-way row; rows form soft chunks and may reorder independently. Alternating depositing turns require the full run’s sequence. Spans and presses are atomic. `supportBridge` requires its named predecessor; Scheduling owns travel. Trace owns common fields.

Use `contact:{source:null,gapMm:null,sampleStepMm:0.1,referenceZMm:null}` to check expected supporting strands. Contact checks do not create execution dependencies. A press uses an explicit down-and-up curve with `depositionAction:{kind:'press',depthMm}`.

The [authoring helper](scripts/prepare.mjs) converts the rail controls below into
that explicit Trace data. It is guidance tooling; no bridge record reaches the
generator; a legacy bridge record is read as this Trace data.

For one or two walls around a solid guide, use a slice assignment with `loops: 1`
or `2`, `fillDensity: 0`, `solidTop: 0`, `solidBottom: 0`, and omit
separate roof finishes and vase-wall. Geometry guides and printed material differ;
review actual toolpaths, including complete wall circuits.

## Authoring helper

`maxExcursionMm` bounds each whole bridge including endpoint presses (when explicitly supplied). It is a user-selected geometric constraint, not a head collision model.
No 15-degree slope limit is applied. The exporter handles machine compatibility.

Each helper entry in `bridges` has these required fields:

| Field | Meaning |
|---|---|
| `id` | Unique lowercase identifier |
| `rails` | Two equally sized arrays of XYZ gap-edge points, at bridge deposition height; XY is relative to plan placement |
| `mode` | `alternating` reverses successive spans and deposits between anchors; `one-way` fixes span direction |
| `overlapMm` | XY extension from each gap edge into its supporting wall |
| `speedMmS` | Unsupported span speed |
| `attachmentSpeedMmS` | Supported attachment, turn, lead, jog and press speed |
| `flowMultiplier` | Unsupported volume multiplier only; reference area is line width times layer height, integrated along 3D length |
| `pressMm` | Down-and-up extruding dip at both supported anchors; zero disables |
| `jogMm` | Along-rim out-and-back excursion before each span; zero disables |
| `leadInMm` | Supported along-rim lead before every span; zero disables |

Optional `endAttachment` is available for one-way mode. Supply all five fields:
`overlapMm`, `speedMmS`, `pressMm`, `jogMm`, `flowMultiplier`. They override only
the arrival attachment; `jogMm` adds a supported out-and-back jog after arrival,
before leaving the row. Other controls stay unchanged; omitting this record uses the start settings at both ends.

Optional `supportBridge` names an earlier bridge entry. Attachment checks then
use that entry's emitted 3D strands one vertical layer below, including sloped
strands. This allows a transverse second layer; its rail heights and direction
must be authored explicitly. It does not fill gaps, assume measured bead width,
or prove that layer one will physically support layer two. Check the full stack's
Z excursion when applying a per-object clearance requirement.

Optional `maxSegmentMm` subdivides each free span into collinear XYZ commands
with at most this 3D length. Each interval retains distinct `bridgeSpan` and
`bridgeSegment` semantic metadata so shared collinear compaction preserves the
commanded intermediate positions. Speed and volume per length remain constant;
no pauses or travel are added. Omit it for one command per free span. This is an
experimental mitigation for an S5 operator report of early Z movement during
long inclined extrusion commands, not proof of firmware behavior or a validated fix.

The author supplies actual gap edges and rim heights. Every free span follows one
straight line; attachment paths remain separate. Turns follow chords between
successive anchor samples. Jog/lead direction follows the local sampled rail;
sample curved rails finely and keep these motions within supporting material.
The first rail is the one-way start rail and first alternating start rail.

Shared attachment curves retain process roles; `depositCurves` calculates beads.
The helper checks authored excursion; shared Trace checks attachment coverage against
finalized positive-volume strands one vertical layer below, including sloped
model paths or a named earlier bridge. Sparse gaps remain absent; the 0.015 mm coverage
tolerance is numerical, not adhesion evidence.
Scheduling checks swept-nozzle access. Temperature and fan use common settings;
no temperature sweep or endpoint dwell is exposed.

The user reports physical bridging (2026-09-24); sag, tension, attachment and
pressure are unmeasured. Save the recipe, program hash, photos and operator report;
review geometry, process and paths in Studio before delivery.
