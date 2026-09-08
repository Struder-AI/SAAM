# SAAM — Struder Agentic Additive Manufacturing

SAAM lets you describe a part to an AI agent, inspect the toolpath it proposes,
approve it, and get a file your machine can run.

The aim is a seamless, reliable path into 3D printing for non-technical people,
with guidance suited to their experience. SAAM is an ecosystem of slicer
components, including planned support for angled and curved deposition layers.

**Refresh foundation:** agent guidance, decisions, a glossary, development
requests, and repository checks are ready. The manufacturing runtime is not
implemented. Rhino/3DM is selected for geometry, SAAMpath names the internal
toolpath representation, and the user interface is named **SAAM Studio**.

- Agents: start at [AGENTS.md](AGENTS.md).
- Product direction: [PROJECT_CHARTER.md](PROJECT_CHARTER.md).
- Contributor decisions: [DECISIONS.md](DECISIONS.md).
- Shared terms: [GLOSSARY.md](GLOSSARY.md).
- Completed scope and deferred work: [build_request.md](build_request.md).
- Setup, organization, and design proposals: [Development foundation](docs/development.md).

Run `npm test` with Node.js 22+ and Git. These are repository checks, not
manufacturing tests. No npm dependencies are required.

Local print bundles belong in ignored `Prints/`; curated examples belong in
`examples/prints/`. A personal architecture map may live in ignored
`.local/architecture-map/`; it is optional and is not shipped in the repository.

The previous runtime was removed from the active tree and remains recoverable
from Git history. No legacy component has been adopted.
See [legacy reference](docs/development.md#legacy-reference).

The canonical repository is [Struder-AI/SAAM](https://github.com/Struder-AI/SAAM).
Licensing remains in [LICENSE](LICENSE); imported material is recorded in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
