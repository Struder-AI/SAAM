# SAAM workspaces

Status: current user-directed policy, prepared for Evan's review. Evan's agreement
has not been recorded. [D-044](../DECISIONS.md#d-044--specialized-workspaces-and-shared-saam-functionality)
records the direction and approval status. This document owns workspace policy;
[INDEX.md](INDEX.md) lists the workspaces.

## Definitions

**SAAM** is the general-purpose slicing, geometry-editing and 3D-printing utility
and the shared functionality on which specialized applications can build.

A **workspace** is a specialized application dedicated to a particular task,
with one or more custom workflows. Its purpose is to create printable geometry.
Its design process may be closely informed by how that geometry will be printed.

A **workflow** is the task-specific process a workspace guides or performs:
the choices, design operations and outputs needed to accomplish its task.
The term also applies to SAAM's general making process; calling a sequence a
workflow does not by itself make it a workspace.

A **skill** provides a geometry or deposition capability that SAAM and workspaces
can use. A workspace owns the specialized application and orchestration around
those capabilities. A print bundle is a saved part, not an application.

SAAM Studio is SAAM's general review interface. A workspace may build on the SAAM
workbench or use an entirely different appearance and interaction model. The
workspace creator chooses the experience; no common visual shell is required.
“Design studio” may be a workspace's product name, but **workspace** is the
repository category.

## Relationship to SAAM

A workspace may provide any of these outputs or integration styles, together
or separately:

| Style | Workspace responsibility | SAAM relationship |
|---|---|---|
| Export geometry | Produce geometry for use elsewhere and explain its intended construction and limits. | Running SAAM printing is optional. |
| Hand off to SAAM | Supply geometry plus context for printing, such as orientation, material regions, process intent and proposed settings. | SAAM uses its shared recipe, generation, review and export interfaces. |
| Direct printing within the application | Guide printing choices closely and incorporate the current SAAM code and environment into the specialized experience. | Reuse SAAM's maintained implementations and contracts. |

Incorporating SAAM can mean importing, composing or packaging its maintained code.
A packaged dependency is not a separately maintained implementation. Workspaces
must not copy and independently evolve SAAM's core geometry, slicing, composition,
machine-export or print-lifecycle functionality into parallel implementations.
Changing the interface or embedding the environment does not change that boundary.
Improvements needed in shared functionality belong at their shared owner; the
workspace keeps its task-specific logic and adapters.

Each workspace documents which SAAM version or revision it uses, its integration
style, the context it passes and the current supported boundaries. Printing
context proposes intent; it does not constitute user confirmation or prove
printability. When producing machine output through SAAM, use the shared review,
confirmation and exact-byte export/delivery contracts. A different presentation
does not authorize a separate approval or export implementation. This policy
does not claim that an embedded review interface exists today.

## Repository organization and listing

Workspace application code, task-specific workflow guidance, assets and local
documentation belong in a distinct top-level directory for each workspace:

```text
workspaces/
  README.md                 # Shared workspace policy
  INDEX.md                  # Listing and attribution
  REVIEW.md                 # Review of the initial policy
  <workspace-id>/
    README.md               # Purpose, usage, status, integration and credits
    ...                     # This workspace's implementation and resources
```

Keep workspace implementations separate from `core/`, `studio/` and `skills/`.
A reusable geometry or toolpath skill stays under `skills/`; shared SAAM
functionality stays with its existing owner. A workspace may consume both.
Application-specific workflows must not be blended into the general skill
catalog or presented as core SAAM capabilities merely because they use SAAM.

Every workspace has one entry in [INDEX.md](INDEX.md), including prototypes and
incomplete applications. Its entry identifies the stable directory ID, purpose,
status, entry point, lead designer/main contributors, supporting contributors,
and support owner/status. This is the repository listing; it does not establish
a runtime discovery or launcher implementation.

Existing applications filed elsewhere must be listed with their actual location
and migration status until moved. A policy change does not silently rename APIs,
break imports or claim that a migration is complete.

## Attribution and support

Workspaces are expected to be predominantly community-created and are not
supported by Struder by default. Repository inclusion, use of SAAM, or a familiar
appearance does not establish Struder support or endorsement. Any explicit
Struder support commitment must state its scope.

Credit the lead designer and main contributors, as well as supporting
contributors, in both the workspace experience and its index entry. Keep credits
visible or readily accessible from the workspace, for example in an About/Credits
view; a Git history alone is insufficient. Identify contributions accurately and
include contributor links when supplied. Do not infer design credit or support
responsibility from branch names, commit authorship or an agent's implementation.
Record missing attribution as unconfirmed until established.

Each workspace's README owns its attribution and support statement; the index
and experience must agree with that record. State who maintains the workspace
or that no maintainer is designated. Workspace maintainers own their specialized
application, workflows and integration; SAAM's shared functionality retains its
own maintenance boundaries.

## Current transition

Wing design is an existing specialized application prototype presently filed
under `skills/wing-design/` on TK-DEV, absent from main. It is listed separately in the workspace index;
relocating its application and distinguishing any reusable geometry skill is a
subsequent implementation task. The current policy pass does not move code or
add runtime workspace support.
