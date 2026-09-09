# SAAM — Struder Agentic Additive Manufacturing

SAAM lets you describe a part to an AI agent, inspect the toolpath it proposes,
approve it, and get a file your machine can run.

The aim is a seamless, reliable path into 3D printing for non-technical people,
with guidance suited to their experience. SAAM is an ecosystem of slicer
components, including planned support for angled and curved deposition layers.

**First development demo:** an UltiMaker S5 wedge with horizontal body layers
and a 15° inclined skin. It includes native Rhino geometry, SAAMpath, Griffin
G-code, automated checks, and a local **SAAM Studio** viewer. Software validation
is implemented; physical printing remains unvalidated. Standard S5 startup is
assumed, and installed firmware information is optional.

- Agents: start at [AGENTS.md](AGENTS.md).
- Product direction: [PROJECT_CHARTER.md](PROJECT_CHARTER.md).
- Contributor decisions: [DECISIONS.md](DECISIONS.md).
- Shared terms: [GLOSSARY.md](GLOSSARY.md).
- Completed scope and deferred work: [build_request.md](build_request.md).
- Developer rules, setup, formats, and organization: [DEVELOP.md](DEVELOP.md).
- Maker guidance: [MAKERS.md](MAKERS.md).

With Node.js 22+ and Git:

```sh
npm ci
npm test
npm run demo
npm run studio
```

Open [SAAM Studio](http://127.0.0.1:4321). The demo uses right nozzle #2,
AA 0.4 and PLA at 215°C. Its development preview creates no human approvals.
Physical clearance is the operator's responsibility for this demo.
Read the [wedge skill](skills/wedge-demo/SKILL.md) for the three-approval workflow.

Local print bundles belong in ignored `Prints/`; curated examples belong in
`examples/prints/`. A personal architecture map may live in ignored
`.local/architecture-map/`; it is optional and is not shipped in the repository.

The previous runtime was removed from the active tree and remains recoverable
from Git history. No legacy component has been adopted.
See [legacy reference](DEVELOP.md#legacy-reference).

The canonical repository is [Struder-AI/SAAM](https://github.com/Struder-AI/SAAM).
Licensing remains in [LICENSE](LICENSE).
