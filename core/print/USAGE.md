# Shared print tools

Use this manual to create, import, revise, review and deliver a print. The
[selected skill](../../skills/README.md) owns its geometry support, settings and
process limits; [MAKERS](../../MAKERS.md) owns the conversation and human review.
The [lifecycle reference](README.md) explains implementation contracts.

## Choose the tool entry point

Run CLI examples from the repository root after [checkout setup](../../CONTRIBUTING.md#setup-and-checks).
Use a named directory under ignored `Prints/`; quote paths containing spaces.
The shell CLI, [cli.mjs](cli.mjs), handles composed printing patterns. The
[bounded wedge demo](../../skills/wedge-demo/SKILL.md#setup-and-tools) has its own
CLI and initialization format, with the same review and delivery lifecycle.

Connected agents use the corresponding MCP tools below. Their `printId` is
relative to the configured Prints root, so `Prints/my-part` in a CLI example is
normally `printId: "my-part"` through MCP. The [adapter manual](../../adapters/mcp/README.md)
owns connection setup, local-file access and tool schemas. `list_machines` and
`list_skills` identify this checkout's catalog; each skill and machine manual
defines the compatible combinations.

## Create or import a print

### Create from a recipe

```sh
node core/print/cli.mjs init Prints/my-part plan.json --machine ultimaker-s5
```

Supply a complete recipe suited to the requested part, including geometry and
selected skills. Omitting `plan.json` uses the shell adapter's proposed recipe
and remembered machine setup. That default is a starting point to evaluate
against the request. An explicit recipe supplies its own setup.

For a complete recipe in a local authoring script, use
`await proposedPlan(machineId)` from [bundle.mjs](bundle.mjs), then change its
geometry and skill settings before passing it to `initBundle` or saving JSON.
The shell template enables full-fill **and draped-skin**; explicitly disable
unwanted patterns when choosing another recipe (STL, Gridfinity and voxel
creation already disable draped-skin).

Through MCP, get a complete editable recipe with `get_plan_template`, selecting
`kind: "shell"` and the machine, then pass the proposed recipe to `create_print`.
`kind: "wedge"` selects the bounded demo when that is the intended workflow.
Creation stores unapproved geometry and settings; open Studio for review.

### Create volumetric geometry

For volumetric samples or B-spline control lattices, use the
[voxel tools](../../skills/voxel-tools/SKILL.md). They retain the field and its
explicit extraction resolution while using the shared slicing and review workflow.

### Import an STL

```sh
node core/print/cli.mjs import-stl Prints/my-part source.stl mm ultimaker-s5
```

Use explicit `mm` or `inch` units. Clarify unknown units before importing because
they determine scale. The importer accepts ASCII or binary STL, preserves its
source bytes and hash, checks the mesh, and translates it onto the bed. It reuses
remembered machine setup and creates a shell recipe with draped skin disabled.
Adjust printing patterns for the intended result, then show size and placement
in Studio before geometry approval.

MCP `import_stl_print` takes `printId`, `sourcePath`, `units` and `machineId`.
The source must be an absolute local `.stl` file on the SAAM computer and no
larger than 64 MiB. A path on a remote chat device is not a local source.

### When mesh validation fails

If import or reopening reports invalid mesh geometry, read the
[mesh-tools manual](../../skills/mesh-tools/SKILL.md) with the reported failure.
It explains how to assess the available correction tools and their effect on
the part. Import itself preserves the supplied geometry; reconstruction is a
separate operation whose result needs geometry review. Missing files, wrong
units and machine incompatibility need their own corrections, not reconstruction.

### Add or remove text material

Use the [text skill](../../skills/text/SKILL.md) for raised or recessed lettering,
standalone text and independent spline guides. `shell text` / MCP `apply_text`
rebuild the selected part through the same geometry and review lifecycle. Its
manual owns font input, placement, reference-surface and relief settings.

## Open and resume review

```sh
node studio/server.mjs Prints/my-part
```

Open the printed local URL. `npm run studio -- Prints/my-part` is the equivalent
human-facing alias; agent launcher permissions use the direct command above.
MCP `request_review` starts or reuses Studio and returns its local URL. Keep the
viewer available while the person reviews. [Studio access and lifetime](../../studio/README.md#studio-agent-permissions)
explain client permissions and how to close or resume your instance.

Studio's **Open print** selects saved bundles or a file inside a bundle. Opening
resumes the current review stage without generating new output or granting
approval. See [opening local prints](../../studio/README.md#opening-local-prints-in-studio)
for picker behavior and unsupported standalone program files.

Read current CLI status with `check` below. Through MCP, `list_prints` finds
saved IDs, `get_print` reads state and recipe settings, and
`get_approval_status` reads the three approval stages. Set `includeGeometry:true`
on `get_print` when you need the complete editable recipe; the default omits
geometry and reports `planComplete:false`.

## Adjust the recipe

```sh
node core/print/cli.mjs adjust Prints/my-part patch.json --revision <current-revision>
```

Write the requested changes as a JSON object, using field names from the current
recipe and selected skill manual. Nested objects merge; arrays replace the
whole array. Unknown fields are rejected. The CLI revision argument is optional
and protects against applying an edit to a version that has changed since you
read it. MCP `adjust_print` requires that fresh `expectedRevision` and the patch.
After a stale-revision error, reload state and reassess the change.

Studio picks up the revised bundle. Geometry changes require all three reviews
again; process and setup changes retain unchanged geometry approval and require
plan and toolpath review. The maker requests revisions in chat; the agent handles
the recipe files. Manual replacement of bundle internals can break consistency.

### Line spacing

For an intentionally open pattern, set only `skills.<skill>.spacingFactor` in
the usual recipe patch. It defaults to `1`; `3` requests three times the nominal
line spacing without tripling bead width or extrusion per unit length:

```json
{"skills":{"pipe-cladding":{"spacingFactor":3}}}
```

This applies to full-fill, planar-infill, draped-skin, supports, both rimming
patterns and pipe-cladding, including regional overrides where supported.
Single-wall vase spirals and the bounded wedge demo do not use this setting.
Ordinary recipes need no additional setting. Studio shows a nondefault factor
in plan review; changing it follows the existing process review lifecycle.
See the [shared spacing contract](../path/README.md#line-spacing) for density,
surface fitting and composition behavior.

## Check, generate and deliver

| Operation | CLI suffix after `node core/print/cli.mjs` | MCP tool | Result |
|---|---|---|---|
| Read checked state | `check Prints/my-part` | `check_print` | Checks saved inputs and any stored export; reports approval state without generation. |
| Investigate path feasibility | `check-path Prints/my-part` | `check_path` | Runs shared generation and machine checks without approval or persisted output. Use when feasibility needs investigation; it is not a mandatory extra step. |
| Generate for review | `generate Prints/my-part` | `generate_print` | Requires current geometry and plan approvals; creates and checks the machine export for toolpath review. |
| Deliver approved output | `deliver Prints/my-part` | `deliver_print` | Requires toolpath approval and copies the exact checked export into `delivery/`. |

Studio also supports generation and final export in its review flow. Read the
current state before repeating a timed-out operation: work may have completed.
Changed inputs or a stale/edited export require the affected generation and
reviews again. Only the person enters approvals in Studio. Delivery preserves
the selected machine's filename and extension and does not send a job to hardware.

For an explicitly developmental preview, `demo Prints/development/my-part`
creates or reopens a shell bundle and generates without human approvals. An
existing recipe can be initialized first. Development output cannot authorize
delivery, and MCP does not expose this mode. Follow the
[development testing context](../../CONTRIBUTING.md#testing-through-the-use-context)
when exercising maker tools during development.

Development generation still needs explicit robot command settings; for a new
provisional part use the reusable setup instructions for
[DENSO](../../skills/pipe-cladding/SKILL.md#public-workflow-and-development-demo)
or [Dobot](../export/dobot.md#dobot-output-contract), independently of its shape.
CLI `check` reports `outputAvailability` and missing `machineConfiguration`
fields from the saved state, without attempting generation.

## Remember machine setup

```sh
node core/print/cli.mjs remember-setup Prints/my-part
```

MCP uses `remember_setup`. Both save this print's setup as editable defaults for
new prints on that machine; `adjust` / `adjust_print` also save setup changes.
The normal store is `.local/machine-setups/<machine-id>.json`, with source and
update time. MCP with a custom Prints root uses its own setup store. Setup
reuse confers no approval and does not change existing prints.

A firmware-version change clears startup verification unless verification is
explicitly supplied with it. Keep user-reported findings distinct from assumed
profile behavior. The [S5 setup guidance](../export/griffin.md#s5-setup-and-troubleshooting)
and other [machine contracts](../export/README.md) own installation-specific
questions and required calibration.

## Upgrade an older bundle

```sh
node core/print/cli.mjs upgrade Prints/my-part
```

Use `upgrade_print` through MCP. Upgrade is explicit and remains available when
old-version validation prevents normal reopening. The shell adapter installs
the current machine snapshot, retains unchanged geometry approval and invalidates
plan/toolpath approvals. Existing exports and delivery files remain unchanged.
Reopen Studio and complete the affected reviews before generating new output.
The wedge adapter's additional geometry migration is described in its own manual.
