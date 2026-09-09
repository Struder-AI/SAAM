# Skills

A skill packages its own text instruction manual and callable tools. There is
one implemented manufacturing demo in this refresh:
[wedge-demo](wedge-demo/SKILL.md), for a horizontal-body/inclined-skin S5 wedge.

Each future package should keep its manual, tools, input definitions, examples
and tests together. The manual explains when to use the skill, what information
is needed, how to call its tools, and what its limitations are. Maker agents load
that manual when choosing or using the skill. Tools enforce their own inputs.

The wedge package contains its manual, scripts, references and tests. Agents
discover it through AGENTS.md and MAKERS.md. Do not invent placeholder
manufacturing capabilities or revive the old operation catalog.
Shared terms belong in [GLOSSARY.md](../GLOSSARY.md); development setup belongs
in [the developer notes](../DEVELOP.md).
