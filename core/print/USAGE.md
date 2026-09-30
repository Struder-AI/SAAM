# Shared print tools

The commands every skill shares: create or import a print, revise its recipe,
open it for review, generate and deliver. Skill manuals own their settings;
[machine contracts](../export/README.md) own printer setup and limits.

## Commands

Run from the repository root with a directory under ignored `Prints/`; quote
paths containing spaces. MCP tools mirror the commands; their `printId` is
relative to `Prints/` (`Prints/my-part` is `"my-part"`).

| Operation | CLI (`node core/print/cli.mjs …` unless shown) | MCP |
|---|---|---|
| Create from a recipe | `init Prints/my-part plan.json --machine ultimaker-s5` | `get_plan_template`, `create_print` |
| Import an STL | `import-stl Prints/my-part source.stl auto ultimaker-s5` | `import_stl_print` |
| Open in Studio | `node studio/server.mjs --toolkit open-print Prints/my-part` | `list_prints`, `get_print`, `request_review` |
| Adjust the recipe | `adjust Prints/my-part patch.json --revision REV` | `adjust_print` |
| Change printer | `change-machine Prints/my-part MACHINE --revision REV` | `change_machine` |
| Correct STL units | `stl-units Prints/my-part mm` (or `inch`) | `set_stl_units` |
| Read checked state | `check Prints/my-part` | `check_print`, `get_approval_status` |
| Investigate path feasibility, when needed | `check-path Prints/my-part` | `check_path` |
| Generate for review | `generate Prints/my-part` | `generate_print` |
| Deliver the approved export | `deliver Prints/my-part` | `deliver_print` |
| Save setup as the machine's default | `remember-setup Prints/my-part` | `remember_setup` |

Creating or importing makes geometry only. `node studio/server.mjs --toolkit
create-preview Prints/my-part --recipe plan.json` (or `--stl source.stl`) does the
same and opens Studio on it, for when the person should see the geometry
([agent CLI toolkit](../agent/README.md)). Generation is a separate step, in the
CLI or in Studio.

## Recipes

`init` without `plan.json` uses the proposed recipe and remembered machine
setup: a starting point to evaluate against the request. For a complete recipe,
use `await proposedPlan(machineId)` from [bundle.mjs](bundle.mjs) in a script,
or MCP `get_plan_template`. The template enables full-fill **and draped-skin**;
disable what the part doesn't need. STL imports and Gridfinity start with
draped-skin off.

A patch is a JSON object in the recipe's field names: nested objects merge,
arrays replace, unknown fields are rejected. The editable recipe is the
top-level of `plan.json`; don't copy its `bundle` envelope into a patch. After
a stale-revision error, reload state and reassess. Reads omit geometry unless
asked (`get_print` `includeGeometry: true`, `--include-geometry`). Any geometry,
process or setup change invalidates the final confirmation. Changing printer
applies its declared process defaults and keeps other choices; an incompatible
recipe is rejected, not overridden.

### Import an STL

Units default to `auto`: SAAM assumes mm unless the raw size only fits the
printer in inches ([D-030](../../DECISIONS.md#d-030--provisional-stl-units-assumption)),
and Studio shows the assumption. `stl-units` rescales a plain imported mesh,
keeping edits and settings; text-wrapped or composed geometry needs its own edit.
The source must be a local `.stl` on the SAAM computer, at most 64 MiB. If the
mesh fails validation, read [mesh-tools](../../skills/mesh-tools/SKILL.md) with
the reported failure.

### Line spacing

For an open pattern, set `skills.<skill>.spacingFactor` (default `1`): `3`
spaces lines three times wider without widening the bead or its extrusion per
length. It applies to full-fill, planar-infill, draped-skin, supports, both
rimming skills and pipe-cladding, including regional overrides where supported,
but not to single-wall vase spirals. See the
[spacing contract](../path/README.md#line-spacing).

```json
{"skills":{"pipe-cladding":{"spacingFactor":3}}}
```

## Check, generate and deliver

Every toolpath carries a [short-travel advisory](../export/README.md#short-travel-advisory),
read as `shortTravel` from checks, print state or the program summary. When its
count is nonzero, tell the person how many travels, which operations, and
whether they were lifted over a blocked line or moved directly; acknowledge a
Studio advisory as completed. It asks for no repair, regeneration or extra
approval.

Final settings/toolpath confirmation happens in Studio, which can also generate
and export. Delivery copies the exact checked export into `delivery/`, keeps the
machine's filename and extension, and sends nothing to hardware. Changed inputs
need generation and review again; an unchanged checked development export can
become production without slicing again. Before repeating a timed-out operation,
read state: it may have finished. During tour toolpath lessons Studio generates,
so don't start another generation. `check` reports `outputAvailability` and any
missing `machineConfiguration` fields without generating.

## Remember machine setup

`remember-setup`, and any setup change through `adjust`, saves this print's
setup as the default for new prints on that machine; existing prints don't
change. Only setup is remembered: reuse other values from the saved recipe or
the conversation. Bambu output needs its [maker setup](../export/bambu.md#maker-setup)
first; each [machine contract](../export/README.md) owns its own setup questions.
