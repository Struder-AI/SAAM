# SAAM product direction

Status: provisional direction from remettub; see [DECISIONS.md](DECISIONS.md).

> SAAM lets you describe a part to an AI agent, inspect the toolpath it proposes,
> approve it, and get a file your machine can run.

SAAM lowers the barrier to 3D printing. A non-technical person should be able to
point their agent at the repository, describe what they want, receive guidance
and appropriate clarifications, and obtain a machine-compatible file. The
experience should empower new users relative to existing slicer workflows.

SAAM is an ecosystem of slicer components. Its intended scope includes spline
curves and bivariate spline surfaces, angled and nonplanar deposition layers, 3d printers, robot arms (with 3d printing end effectors), rotaries and multi-axis setups,
and output adapters for G-code, Lua, or other machine languages as needed.

A *process plan* references geometry and records the user's and agent's toolpath
and parameter choices. SAAM Studio provides geometry inspection with shared
feature references and inspection of the generated machine program. SAAMpath is our internal toolpath representation.

There are exactly three human approval stages: geometry, locked process plan,
then toolpath. The locked process plan specifies the choices needed to generate
SAAMpath directly. Export from SAAMpath uses an output option declared by the
machine file. There is no separate planning stage after the locked plan. Automated
checks run before the export is sent to the program viewer. That viewer runs
the same export the machine will receive; delivery uses the
approved bytes. There is no additional export approval.

Agents have two task contexts: maker agents use SAAM; development agents build
SAAM and also exercise the maker context when testing. AGENTS.md routes both without requiring
users' agents to load development instructions.

This is a clean restart with selective adoption. A previous component, design
decision, or concept is a candidate only; adoption requires explicit human
approval. Rhino is the selected geometry platform, with 3DM as the native format.
Bounded rhino3dm integration, JSON SAAMpath encoding, and a shared composition/
export/review lifecycle are implemented; general CAD import and mesh slicing
remain open. [DEVELOP.md](DEVELOP.md) owns current implementation details.
No legacy implementation has been adopted. Skills package
their instruction manuals and tools together. Prints bundle the process plan,
SAAMpath and its export, and remain local except for curated examples.

Interoperability and shared pipelines guide component design. Skills should
aspire to work across machines through declared capabilities; exceptions should
be narrow and explicit. See [developer principles](DEVELOP.md#interoperability-and-one-workflow).
