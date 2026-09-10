# Source and Geometry Evidence

## Source priority

1. Operator-supplied physical measurements and files
2. Manufacturer or standards-body drawings/specifications
3. Original designer CAD with a usable license and documented units/revision
4. Patents, manuals, catalogs, and technical listings
5. Multiple independent photographs with scale
6. Community CAD, marketplace listings, and uncited descriptions

Prefer agreement between independent evidence types. Record disagreements
instead of averaging them silently.

## Reference intake

For files, preserve the original and inspect a working copy. Record filename,
source, version, units, coordinate orientation, and declared license.

For photographs, seek orthogonal views, minimal perspective distortion, a known
scale in the same plane, and close views of interfaces. Treat dimensions hidden
by perspective or occlusion as inferred.

For web sources, cite the exact page or downloadable artifact supporting each
important dimension. A search snippet is not a source.

## Mesh and CAD checks

- Establish units from metadata, documentation, or known features.
- Report axis-aligned bounds and component count.
- Check watertightness, non-manifold edges, inverted faces, self-intersections,
  degenerate triangles, and disconnected shells when tooling permits.
- Identify minimum wall/feature dimensions and ambiguous internal geometry.
- Compare file dimensions against authoritative specifications.
- Do not equate a valid mesh with a manufacturable StruderBot path.

## Reconstruction rules

Build a parametric feature model before toolpaths. Preserve the referenced
interfaces first; cosmetic details may be simplified only after disclosure and
approval. Keep sourced, operator-selected, and inferred dimensions separately
traceable.

If available evidence is insufficient for a functional fit, stop and request a
measurement or explicit design choice. If the object is decorative and scale is
arbitrary, propose a size that fits the proven work envelope and label it as a
choice.

## Licensing and attribution

Record the model/drawing license and required attribution. Do not claim rights
that were not granted. Linking to a public model does not imply permission to
redistribute its geometry. Prefer reconstructing uncopyrightable functional
dimensions from legitimate technical evidence over copying an unavailable or
restricted mesh.
