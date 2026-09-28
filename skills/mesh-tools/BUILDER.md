# Mesh tools: development

[The repair entry](../../core/print/repair-stl.mjs) owns orchestration and files;
[the geometry reference](../../core/geom/README.md#explicit-mesh-repair) owns the
cleanup, stitching (1e-9 mm line tolerance), CGAL 6.2.1 local patch repair with
smoothing disabled, and the [memory contract](../../core/geom/README.md#memory-files-and-progress).

`repairSTLFiles(directory, source, options)` takes an STL path or bytes; prefer
paths for large inputs, since reading, hashing and writing stream in chunks.
`repairSTL(source, options)` returns an STL buffer. Both work off the main thread,
cancel with an AbortSignal, and accept `onGeometry(chunk)` for accepted geometry
(`vertices`, `faces`, `firstTriangle`, `completed`, `total`, `percent`), awaited
chunk by chunk and emitted only after validation. The only size check is index
capacity; a mesh larger than memory fails on the allocation, naming stage and size.
