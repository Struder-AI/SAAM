# StruderBot skill migration

## Status

**IMPORTED REFERENCE — NOT YET CALLABLE THROUGH SAAM**

The user authorized this complete skill synchronization on 2026-09-10 after a
collaborator could not find the patterned-wall work in SAAM. The import makes
the locally developed manuals, references and deterministic helper scripts
visible in the SAAM repository while preserving their evidence labels.

It deliberately does not claim that copied legacy helpers satisfy SAAM's
current geometry, composition, machine, Studio, approval or delivery contracts.
No physical result is promoted by this import.

## Provenance

- Historical repository: `https://github.com/tkeller-inventopia/ai-native-3d-printer`
- Historical working branch: `project/ai-native-slicer-library-integration`
- Last branch checkpoint recorded as pushed: `263f02b8adb69e556e2558fb930543027bb658d9`
- Source imported from the newer local working tree on 2026-09-10, including
  uncommitted manual refinements and skill folders that had never been pushed.
- SAAM base branch: `refresh` at
  `f6672059dd120945f0a16fb78cf87764ea50f0ee`.

The original directory names are retained to keep cross-references and search
terms stable. Optional `agents/openai.yaml` files are provenance artifacts; the
current SAAM MCP adapter still uses its fixed capability list under D-022.

## Imported inventory

| Manual | Historical remote state | SAAM integration state |
|---|---|---|
| `dobot-patterned-wall` | Older version pushed to the historical feature branch; later rectangular-corner and multiplicity rules were local-only | Complete manual/reference import; callable kernels pending |
| `dobot-layer-filling` | Pushed to the historical feature branch | Evidence reconciliation with `full-fill`/`planar-infill` pending |
| `dobot-non-planar-cladding` | Pushed to the historical feature branch | Evidence reconciliation with `draped-skin` pending |
| `dobot-spiral-lip` | Pushed to the historical feature branch | `vase-wall` successor/modifier pending |
| `dobot-programmer` | Pushed to the historical feature branch; later purge/ear rules local-only | Historical evidence only; current SAAM workflow supersedes it |
| `multiaxis-cross-layer-cylinder-cladding` | Pushed to the historical feature branch | Preview-only concept |
| `multiaxis-diagonal-rib-growth` | Pushed to the historical feature branch | Preview-only concept |
| `dobot-dog-ears` | Local-only before this import | Support/composer integration pending |
| `dobot-prime-lead-in` | Local-only before this import | Whole-plan/machine-policy integration pending |
| `dobot-reference-to-print` | Local-only before this import | Maker-workflow reconciliation pending |

## Migration rules

1. Preserve `ROBOT-CONFIRMED`, `KNOWN FAILURE`, `EXPERIMENTAL`, and related
   evidence labels exactly. Software tests do not promote physical evidence.
2. Treat historical Python helpers as deterministic specifications until they
   are replaced by shared SAAM geometry or wrapped through the current runtime.
3. Do not introduce a second print bundle, approval, preview, export or delivery
   pipeline. Current SAAM lifecycle rules supersede the legacy workflow.
4. Keep pattern decisions in the owning skill and representation queries in the
   shared geometry core.
5. Add machine-independent result generation where possible. Keep fixed-feed
   Struder/Dobot behavior in process or machine policy rather than universal
   geometry.
6. Add equivalent backend and configured-machine tests before registering a
   migrated skill in the plan schema, composer, Studio or MCP fixed list.

## Recommended implementation order

1. `dobot-patterned-wall`, beginning with a machine-independent
   triangular-touchback result and a circular touchback-loop fixture.
2. `dobot-prime-lead-in` and `dobot-dog-ears` through whole-plan travel/support
   composition.
3. `dobot-spiral-lip` as a supported successor to a level-ended `vase-wall`.
4. Reconcile measured layer-filling and non-planar evidence with the already
   implemented SAAM skills.
5. Retain the two multiaxis manuals as preview-only until orientation,
   kinematics and collision contracts are implemented.
