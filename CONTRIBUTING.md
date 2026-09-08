# Contributing to SAAM

Start with [AGENTS.md](AGENTS.md), [the charter](PROJECT_CHARTER.md), and
[build requests](build_request.md). This refresh is a documentation foundation;
manufacturing skills and runtime interfaces are still to be designed.

Keep changes focused. Follow [development guidance](docs/agents/develop.md),
run `npm test`, and describe what changed and how it was verified.
A future skill should package its manual, tools, examples, and relevant tests;
see [skills](skills/README.md). Previous components require explicit approval
before adoption.

[Decisions](DECISIONS.md) record contributor agreement separately from progress.
Do not infer approval by either contributor.

The canonical repository is [Struder-AI/SAAM](https://github.com/Struder-AI/SAAM).
Publish an authorized feature branch there when you have access; contributors
without access may use a fork. Request review through a pull request.
Agents need explicit authorization to commit or publish and must not merge
their own pull requests. Making a personal print is not a source contribution.

Personal prints and local development artifacts stay ignored. Share only
specifically curated examples under `examples/prints/`.

By contributing, you agree to license your contribution under the
[Apache License 2.0](LICENSE). Preserve applicable attribution and record imported
material in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
Participation follows [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
