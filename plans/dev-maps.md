# Dev maps intent

Owner direction, 2026-10-03 ([D-046](../DECISIONS.md#d-046--rebuilt-dev-maps-causal-arrows-and-banned-unmodelled-code), [D-047](../DECISIONS.md#d-047--command-outcomes-and-one-arrow-per-pair)). This document owns the intent for the rebuilt dev maps. [Developer context](../DEVELOPER-CONTEXT.md#working-with-dev-maps) carries the principle every developer applies; the [map guide](../dev-map/README.md) describes the current tool until the rebuild replaces it.

## Purpose

A developer or agent changes a piece of SAAM knowing everything it affects and everything that affects it, without reading source to find out. The standard is review ten times faster with four times the confidence. That holds only if the map is complete: an absent arrow must mean no influence.

## Arrows

Every arrow at every level means one thing: **causal influence, pointing from the code that can change something to the code whose behaviour or input it changes.** Calls, values and state are how influence travels, not separate meanings.

Each callable has one causal role:

- **Query**: it answers its caller and does nothing else. When A asks B, the arrow is B → A. B's code determines what A receives; A's arguments only shape the answer A gets back.
- **Command**: it acts. When A activates B, the arrow is A → B, and B's effects carry influence onward: B → C for data B hands to C, B → state for what it writes. A command may return its **outcome**: that it completed or failed, and the identity of anything it created. It returns nothing else its caller computes with.

An effect is a change another callable can observe; a private cache or a leaf's own working state is not one. Every leaf either answers or acts (command–query separation, with outcomes allowed); one that acts and also returns data its caller computes with is rewritten as a command and a query, because a returned value would hide its effects. Separation is a property of leaves: a box holding several leaves normally relates to another box in both directions.

B's effects are B's own arrows, read and checked at B. A decides whether to activate B and what to do with its outcome; it does not mediate what B does.

State is where influence waits between a write and a read. Bundle is the only shared part state; all other state belongs privately to one stateful boundary. Each piece of state is a node owned by its boundary: writes enter it and reads leave it (owner, 2026-10-04).

Outside parties are authored top-level actors, each reached through declared channels. The analysis detects each platform contact's kind (file, network, console, process and so on) and, where a kind serves several actors, its visible target (folder, URL, stream); each is assigned to one actor's channel, and a contact matching no channel is drawn as unassigned. A submap's actor shows only the channels present there. Console output is an effect on the actor reading it (owner, 2026-10-04).

## Notation

Every related pair of boxes is joined by **one** arrow, at every level, never by two separate arrows:

- **One head**: influence one way.
- **Head with a dot at the tail**: an activation that returns only its outcome (A •→ B).
- **Two heads**: influence both ways. Between leaves it marks a callable that acts and returns data, drawn until it is rewritten; between larger boxes it is the ordinary two-way relationship.

The stored relationships stay directional; the drawing joins a pair.

## Leaves

Every piece of SAAM code belongs to exactly one leaf, module load code included. A leaf is one callable with one causal role, opened as source. A callable folds into the leaf of its single entry, the one callable through which it is reached; a callback handed to the platform is reached through the callable that hands it over. A leaf stays within one file and takes the role of command if any member acts. A callable with several callers stays its own leaf; when it treats every caller the same way (a query reading no shared state), it belongs to its node's library, drawn on consumer maps as one box with one arrow per consumer box (owner, 2026-10-04). Leaves, their boundaries and their roles are computed from the analysis, never authored. Every leaf has at least one arrow: code with no causal effect does nothing, so it is removed. A leaf without arrows is either dead code to delete or an analysis gap to fix. Load code that only declares is the exception: it is listed without arrows, since code that does nothing is represented as doing nothing (owner, 2026-10-04). A leaf that drives many unrelated effects is a design problem the map exposes, not a reason for a larger leaf. Leaf internals are read as source, not drawn.

## Levels

- **Top level, authored.** The owner authors the top-level structure of each set (architecture, deployment): its nodes, their page positions and the arrows they permit, each a contract. Every leaf has exactly one top-level owner.
- **Leaves, generated** from source by analysis.
- **Between them, solved.** Higher-level arrows are derived, never authored: two boxes are linked when some leaf arrow runs from inside one to inside the other, and the link carries the leaf arrows it stands for. The top level's derived arrows are checked against its authored ones.
- **The solver works middle-out**: authored nodes fixed above, leaves below. It groups each authored node's leaves into nested maps and never moves a leaf across an authored boundary. The starting objective is the existing size, edge, hub, island and balance penalties ([score.mjs](../dev-map/lib/score.mjs)) over influence arrows. Backflow, arrows against a map's best left-to-right order and so cycles among its boxes, is left out for now. Labels come from label passes; the solver runs when the owner asks.

Arrow direction plus role already says who calls whom: a query's arrow runs against the call. Separate authored access lists, such as those in the [0.3.1 contracts](0.3.1.md), become derivable and retire once the checks cover them.

## What SAAM code is

The map is complete only if the analysis models all code. These are the owner's hard rules; the checks reject anything else as an error at its source location, not as a finding to accumulate:

- **SAAM code uses only shapes the analysis models.** Supporting a new shape is a deliberate decision, weighing its value against the cost of modelling it. Platform APIs are included: SAAM uses the APIs whose influence is modelled.
- **Influence between top-level nodes follows authored arrows.**
- **Every leaf answers or acts**, returning at most its outcome when it acts.
- **Every leaf has an arrow.**

The [code-shape rules](../DEVELOPER-CONTEXT.md#code-shape) are consequences of these.

## Potential, not actual

The analysis represents every influence the code could exert, not whether a given run exerts it. False possibilities are minimised, not eliminated, and drawn marked as possible. Because influence across an authored boundary must follow an authored arrow, a false possibility there forces a rewrite of legitimate code. Spend precision at authored boundaries first, and give boundary code shapes the analysis can prove separate.

## Analysis

Inclusion-based points-to analysis (Andersen), field-sensitive, with the call-site context that keeps one caller's values from returning to another. Every call is wired in every context; speed is judged on this sound analysis only. Everything is computed, never authored. The way to usable speed is whatever measures best: a full solve whose results, such as per-function summaries, let an edit re-analyse only what it reaches; summaries composed over the call graph; or an engineered incremental solver. Call targets, roles and arrows are derived from the result. It uses the existing parser; any new dependency needs owner approval.

Regeneration must be fast enough to use while working, refreshing as code changes; the measure is usability, not improvement over the old scanner, which was too slow for that. Maps regenerate after each task, placing new leaves; full solves run when the owner calls for them, and orchestrators suggest one when the solve is very stale. Cluster labels are authored by agents and reviewed by the owner. Incremental analysis, refreshing as each edit is saved, follows once development uses the maps (owner, 2026-10-04). Completeness is checked against behaviour: traces from real Studio and agent runs must show no influence the map lacks, and a miss is an analysis bug.

## Scope

**Analysed:** all SAAM code that runs when SAAM is used, including code in other processes, which connect through modelled channels such as worker messages, HTTP and files; also skill scripts, demos and examples included (owned by Extensions: they meet the engines through the extension interface) and development tooling (its own top-level node), so changes show what they break (owner, 2026-10-04).

**Platform:** language, runtime, browser, Node and third-party packages, including WASM libraries. Platform code is modelled, never drawn as nodes.

**Boundaries:**
- SAAM's own native code is a declared boundary with an authored contract until it is analysed.
- Every extension, bundled or installed locally, meets SAAM at the extension interface: a fixed contract per entry type. The analysis resolves bundled extensions through their manifests and draws their code; a local extension it cannot see is checked against the contract.

**Out of scope:** tests and benchmarks.

The owner may adjust scope.

## Milestones

1. **Speed.** Prototype the analysis on a small region; time parsing, constraint generation, solving and arrow derivation; report sizes and extrapolate. No maps or checks.
2. **Whole scope.** Platform models for the APIs SAAM uses; inventory of unmodelled shapes, each for the owner to model or rewrite; query/command classification; comparison against runtime traces.
3. **Checks.** Unmodelled shapes, ownership coverage, top-level arrows and query/command separation, as errors.
4. **Maps.** Derived levels, the middle-out solver, the viewer, and the [read contract](../dev-map/README.md#commands) on the CLI, toolkit and onboarding routes.
5. **Authored placement.** The owner places nodes by dragging them in the viewer; wires follow live and positions persist as authored data (owner, 2026-10-04: a high-level objective).
6. **Retirement.** Remove the old scanner, scope configuration, finding classes and their documentation.

## Open decisions

- **SAAM's own native code**: when and how to analyse it.
