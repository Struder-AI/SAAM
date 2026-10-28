# Source agent toolkit

Making, Studio, tours, chat attachment, requests and workspace jobs belong to the
[SAAM application](../application/README.md). This toolkit reads published source
guidance; it creates no runtime, Studio, request journal or diagnostics service.
[MAKERS](../../MAKERS.md), [BUILDERS](../../BUILDERS.md) and
[developer context](../../DEVELOPER-CONTEXT.md) own their roles.

Run from the checkout root:

```powershell
node scripts/agent-toolkit.mjs builder-onboarding --area skills
node scripts/agent-toolkit.mjs developer-onboarding --area core/geom
node scripts/agent-toolkit.mjs read-guidance docs/adr/0001-text-architecture-and-local-dev-maps.md
node scripts/agent-toolkit.mjs read-skill text --maker --builder --machine ultimaker-s5
node scripts/agent-toolkit.mjs read-guidance MAKERS.md#standard-parameter-policy
node scripts/agent-toolkit.mjs context-budget
```

Developer onboarding supplies the glossary, concise developer context and
explicitly selected --area manuals.

All roles receive [shared local notes](../application/README.md#local-agent-notes).
Installed maker work uses `saam call maker_onboarding`; maker-onboarding here is a
source context read. Skill reads default to maker; --maker, --builder and --developer
select roles. Missing optional manuals are reported. ID#heading reads a complete
maker section; --machine opens applicable advanced sections and --all opens everything.
The reader returns published links, omitted headings/gates and unreadable markers.

The developer-only [context-budget](../../scripts/context-budget.mjs) measures
assembled manuals and the application operation catalog
without starting the app or release service. Its isolated temporary print library
is disposed after its Runtime closes, including measurement failures. Ordinary
guidance layers contain no Runtime measurement code. Outputs are JSON; failures set a nonzero exit code.

`context-operations.mjs` owns application maker onboarding, skill/workspace discovery
and published manual reads. Runtime retains schemas, validation, Studio/session
authority and response delivery. Context prepares manual selection or local fallback
and reads maker notes first. The caller captures saved Bundle machine settings;
Context then loads selected source text, and the caller resolves a named profile
only when no saved selection exists. Context assembles from captured values.
Saved null settings remain generic instead of falling back to `machineId`.
Context also receives the
selected home paths, runtime notice and local manual providers; it does not acquire
Studio work, execute extensions or construct bundles.

Context receives no Bundle/Settings callback and performs no profile lookup.
`local-notes.mjs` owns notes reads and revisioned writes, including home identity,
conflict checking, locking and atomic replacement. The Application notes module
retains compatibility exports and its presentation-colour reader.

The five public inputs and replies retain their existing shapes:

| Operation | Domain input | Context reply |
| --- | --- | --- |
| `maker_onboarding` | optional `machineId`, `bundleId` | role, setup/runtime notices when present, notes identity/revision/text, sources, nextStep |
| `list_skills` | none | sorted skills with manual links, extension origin/digest/kind, optional skipped |
| `list_workspaces` | none | selected workspace identities and manual links |
| `read_skill` | `skillId` with optional heading, optional `machineId`, `bundleId` | skillId, manual and complete reader reference/gate/omission metadata, or local provider reply |
| `read_guidance` | `guidanceId` with optional heading, optional `machineId`, `bundleId` | published manual/example and complete reader reference/headings/gate/omission metadata |

Runtime continues adding remembered Studio-target inputs and tracked bundle request
inputs, validating them, and attaching the existing Studio/work/request/result envelope.
Declared queries never automatically open or attach Studio or record durable
request activity. Request ownership and remembered Studio-target guards still run;
explicit delivery, claim and review commands retain their effects.

`read_contract_source` reads complete `{file,text}` from the selected version's
published source. Packaging records its exact selected files
in `published-source.json`; explicit checkouts use the same publication filter on
tracked files. Reads require published file identity and real-path containment,
excluding private/local data and dependencies. Installed reads need no Git or
writable core. `published-source.mjs` owns source enumeration, containment and
complete reads. Its `publishedSourceFiles(root)` explicitly lists that publication;
onboarding does not enumerate it.
Runtime owns `read_contract_observations`, which lists
retained observation metadata or reads one captured typed occurrence by `id`.

Installed extension authors use `saam call builder_onboarding` through desktop chat.
It returns the builder/maker/authoring/example manuals,
selected extension discovery, shared notes, extensionFolder and publication identity
from this installation's release metadata (or source-package identity in a checkout).
Local copies override bundled extensions with the same ID for both access paths.
Source toolkit onboarding remains available for explicitly chosen checkout work.

`get_studio_events` is observational: repeat reads return the same pending events.
Its `cursor` (also `studioEventCursor` on ordinary results) can be passed to
`ack_studio_events` as `throughSeq` after delivery. `afterSeq` reads retained events
after a known cursor; history remains bounded and labels elided observations.
`claim_studio_requests` explicitly claims `requestIds` after original selection and
ownership validation and returns `{status:'completed',requestIds}`; read current
request views separately. Acknowledgement returns `{status:'completed',throughSeq}`.
`wait_for_studio_request` remains a command adapter: it waits,
acknowledges returned event delivery, and preserves optional `claim:true`. It creates
no fabrication edit or work episode merely by waiting.

Complete invocation schemas remain available through ordinary operation help.
