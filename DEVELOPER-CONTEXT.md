# Developer context

Developers implement core skills, core capabilities, Studio and shared interfaces.
Developer onboarding supplies the glossary, this briefing and any explicitly
selected component manuals. Build implementation details using source and existing
interfaces; existing API/schema and component documentation remain available on
demand.

## Rules

Hard rules for builders and developers. The same list appears in
[BUILDERS.md](BUILDERS.md#rules) and [DEVELOPER-CONTEXT.md](DEVELOPER-CONTEXT.md#rules);
change both together.

1. Hard rules come only in the owner's wording or with the owner's approval. An agent reacting to a complaint or a failure writes guidance or proposes a rule.
2. Make local checkpoints at sensible intervals without asking; this includes staging and committing. Pushing and merging still need explicit authorization, which may already have been given in the conversation. A checkpoint is not a request to publish.
3. A checkpoint commits all non-ignored work in the checkout, including concurrent contributions, unless the user narrows it, and stays on the current branch.
4. Keep at most one pending branch per account and reuse it across tasks; edit on it rather than main unless direct main work is explicitly authorized.
5. Adding or restoring a third-party package or dependency (such as CGAL or Manifold) needs explicit human approval. This requirement does not apply to methods or to using, adapting or copying algorithms.
6. Record approvals as given, without widening their scope. Report software and physical results separately.
7. Work enters a release intent only on the owner's request or approval.
8. Preserve exact decision quotations, approval events, approved wording, and license, third-party or fixture provenance notices, with their dates.
9. A cap is never replaced by silent truncation: degrade and label partial output.


## Verification and delivery

Inspect the affected source, callers and state ownership. The person defines the
lasting product checks; developers implement them. Run the checks a change affects
against the changed implementation and its relevant producers and consumers to
detect product degradation, and retain them as the implementation changes. Where
coverage is missing, identify the specific promise without a check rather than
treating unrelated passes as evidence for it. Establish working scopes as needed
rather than requiring checks for the whole codebase first. Test-file storage and
invocation are described in the [test reference](core/tests/README.md).

Temporary tests answer questions about new work: reproducing a defect, comparing a
replacement with its predecessor, measuring an optimization or exercising a new
interaction. Run them, resolve the question and delete them; a finding about an
enduring obligation informs the corresponding lasting check. Temporary tests do not
become a second product specification, and being able to reason out an expected
result does not make execution unnecessary. Exercise the actual entry path for the
behavior claimed; backend checks alone do not establish browser interactions.

These are checks **on** the product. Validation and audits **inside** the product
pipeline are product behavior: justify their failure case, ownership, runtime cost
and placement, and reuse the owning result for unchanged inputs. Development checks
do not justify adding repeated validation to normal generation or Export.

Reuse evidence while the behavior, inputs and implementation it establishes remain
applicable. Broaden or repeat checking for a relevant change, failure or unresolved
question; a checkpoint or task boundary alone creates no verification work. Follow
checkout-local limits on whole-suite runs. Report what was established and its
remaining limits, distinguishing source reasoning, executed behavior and physical
results. Follow [checkpoint/publication guidance](CONTRIBUTING-AGENTS.md).
