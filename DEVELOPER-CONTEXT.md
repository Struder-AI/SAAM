# Developer context

## Orientation

Developers own core skills, core capabilities, Studio and shared interfaces; builders compose existing interfaces ([role boundaries](AGENTS.md#choose-your-role)). Read [0.3.3 intent](plans/0.3.3.md), [0.3.2 scope/evidence](plans/0.3.2.md) and [retained contracts](plans/0.3.1.md) for the work you undertake. Onboarding supplies shared terms, this whole document and visible map `0`.

### Working with dev maps

Walk the selected map before editing to understand operations, callers and consequences on the same visible page the person reviews. Maps return relationships and exact source ranges; read those files for internals. Link/contract addresses return complete interfaces; leaves need no further map read. The [map guide](dev-map/README.md) owns terminology, scope, commands and authoring; its [single read contract](dev-map/README.md#commands) applies to replacement integrations.

**A link records influence between two pieces of SAAM: one can change what the other does or receives.** Its arrow points from the influencer to the influenced: a query's answer runs against the call, a command's activation with it. Maps exist so you can change a node knowing everything it affects and everything that affects it, without reading source to find out; a link's kind only says how the influence travels. The [dev maps intent](plans/dev-maps.md) owns the rebuild now under way. Platform code (language, runtime, browser, packages) is not SAAM: our edits cannot change it, so calls into it are counted, never linked. An absent link reads as "no influence", so influence that cannot be ruled out stays visible, as a possible link or a finding. A generated link needs source evidence; file placement, authored nesting and a cleaner picture are none. Design contracts state intended influence, which the audit checks. Judge scanner work by whether the map's account of influence becomes more complete and truthful, not by the counts it changes.

Use `030-architecture` for product work (toolkit default), `030-deployment` for installation/service work, and `default` only for scanned implementation evidence. Always pass `--set` to the lower-level CLI, which defaults to `default`. Never exchange indexes between sets; use indexes in discussion and stable declaration/contract identities in records. Authored designs express intent, not proven implementation: regenerate redraws; audit and audit-check assess implementation and freshness. Scanned regenerate rescans. Follow [Code shape](#code-shape) when editing; map compatibility authorizes no unrelated work.

### Architectural discipline

You are working in a codebase whose owner is unusually explicit about architectural shape. The failures of the past month did not come from unclear requests, they came from competent work that quietly substituted an easier property for the structure asked for. Read this so you recognize that substitution in yourself before it happens.

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

The mirror failures matter just as much. Deliberate removals (ribbons, templated shapes, general gap fill, the three-approval ceremony, web relay) and deliberate changes (vase family direction, source-only leaf panes, deferred material overlap) are not regressions. Reading an old decision and restoring what it describes is MORE damaging than dropping a live obligation.

#### What success has looked like

Architectural success has usually removed something. Geometry consolidation deleted the private native implementations; their owners became ordinary callers. Neutral/machine separation deleted machine facts from construction instead of hiding them behind a permitted import. Standalone Trace and Inject deleted the dummy-geometry assumption from the whole workflow, not from one generator. Operation-scoped validation deleted the mandatory recipe; each operation checks its own prerequisites. If you are doing consolidation work, and cannot name what your change removes, it is probably a proxy.

#### Reporting

Report against the obligation, not the work. State what the general operation now is, which callers changed, which routes are gone, and why any surviving case is physically necessary. Where you replaced a path, state what the old one did that the new one does not. Use one status: implemented, integrated, verified for a named scope, deferred, or superseded. Where your evidence covers less than the obligation, say exactly how much less and at which entrypoint. Partial work honestly scoped is worth more here than a narrower task reported as complete.

## Code shape

The code itself must show the scanner and human reviewer the influence between operations. These restrictions need the owner's explicit permission for a compelling exception:

1. No callable and no state in a reassigned binding: execution history would determine what runs or what a value is. Owned state lives in an explicit record or stateful boundary; a callback chosen once is a `const` or named function.
2. No callee chosen by an expression: the call site must name its callee.
3. A sequential stage may mutate exclusively owned inputs and hand the result forward. Ownership transfers with the data; earlier stages and other consumers must not retain access to the changing value. No hidden lookbacks to shared mutable sources. Bundle owns shared part state; private UI/session/job controllers own theirs. Copy only where ownership branches or a snapshot must survive.
4. A callable answers or acts, never both: a query returns a value and has no other effect; a command has effects and returns nothing its caller computes with ([open acknowledgement question](plans/dev-maps.md#open-decisions)).

Give conceptual stages and callbacks code names so clusters survive line edits. Apply the architectural discipline above before choosing scanner work; improve syntax resolution where an abstraction earns its place. Authorized architecture work includes these rewrites; an unrelated map read grants no extra scope.

## References and evidence
Open component manuals as needed: skills, [application](core/application/README.md), [exporters](core/export/DEVELOP.md) and [toolkit](core/agent/README.md) keep their own contracts. Exclusion from the original scanned map does not exclude them from release audit. [Packaging](packaging/README.md) owns installation/publication; verify the checkout includes released source and the current publishing branch before deriving backlog from old notes. [DEVLOG](DEVLOG.md) owns release evidence; read [checkpoint/publication rules](CONTRIBUTING-AGENTS.md) immediately before committing.

Source establishes implementation, not physical results. Check concrete uncertainties and reuse evidence until its inputs change; completion adds no test gate. Historical work is reference only, including [0.3.0 installation intent](plans/0.3.0.md); honor the [September 12 withdrawal](DECISIONS.md#d-029--withdraw-september-12-contributions-and-vet-readmission). The [active-work upgrade policy](plans/0.3.1.md#retained-behavior-and-extensions) governs saved bundles: preserve passive viewing and invalidate stale reconstruction/output when work resumes.
