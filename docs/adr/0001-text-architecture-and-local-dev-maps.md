# Shared text architecture and separate local development maps

Accepted by the owner, 2026-10-18:

> We need to move the dev maps system out of saam itself, our local preferences will still reference it and our local developer agents will still be able to use it, but it will be in a different root folder, and in the package that ships to remote, we will replace with a more standard text-based architecture spec version thing.

[ARCHITECTURE.md](../../ARCHITECTURE.md) is the shared structural specification,
organized with arc42 and versioned with the source. Component manuals retain their
detailed contracts; versioned intent retains its existing authority. Dev maps,
their analysis/view state and map-specific guidance live in a separate local root.
Local preferences tell developer agents how to use that tool; SAAM onboarding,
guidance and packaging work without it. This preserves local analysis and authored
layouts while removing a tool-specific lifecycle and generated-state prerequisite
from shared development context. Earlier map-specific instructions in historical
plans and decisions describe the former arrangement.
