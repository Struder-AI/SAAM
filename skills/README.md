# Skills

A skill packages its own text instruction manual and callable tools. Three
manufacturing packages are implemented in this refresh:

| Skill | Scope | Status |
|---|---|---|
| [wedge-demo](wedge-demo/SKILL.md) | Horizontal-body/inclined-skin S5 wedge | Full workflow: Studio review, three approvals, delivery. No physical print. |
| [full-fill](full-fill/SKILL.md) | Solid planar layers for any closed shell | Development preview only. No Studio, no approvals, no physical print. |
| [draped-skin](draped-skin/SKILL.md) | Surface-following skins under the machine's non-planar angle limit | Development preview only. No Studio, no approvals, no physical print. |

full-fill and draped-skin generalize the wedge demo's two patterns to any closed
shell of untrimmed spline patches. They share the slicing core in `core/` and a
single plan, described in [the developer notes](../DEVELOP.md#shell-pipeline-full-fill-and-draped-skin).
The wedge demo is unchanged and remains the only package wired to the reviewed
approval workflow.

Each future package should keep its manual, tools, input definitions, examples
and tests together. The manual explains when to use the skill, what information
is needed, how to call its tools, and what its limitations are. Maker agents load
that manual when choosing or using the skill. Tools enforce their own inputs.

Each package contains its manual, scripts and tests. Agents discover them
through AGENTS.md and MAKERS.md. Do not invent placeholder manufacturing
capabilities or revive the old operation catalog. Describe each package's status
as it is: a development preview is not an approved program.
Shared terms belong in [GLOSSARY.md](../GLOSSARY.md); development setup belongs
in [the developer notes](../DEVELOP.md).
