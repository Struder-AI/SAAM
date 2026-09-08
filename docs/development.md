# Development foundation

## Setup and checks

The refreshed repository has documentation and repository checks, with no
manufacturing runtime or required npm dependencies. Node.js 22+ and Git are
enough to run `npm test`. No npm installation is needed for these checks.

`scripts/check-repo.mjs` checks local document links, decision-record structure
and approval metadata, and exclusion of private Prints and local artifacts.
It does not verify that a human actually approved a decision or that a part is
printable. CI runs the same command on branches and pull requests.

## Current organization

| Location | Purpose |
|---|---|
| AGENTS.md and docs/agents/ | Shared entry and maker/developer contexts |
| GLOSSARY.md | User-accessible meanings |
| DECISIONS.md | Contributor choices and recorded approvals |
| build_request.md | This cycle's scope and deferred implementation |
| skills/ | Skill-package guidance; implementations will own their manuals/tools/tests |
| machines/ | Machine-file guidance; no machine implementation yet |
| examples/prints/ | Specifically curated public examples |
| Prints/ | Ignored local print bundles |

Add shared file-format definitions when they are actually designed. Keep
skill-specific documentation in its package. No separate contracts or evidence
documentation hierarchy is needed now.

## Generation and review

The user approves geometry, then the locked process plan. Generate SAAMpath
directly from that complete plan, then produce an export in an output option
declared by the machine file. Finish automated checks before SAAM Studio runs
the exact export for the third approval: toolpath. Deliver those bytes unchanged.

Generation performs the calculations specified by the plan. It does not add
another planning stage. A plan must include the choices, settings and versions
required for repeatable generation. A random seed is only appropriate for a
future skill that deliberately randomizes a result, such as seam placement;
there is no mandatory seed field or randomized skill in this foundation.

## Rhino geometry

Rhino is the selected geometry platform and 3DM is the native geometry format.
Integration is deferred: establish which Rhino APIs/runtime are needed and how
installation/licensing works before building the first geometry skill. The
open rhino3dm library handles files and geometry, but is not the complete Rhino
computation engine. Required spline-surface intersections and feature-reference
behavior must be tested against the chosen integration.

## Studio feature references

Recommend click-to-select faces, edges and objects, paired with short visible
labels that the agent can also use. Two alternatives are a labelled feature
tree (useful for precise navigation) and screenshot markup (easy to begin with,
but ambiguous after edits). These can complement selection without becoming
extra approval steps. Choose and test the approach with real Rhino geometry.
References must identify a geometry version; do not silently redirect a label
to a different feature after an edit.

For toolpath review, the interpreter must support the selected export language
and required machine state. Unsupported commands, missing helper files, or
unknown setup must be resolved by automated checks before the viewer. A path
display alone cannot establish the behavior of an arbitrary machine program.

## Print bundle proposal

A print must include its process plan, SAAMpath and export. Recommend one
directory per print with the geometry and required setup/version information
also available, so reopening does not depend on missing local references.
The exact filenames and encoding are still open. A possible layout is:

```text
Prints/<name>/
  plan.json
  geometry/model.3dm
  path.saampath
  exports/<output-option>/
  review.json
```

`review.json` would hold version identifiers, check results and the three actual
human approvals. It is a proposed filename, not an implemented schema. Use
`examples/prints/` for curated examples, without exceptions to the private folder.

## Local map

The personal map lives in ignored `.local/architecture-map/`. Open its
`index.html` directly. Rebuild with `node .local/architecture-map/build.mjs`
when that local tool is present; it is not required for another contributor's
checkout. It resolves real document anchors and embeds their current excerpts.
Hand-authored relationships and runtime plans remain labelled as such.

## Legacy reference

The old implementation is outside the active tree. Its source remains in commit
`54093cadbe87020836916d53dd29a45a06bf5528`. In this working checkout, the old
folders are also hash-verified in ignored `.local/legacy-reference/54093cadbe870/`.
No old runtime component is adopted by this refresh. Inspect or import individual
components only when separately requested and approved.
