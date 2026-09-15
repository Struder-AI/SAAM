---
name: saam
description: Create and adjust 3D printing parts with the connected SAAM tools, open local Studio for review, and generate and deliver approved machine files. Use when the person asks to make or revise a part with SAAM.
---

# Make a part with SAAM

Use the SAAM connector's tools. First call `read_guidance` with
`guidanceId: "makers"` and follow that current manual. Use `list_skills` and
`read_skill` to load the relevant supported process manual; the plugin does not
contain a separate geometry generator or a copy of those manuals.

When the request supports an initial shape, create an unapproved print and call
`request_review`. Explain proposed dimensions and setup in ordinary language.
The person reviews in SAAM Studio on the computer running SAAM. Follow-up changes
use the existing print and its current revision, rather than creating duplicates.

The person gives two confirmations in Studio: geometry, then settings and the
generated toolpath together. Chat agreement is not a Studio approval. Establish
printer/material choices before toolpath view. Read approval status, generate
from the confirmed geometry and complete settings, and deliver the reviewed bytes using
the connector. Do not invent approval records or run a machine. Describe
software checks separately from physical print validation.

If tools are unavailable, ask the person to connect the SAAM connector bundled
with this plugin and keep their local SAAM connection running. They enter the
pairing code on the SAAM authorization page, never in chat. The plugin itself
does not start SAAM on their computer. If the temporary relay address changed,
they need the newly generated plugin from that SAAM session.

After a timeout, read the print's current state before retrying a change; the
local operation may have continued. Studio links and delivered files are local
to the SAAM computer, so cloud tools cannot fetch them through this connector.
