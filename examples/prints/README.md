# Guided tour

Ask your agent to open the SAAM tour. After [setup](../../SETUP.md), the ordinary
Studio launcher opens it directly:

```sh
node studio/server.mjs
```

Choose **Start guided tour**, jump to any example, or explore freely. Nine short
steps introduce geometry, composed settings, layer inspection, playback and machine
view. **Tour** returns to the guide; your place is remembered across launches.

| Example | Explore |
|---|---|
| [Rolling hills](surface-drape/README.md) | Conventional walls and infill with a skin following a bivariate spline roof. |
| [Wavy DENSO](wavy-denso/README.md) | A wavy spline substrate and composed axial/helical cladding with robot/rotary output. |
| [Nudge Cup](nudge-cup/README.md) | Mesh geometry, a spiral wall, a weighted foot and a curved skin in one useful object. |

Geometry, settings and toolpaths are packaged with the repository. No first-use
slicing or demo extraction command is needed. Studio copies each example when
opened to ignored `Prints/tour/`, adding a suffix when a folder already exists.
**Open print** reopens these saved copies. **Start fresh** makes another set as
you visit the examples, preserving earlier work.

**Use this example** starts normal review of your copy. You can also ask your
agent to edit it directly; changed files invalidate its packaged preview. Review
the resulting geometry, settings and toolpath before printing. Tour examples have
no inherited approvals or personal machine calibration. The
[maker guide](../../MAKERS.md) owns those reviews.

## Maintaining the examples

Recipes are editable source. To regenerate a set in a new local directory:

```sh
node examples/prints/create.mjs all Prints/tour-refresh --generate
node examples/prints/package.mjs all Prints/tour-refresh
```

The optional arguments are the example ID (or all) and output directory. Preparation
is maintainer work, performed when the example recipes or display contracts change.
Review the regenerated examples in Studio before publishing them.

Each tracked `prepared/` directory contains an ordinary unapproved bundle, a
state snapshot, a compressed display cache and a hash manifest. The cache uses the
shared source interpreter, material renderer and machine viewer; it supplies no
manufacturing approvals or deliverable output. Exact source bytes are preserved
across checkouts by `.gitattributes`. Studio verifies the local bundle against
the packaged manifest before using a snapshot; edits use the live lifecycle.
The cache version belongs to [preview-cache.mjs](../../studio/preview-cache.mjs).
When its schema, move storage or material display changes, bump the cache/tour
versions and regenerate all three packages together.
