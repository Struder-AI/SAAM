# Checkpoint and publication guidance

This covers checkpoints and remote activity; it is most useful just before them.
During-work guidance lives in [BUILDERS.md](BUILDERS.md). Reading it does not
trigger another verification pass.

## Reconcile the contribution

Review the actual diff against the current repository state. Account for changes
to behavior, defaults, shared interfaces and agent guidance as well as code
conflicts. Use the work, source history and recorded context to distinguish
contributions; preserve unrelated edits. If ownership or intent remains ambiguous
and affects integration, present the specific conflict rather than guessing.

Checkpoint scope and authorization are [rules](BUILDERS.md#rules). A checkpoint records
the shared state; it does not declare every contribution complete, reviewed or
approved for adoption. Agents can perform technical review; no coordinator or
human reviewer is assumed.

Publish the account's pending branch for a pull request into main. Remove
temporary repair branches after integration.
Use intentional isolation when it helps the work, with a clear integration scope.

For imported work, apply [selective adoption](BUILDERS.md#context-and-selective-adoption).
State what is retained, withdrawn or deferred and any unresolved compatibility
question. Refresh affected agent guidance and restart affected long-running
services before relying on the integrated behavior.

## Record and publish

Update current manuals and record completed work and actual verification in
[DEVLOG.md](DEVLOG.md). Update the work's status in its release intent.

Reuse the evidence selected under [Avoid check spirals](DEVELOPER-CONTEXT.md#avoid-check-spirals).
Obtain only missing, applicable evidence for the change or required branch checks;
checkpointing, publication and rereading guidance do not invalidate valid results.

Before pushing, consider whether the resulting remote branch will be complete
for its intended scope, including concurrent work carried by local checkpoints.
Prefer publishing a complete result at the pushed head; intermediate checkpoint
commits can contain unfinished work. Intentional work-in-progress pushes are
appropriate when useful for collaboration or another stated purpose; identify
what remains unfinished. This is a judgment reminder, not a hard publication gate,
an additional approval requirement or another test pass.

Carry out authorization already given without asking again. The canonical
destination is Struder-AI/SAAM; use the requested branch or fork.

Report the resulting commit or remote state and any unresolved issue accurately.
