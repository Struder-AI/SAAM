# Third-Party Notices

SAAM does not redistribute third-party source code, vendor documentation,
datasets, firmware, or media as of this revision.

Every package added to this repository goes through a provenance check
before inclusion: confirmed redistribution rights, correct attribution, and
a license compatible with Apache License 2.0 for original SAAM content.
Runtime dependencies declared in a package's manifest (for example, an
adapter's `package.json`) carry their own upstream licenses, which are not
duplicated here; consult each dependency's published license directly.

When a future contribution imports third-party material under its own
license — vendored source, copied text, embedded media — it is recorded
here with:

- the component name and version,
- its license,
- the exact scope of what was imported, and
- a link to its source.

No such entries exist yet.

## npm dependencies in use

`adapters/mcp/` and `interfaces/reference-workbench/` declare direct npm
dependencies in their own `package.json` files in the normal way —
`@modelcontextprotocol/sdk` and `zod` for the adapter, `react` and a
Vite-based toolchain for the workbench. These are used as published,
unmodified, over their own public registry channel; nothing from any of
them is copied into this repository's own source. Their full transitive
dependency trees are recorded in the root `package-lock.json`, not
duplicated here — consult each package's own license on npm for its
terms.
