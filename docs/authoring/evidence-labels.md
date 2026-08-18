# Evidence Labels

SAAM separates what has been *observed* from what has been *documented*,
*simulated*, or *proposed*. Every claim about physical machine behavior —
in a manifest, a machine definition, a test fixture, or a doc — carries
one of these labels.

| Label | Meaning |
|---|---|
| **ROBOT-CONFIRMED** | Observed on physical hardware, under the exact machine, tool, material, and configuration recorded alongside the claim. |
| **DOC-CONFIRMED** | Supported by a manufacturer's or controller's own documentation, but not necessarily tested in this project. |
| **EXPERIMENTAL** | Implemented or proposed, not yet proven in production use. This is the default for new operations and machine definitions. |
| **KNOWN FAILURE** | Produced a bad result, a controller fault, an unsafe path, or another confirmed failure. Kept visible, not deleted — a known failure is load-bearing information for the next attempt. |
| **NEEDS RETEST** | Previously observed, but made uncertain by a later hardware, calibration, firmware, or software change. |

## Rules

- **Never upgrade an inference or a preview result to ROBOT-CONFIRMED.**
  A deterministic preview or a passing schema/geometry validation proves
  intent and coordinates — it does not prove physical behavior.
- **Scope every claim exactly.** "ROBOT-CONFIRMED" for one machine, tool,
  material, and configuration does not transfer to a similar one. State
  the scope the observation actually covers.
- **A project-wide success does not promote every component inside it.**
  Closing a milestone or an event does not silently upgrade the evidence
  label of everything built during it — check each component on its own
  evidence.
- **A known failure stays labeled, not hidden.** Removing a known-failure
  record because a project moved on erases exactly the information a
  future contributor needs to avoid repeating it.
- **A software test suite passing is not physical evidence.** Unit,
  schema, and golden-artifact tests validate that generated output is
  internally consistent and reproducible. They cannot validate that a
  specific machine will run it safely.
