# Keep machine profile data with its captured inputs

2026-10-21. A completed output's machine snapshot retains the selected plain
profile data, including literal program templates. Reading later installed
templates during Export could change the meaning of the person's captured
selection; retaining that data makes future profile edits apply to future
selections. This refines [ADR 0002](0002-neutral-bundles-and-transient-export.md):
the Bundle still stores no generated machine program or executable adapter.

Older captures missing required template data remain inspectable and name what
is unavailable instead of borrowing a later profile. An explicit new selection
and completed output can use the current data without rewriting the historical
result. Executable writer identity is a separate unresolved provider interface;
this data decision does not activate that pending proposal.
