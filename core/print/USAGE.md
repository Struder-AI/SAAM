# Shared bundle tools

The tools every skill shares. Skill manuals own their settings;
[machine contracts](../export/README.md) own printer setup and limits. A `bundleId`
is relative to `Prints/` (`Prints/my-part` is `"my-part"`).

| Operation | Tool |
|---|---|
| Create from a recipe; import an STL | `get_recipe_defaults`, `create_bundle`; `import_stl_bundle`, `set_stl_units` |
| Geometry tools ([GEOMETRY](../../GEOMETRY.md)) | `blob_field`, `combine_geometry`, `intersect_geometry` |
| Show in Studio; read state | `request_review`; `list_bundles`, `get_bundle`, `check_bundle` |
| Adjust recipe/assignments; undo/redo; change printer | `adjust_recipe`, `slice`, `modulate`; `restore_revision`; `change_machine` |
| Generate for review; deliver the confirmed export | `generate_toolpath`; `deliver_toolpath` |
| Path feasibility; defer this bundle's last-export setup save | `check_path`; `set_deferred_setup_save` |

## Recipes

`get_recipe_defaults` returns process/setup defaults and one common [slice](../../skills/slice/SKILL.md)
assignment, without automatic skin. Bundles always retain [geometry](../../GEOMETRY.md), including empty drafts; inline [Trace](../../skills/trace/SKILL.md)/[Inject](../../skills/inject/SKILL.md) inputs become curve/point geometry with recipe references.

`slice` adds/edits/removes one assignment; `adjust_recipe` patches the recipe.
Objects merge, arrays replace, unknown fields reject; omit `bundle`.
`experimental.substrateAdaptation` defaults false. OFF uses nominal references
without final-material contact/remapping; ON uses finalized deposition for
gap/volume adjustment or surface-following placement and retains required-contact
and gap rejection. Existing recipes need explicit migration for missing fields;
loading never rewrites them. Dependencies and bridge-anchor checks apply in both
modes.
After a stale revision, reload and reassess. Reads omit geometry unless asked
(`includeGeometry: true`). Geometry changes clear the active toolpath; recipe/setup edits retain the previous checked output and its original settings until regeneration. Studio export confirms the displayed output. Changing printer applies process defaults and keeps other
choices, rejects an incompatible recipe, and names any gated guidance it opens.

### Nozzle selection

Print setup selects the default nozzle/material for every producer. For Bambu,
`composition.filaments: [{part:"body",filament:1}]` overrides a component, including
its Slice, Trace, Inject and rivet work. `{assignment:"supports",filament:1}` routes
tree supports; any authored assignment ID or `plastic-weld:SITE_ID` can be targeted.
Priority: print assignment route, assignment's explicit filament, exact part route,
parent component route, print setup. `part:null` names the single geometry part.
Trace/Inject `part` associates material ownership; XYZ still uses print placement.
Filament entries own nozzle/process mapping ([Bambu](../export/bambu.md)); every
route uses the same generation/export/review. Existing recipes need explicit
migration for `composition.filaments` and Trace/Inject `part`, then regeneration.

### Import an STL

Units default to `auto`: SAAM assumes mm unless the raw size only fits the
printer in inches ([D-030](../../DECISIONS.md#d-030--provisional-stl-units-assumption)),
and Studio shows the assumption. `set_stl_units` rescales a plain imported mesh,
keeping edits and settings; text-wrapped or composed geometry needs its own edit.
Studio, CLI and agent imports first validate the source, then attempt repair only
for recognized geometric defects, without hole filling. A repair retains both
STLs and its change report in `repair/`; review changed geometry. Malformed input
and failed repair keep their diagnostic. Failed or cancelled imports remove only
the new print. Local paths stream; only browser uploads have the 64 MiB bound.
Progress and elapsed time are visible to makers; there is no reliable repair ETA.
Use Studio Cancel or `cancel_studio_calculation` with the observed job identity,
then explain the decision. Direct repair commands belong to
[builder diagnosis](../../skills/mesh-tools/BUILDER.md).

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

A successful export remembers its exact artifact's setup in `<SAAM home>/local/machine-setups/`; new prints on that machine reuse it. Edits leave defaults unchanged.
`set_deferred_setup_save` takes `bundleId`, current `expectedRevision` and `defer:true` to skip saves for that bundle until cleared with `false`; it changes no manufacturing identity.
Only setup is remembered; existing prints keep their snapshots. Bambu needs its [maker setup](../export/bambu.md#maker-setup); each [machine contract](../export/README.md) owns setup questions.

## Command line

Use the installed [application command](../application/README.md) from any chat.
A bundle ID is relative to the SAAM home's `Prints/`. Read operation schemas with
`saam help OP`; pass structured input with `--input FILE` or `--stdin`, or use
named flags (PowerShell 5.1 does not reliably pass quoted JSON arguments).

```powershell
saam call get_recipe_defaults --machine-id ultimaker-s5
saam call create_bundle --input recipe-request.json
saam call import_stl_bundle --input import-request.json
saam call begin_studio_work --bundle-id my-part --instruction "Change the infill"
saam call adjust_recipe --input edit-request.json
saam call request_review --bundle-id my-part
saam wait
```

Carry the fresh revision and request identity returned by `begin_studio_work`.
For installed extensions use their named operation from `saam help`, carrying the
request and current expected revision; its discovery-only actions leave the
revision unchanged. Read the report and follow normal generation and review.
Builders change extension source; makers change the print through this operation.
