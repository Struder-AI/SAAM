# Shared bundle tools

The tools every skill shares. Skill manuals own their settings;
[machine contracts](../export/README.md) own printer setup and limits. A `bundleId`
is relative to `Prints/` (`Prints/my-part` is `"my-part"`).

| Operation | Tool |
|---|---|
| Create from a recipe; import an STL | `get_recipe_defaults`, `create_bundle`; `import_stl_bundle`, `set_stl_units` |
| Geometry tools ([GEOMETRY](../../GEOMETRY.md)) | `blob_field`, `combine_geometry`, `intersect_geometry` |
| Show in Studio; read state | `request_review`; `list_bundles`, `get_bundle`, `check_bundle` |
| Adjust recipe/assignments; change printer | `adjust_recipe`, `slice`, `modulate`; `change_machine` |
| Generate for review; deliver the confirmed export | `generate_toolpath`; `deliver_toolpath` |
| Path feasibility, when needed; save setup as the machine's default | `check_path`; `remember_setup` |

Creating saves authored inputs; generation is a separate step.

## Recipes

`get_recipe_defaults` returns process/setup defaults and one common [slice](../../skills/slice/SKILL.md)
assignment, with no geometry or automatic skin. Before `create_bundle`, author
`geometry` or replace assignments with [points-only inject](../../skills/inject/SKILL.md).

`slice` adds/edits/removes one assignment; `adjust_recipe` patches the recipe. Objects merge, arrays replace,
unknown fields reject; omit `bundle`. `experimental.substrateAdaptation` defaults false; true adapts gap/volume and surface-following placement to deposited substrate. Existing recipes require explicit `migrate` before generation.
After a stale revision, reload and reassess. Reads omit geometry unless asked
(`includeGeometry: true`). Any geometry, process or setup change invalidates the
final confirmation. Changing printer applies its process defaults and keeps other
choices, rejects an incompatible recipe, and names any gated guidance it opens.

### Import an STL

Units default to `auto`: SAAM assumes mm unless the raw size only fits the
printer in inches ([D-030](../../DECISIONS.md#d-030--provisional-stl-units-assumption)),
and Studio shows the assumption. `set_stl_units` rescales a plain imported mesh,
keeping edits and settings; text-wrapped or composed geometry needs its own edit.
The source must be a local `.stl` on the SAAM computer, at most 64 MiB. If the
mesh fails validation, read [mesh-tools](../../skills/mesh-tools/SKILL.md) with
the reported failure.

### Line spacing

A `slice` edit with `assignment:{spacingFactor:3}` triples spacing without
widening the bead (default 1). Loop/fill, skin and cladding constructions support
it; per-assignment `process.lineWidthMm` controls bead width separately.
Single-wall sleeve spirals use their course pitch instead.

## Check, generate and deliver

When a toolpath's [short-travel advisory](../export/README.md#short-travel-advisory)
(`shortTravel`) count is nonzero, tell the person how many travels, which
operations, and whether they were lifted over a blocked line or moved directly;
it asks for no repair or approval. Acknowledge a Studio advisory as completed.

The final confirmation happens in Studio, which can also generate and export.
Delivery copies the exact checked export into `delivery/` and sends nothing to
hardware. Changed inputs need generation and review again. Before repeating a
timed-out operation, read state: it may have finished. During tour toolpath
lessons Studio generates, so don't start another. A check reports
`outputAvailability` and missing `machineConfiguration` fields without generating.

## Remember machine setup

`remember_setup`, and any setup change through `adjust_recipe`, saves this print's
setup as the default for new prints on that machine; existing prints don't
change. Only setup is remembered. Bambu output needs its [maker setup](../export/bambu.md#maker-setup)
first; each [machine contract](../export/README.md) owns its own setup questions.

<!-- layer: script -->
## Command line

Run from the repository root with a directory under `Prints/`; quote paths with
spaces. Each command is the tool of the same name through `node core/print/cli.mjs`:

```sh
init Prints/my-part plan.json --machine ultimaker-s5   # authored geometry or injection points
import-stl Prints/my-part source.stl auto ultimaker-s5
blob-field-create Prints/my-part request.json ultimaker-s5   # blob-field-update … --revision REV
combine|intersect|adjust Prints/my-part request.json --revision REV   # intersect takes no revision
change-machine Prints/my-part MACHINE --revision REV
stl-units Prints/my-part mm|inch
check|check-path|generate|deliver|remember-setup Prints/my-part
```

`node studio/server.mjs --toolkit open-print Prints/my-part` shows a print, and
`create-preview Prints/my-part --recipe plan.json` (or `--stl source.stl`) creates
one and opens Studio on it ([agent toolkit](../agent/README.md)). In a script,
`await proposedPlan(machineId)` from [bundle.mjs](bundle.mjs) returns geometry-free recipe defaults.
