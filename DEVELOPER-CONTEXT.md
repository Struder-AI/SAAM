# Developer context

## Orientation

Developers own core skills, core capabilities, Studio and shared interfaces; builders compose existing interfaces ([role boundaries](AGENTS.md#choose-your-role)). The versioned intent docs in [plans](plans/) are the spec ([intent and rules](#intent-and-rules)); the [intent tree](intent/README.md) indexes current intent by area in the owner's words. Read the parts that bear on your work. The newest version's plan holds scheduled work. Onboarding supplies shared terms and this whole document; read map `0` yourself before editing.

### Working with dev maps

Walk the map before editing, on the same page the person reviews: read map 0, open the boxes you will change, read an arrow's `@link` for the leaf arrows it carries, then open source at the `file:lines` shown. Map reads never return code. When you add code, give each new declaration its map-0 owner in `dev-map/sets/030-architecture/ownership.json`; regenerate lists any leaf still unowned. Regenerate the set after each task. The [map guide](dev-map/README.md) owns commands and authoring.

**A link records influence between two pieces of SAAM: one can change what the other does or receives.** Its arrow points from the influencer to the influenced: a query's answer runs against the call, a command's activation with it. Maps exist so you can change a node knowing everything it affects and everything that affects it, without reading source to find out; a link's kind only says how the influence travels. The [dev maps intent](plans/dev-maps.md) owns the rebuild. Platform code (language, runtime, browser, packages) is modelled, never drawn as nodes. An absent link reads as "no influence", so influence that cannot be ruled out is drawn as possible. A generated link needs source evidence; file placement and a cleaner picture are none. Judge analysis work by whether the map's account of influence becomes more complete and truthful, not by the counts it changes.

Use `030-influence` for product work (toolkit default) and `030-deployment` for installation and service work; `030-architecture` is the authored top level they build on, where map-0 nodes, positions and contracts are authored. Follow [Code shape](#code-shape) when editing; map compatibility authorizes no unrelated work.

### Architectural discipline

You are working in a codebase whose owner is unusually explicit about architectural shape. Its past failures did not come from unclear requests; they came from competent work that quietly substituted an easier property for the structure asked for. Read this so you recognize that substitution in yourself before it happens.

#### The direction

We want complexity reduction. SAAM is being pulled toward a small number of deep, general operations. Inject, Trace and Slice are meant to be *how every technique is expressed*, not shared vocabulary draped over technique-specific lifecycles. Geometry owns construction, numerical representation and native lifetime, so that extensions like text, heat-set and gridfinity simply ask for ordinary geometry. Neutral toolpath completion knows nothing about the selected machine. Bundle is the only shared part-state authority. The same shape is wanted outside the engines. An operation runs when its own prerequisites exist; no stage order or complete recipe gates it.

#### The philosophy

Working code is not the bar. Complexity reduction is an outcome you can describe: fewer concepts a caller must understand, fewer lifecycle paths, fewer hidden dependencies, cases that no longer exist. Shorter functions, moved files and shared names are not that outcome.

Special cases are a red flag. Always ask "can there be fewer special cases if I did this differently"? The ones that survive need justification that matches current intent, not just historical.

Put the invariant in the operation boundary. If the operation still has the access or representation that permits the unwanted behavior, a reminder will not survive the next integration.

Consolidation is done when consumers use the general operation and the old routes are gone. An adapter that stays needs a current consumer and a concrete reason.

#### How it has gone wrong

**Proxy promotion.** A shared helper stood in for a general operation. Complete declaration assignment stood in for semantic containment. A shorter diagnostic list stood in for knowing callers and effects. Installer success stood in for a usable agent session. The internal map model stood in for the visible page. Each proxy was useful. The failure was calling it done.

**Preservation bias.** Old consumer expectations kept alive behind new names. A pass-through channel added to legalize exactly the coupling the refactor existed to remove. Keeping things working is a good instinct; here it defeated the purpose of the work.

**Loss through replacement.** Export capture was implemented correctly, then an integration reintroduced live currency checks. Compact map reads were corrected, then a new read path bypassed the presentation boundary and inflated every read. The right behavior existed; the replacement did not carry its semantics.

**Local completion reported as end-to-end.** An agent-originated test for a Studio-originated route. A bundled extension for an independent local one. Example parity for lifecycle consolidation. Focused evidence was honest, but it was treated as wider than it was.

**Restoring history.** The mirror failure matters just as much: bringing something back because a superseded decision, an overridden plan statement or an old note describes it. Current intent is the versioned plans read cumulatively, and the component manuals; anything they do not describe is absent by choice, not a regression.

#### What success has looked like

Architectural success has usually removed something. Geometry consolidation deleted the private native implementations; their owners became ordinary callers. Neutral/machine separation deleted machine facts from construction instead of hiding them behind a permitted import. Standalone Trace and Inject deleted the dummy-geometry assumption from the whole workflow, not from one generator. Operation-scoped validation deleted the mandatory recipe; each operation checks its own prerequisites. If you are doing consolidation work, and cannot name what your change removes, it is probably a proxy.

#### Reporting

Report against the obligation, not the work. State what the general operation now is, which callers changed, which routes are gone, and why any surviving case is physically necessary. Where you replaced a path, state what the old one did that the new one does not. Use one status: implemented, integrated, verified for a named scope, deferred, or superseded. Where your evidence covers less than the obligation, say exactly how much less and at which entrypoint. Partial work honestly scoped is worth more here than a narrower task reported as complete.

#### Intent and rules

State intent positively, at its one owner: what SAAM does, not what must never happen again. A ban outlives the situation it was written for and has to be remembered and revoked; a statement of current intent already excludes the alternatives and stays true until someone edits it. When direction changes, edit the owner, and nothing else needs revoking. The owner, 2026-10-06: "The versioned intent docs essentially define the spec unless something overrides it." Read them in order; a later statement overrides an earlier one only where they conflict. History (DECISIONS, DEVLOG) is reference, never authority.

## Rules

Hard rules for builders and developers. The same list appears in
[BUILDERS.md](BUILDERS.md#rules) and [DEVELOPER-CONTEXT.md](DEVELOPER-CONTEXT.md#rules);
change both together.

1. Hard rules come only in the owner's wording or with the owner's approval. An agent reacting to a complaint or a failure writes guidance or proposes a rule.
2. Staging, committing and pushing each need explicit authorization, which may already have been given in the conversation. Pushing to main and merging need authorization for those actions; a request to checkpoint is not a request to publish.
3. A checkpoint commits all non-ignored work in the checkout, including concurrent contributions, unless the user narrows it, and stays on the current branch.
4. Keep at most one pending branch per account and reuse it across tasks; edit on it rather than main unless direct main work is explicitly authorized.
5. Admitting a component or method from outside SAAM, or from superseded work, needs explicit human approval.
6. Record approvals as given, without widening their scope. Report software and physical results separately.
7. Work enters a release intent only on the owner's request or approval.
8. Preserve exact decision quotations, approval events, approved wording, and license, third-party or fixture provenance notices, with their dates.
9. A cap is never replaced by silent truncation: partial output must not pass as a complete result.

## Code shape

The code itself must show the scanner and human reviewer the influence between operations. These restrictions need the owner's explicit permission for a compelling exception:

1. No callable and no state in a reassigned binding: execution history would determine what runs or what a value is. Owned state lives in an explicit record or stateful boundary; a callback chosen once is a `const` or named function.
2. No callee chosen by an expression: the call site must name its callee.
3. A sequential stage may mutate exclusively owned inputs and hand the result forward. Ownership transfers with the data; earlier stages and other consumers must not retain access to the changing value. No hidden lookbacks to shared mutable sources. Bundle owns shared part state; private UI/session/job controllers own theirs. Copy only where ownership branches or a snapshot must survive.
4. A callable answers or acts: a query returns a value and has no effect another callable can observe; a command has effects and returns only its outcome (completed or failed, and the identity of what it created). Private caches and a leaf's own working state are not effects. Larger boxes relate both ways; [notation](plans/dev-maps.md#notation).
5. Avoid passthrough wires — generic code that routes values by keys known only at run time — without good reason; they increase complexity and reduce visibility.
6. Every tolerance names its class from [dimensions and tolerances](core/README.md#dimensions-and-tolerances) (print resolution, process scale, program resolution, numeric conditioning, display) or derives from the print's line width or layer height. Numeric conditioning guards robustness and never judges shape; a feature far below print resolution that an operation produces is closed and reported, not rejected. `check-repo` holds raw literals per file to a falling baseline.

Give conceptual stages and callbacks code names so clusters survive line edits. Apply the architectural discipline above before choosing scanner work; improve syntax resolution where an abstraction earns its place. Authorized architecture work includes these rewrites; an unrelated map read grants no extra scope.

## References and evidence
Open component manuals as needed: skills, [application](core/application/README.md), [exporters](core/export/DEVELOP.md) and [toolkit](core/agent/README.md) keep their own contracts. [Packaging](packaging/README.md) owns installation/publication; verify the checkout includes released source and the current publishing branch before deriving backlog from old notes. [DEVLOG](DEVLOG.md) owns release evidence; [checkpoint and publication guidance](CONTRIBUTING-AGENTS.md) covers committing.

Source establishes implementation, not physical results. Check concrete uncertainties and reuse evidence until its inputs change; completion adds no test gate.