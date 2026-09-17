# Checkpoint and publication guidance

Read this after doing the development work, immediately before an authorized
checkpoint or remote activity. Read it earlier when the task itself concerns
integration or publication. During-work guidance lives in [BUILDERS.md](BUILDERS.md).
Reading this document does not trigger another verification pass.

## Reconcile the contribution

Review the actual diff against the current repository state. Account for changes
to behavior, defaults, shared interfaces and agent guidance as well as code
conflicts. Use the work, source history and recorded context to distinguish
contributions; preserve unrelated edits. If ownership or intent remains ambiguous
and affects integration, present the specific conflict rather than guessing.

When a checkpoint is authorized, commit all current non-ignored work in the
checkout by default, including concurrent contributions and unfinished increments.
Do not split the checkpoint by originating task or selectively stage only your
own edits. Honor explicit exclusions or a request for a narrower commit. Preserve
existing work and stay on the checkout's current branch. A checkpoint records
the shared state; it does not declare every contribution complete, reviewed or
approved for adoption. Do not assume that a dedicated coordinator or human
reviewer has been assigned. Agents can perform technical review.

Keep at most one active pending branch per account. Reuse it across tasks;
create a branch before editing on main only when that account has no active
development branch. Publish that branch for a pull request into main.
Direct main publication requires an explicit request for that action, such as
an authorized repair. Remove temporary repair branches after integration.
Use intentional isolation when it helps the work, with a clear integration scope.

For imported work, apply [selective adoption](BUILDERS.md#context-and-selective-adoption).
State what is retained, withdrawn or deferred and any unresolved compatibility
question. Refresh affected agent guidance and restart affected long-running
services before relying on the integrated behavior.

## Record and publish

Update current manuals and record completed work and actual verification in
[DEVLOG.md](DEVLOG.md). Remove completed requests from [the open list](build_request.md),
leaving only unfinished work. Preserve the stated scope of approvals and decisions.

Reuse the evidence selected under [Avoid check spirals](BUILDERS.md#avoid-check-spirals).
Obtain only missing, applicable evidence for the change or required branch checks;
checkpointing, publication and rereading guidance do not invalidate valid results.

Before pushing, consider whether the resulting remote branch will be complete
for its intended scope, including concurrent work carried by local checkpoints.
Prefer publishing a complete result at the pushed head; intermediate checkpoint
commits can contain unfinished work. Intentional work-in-progress pushes are
appropriate when useful for collaboration or another stated purpose; identify
what remains unfinished. This is a judgment reminder, not a hard publication gate,
an additional approval requirement or another test pass.

Staging, committing and publishing require explicit authorization, including
authorization already given in the conversation. Carry out that authorization
without asking again. The canonical destination is Struder-AI/SAAM; use the
requested branch or fork. Pushing to main and merging require authorization for
those actions. A request to checkpoint does not by itself request publication.

Report the resulting commit or remote state and any unresolved issue accurately.
Do not describe an uncommitted edit as checkpointed or a local commit as published.
