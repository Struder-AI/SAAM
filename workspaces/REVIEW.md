# Workspace policy review with Evan

Prepared 2026-09-30 from the current user's instructions following a conversation
with Evan. The [policy](README.md) is recorded as user-directed guidance for this
checkout. Evan has not reviewed or approved this wording in this chat. The requester will
ask Evan to review and modify the policy through the normal pull-request process
and discuss it with him directly; the agent does not contact Evan.

## Definition for agreement

A SAAM workspace is a specialized application with custom workflows for a
specific task, intended to create printable geometry. It can understand and
direct how its output will be printed. Its creator chooses the interface.
SAAM provides the maintained general geometry, slicing and printing functionality.

## Points to review

1. Workspaces may export geometry, hand geometry and printing context to SAAM,
   or incorporate the current SAAM environment for closer printing control.
2. Incorporation reuses maintained SAAM code; it must not create independently
   maintained copies of core functionality.
3. Each workspace has a separate directory under `workspaces/`, distinct from
   core and skills, and an entry in the workspace index.
4. Main and supporting contributors receive credit in the workspace experience
   and index. Missing attribution is explicit rather than invented.
5. Workspaces are mostly community-created and receive no Struder support by
   default; explicit exceptions identify their scope and maintainer.
6. A workspace may use the SAAM workbench or an entirely different experience.

The proposed implementation convention is `workspaces/<workspace-id>/` with
`workspaces/INDEX.md` as the initial listing. Existing wing-design application
code remains in its current location until a separate migration is carried out.

## Review record

| Reviewer | Status | Evidence |
|---|---|---|
| Current requester | Directed the policy and its inclusion in SAAM. | This chat, 2026-09-30; [D-044](../DECISIONS.md#d-044--specialized-workspaces-and-shared-saam-functionality). |
| Evan | Pending; no agreement recorded. | Record explicit agreement or requested changes to this wording when received. |

Resolve wording changes in the owning policy and record the actual review
outcome in D-044. Silence, repository inclusion and agent work do not establish
Evan's agreement.
