# Skills

A skill packages its own text instruction manual and callable tools. There are
no implemented manufacturing skills in this refresh.

Each future package should keep its manual, tools, input definitions, examples
and tests together. The manual explains when to use the skill, what information
is needed, how to call its tools, and what its limitations are. Maker agents load
that manual when choosing or using the skill. Tools enforce their own inputs.

The exact package layout and discovery mechanism are deferred. Do not invent
placeholder manufacturing capabilities or revive the old operation catalog.
Shared terms belong in [GLOSSARY.md](../GLOSSARY.md); development setup belongs
in [the developer notes](../docs/development.md).
