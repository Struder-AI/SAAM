# Checkpoint and publication guidance

Read this after doing the development work, immediately before an authorized
checkpoint or remote activity. Read it earlier when the task itself concerns
integration or publication. During-work guidance lives in [DEVELOP.md](DEVELOP.md).
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

Prefer working into main or integrating back frequently. Keep active pending
branches few; purpose-saved reference or experiment branches can remain separate.
Use intentional isolation when it helps the work, with a clear integration scope.

For imported work, apply [selective adoption](DEVELOP.md#context-and-selective-adoption).
State what is retained, withdrawn or deferred and any unresolved compatibility
question. Refresh affected agent guidance and restart affected long-running
services before relying on the integrated behavior.

## Record and publish

Update current manuals and record completed work and actual verification in
[DEVLOG.md](DEVLOG.md). Remove completed requests from [the open list](build_request.md),
leaving only unfinished work. Preserve the stated scope of approvals and decisions.

Reuse the evidence selected under [Avoid check spirals](DEVELOP.md#avoid-check-spirals).
Obtain only missing, applicable evidence for the change or required branch checks;
checkpointing, publication and rereading guidance do not invalidate valid results.

Staging, committing and publishing require explicit authorization, including
authorization already given in the conversation. Carry out that authorization
without asking again. The canonical destination is Struder-AI/SAAM; use the
requested branch or fork. Pushing to main and merging require authorization for
those actions. A request to checkpoint does not by itself request publication.

Report the resulting commit or remote state and any unresolved issue accurately.
Do not describe an uncommitted edit as checkpointed or a local commit as published.
