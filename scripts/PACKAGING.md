# Prepared repository downloads

Prepared archives contain editable tracked source, a pinned official Node
distribution with npm and its licenses, and installed dependencies with their
licenses. Build on the target OS and architecture because dependencies include
native packages. The configured targets are Windows, macOS and glibc Linux,
each on x64 and ARM64; a listed target is not evidence that its build passed.
Windows archives use ZIP; macOS/Linux use tar.gz.

The user opens the extracted folder in their agent client and follows
[SETUP.md](../SETUP.md#private-runtime). The archive is a prepared repository,
not a desktop application or hosted service. Source downloads use the same
launcher but obtain Node and dependencies during setup.

## Build an archive

From a clean checkout with Node 22+ and Git available:

```sh
npm run bundle
```

The builder copies tracked files, prepares the matching private runtime and
dependencies, and writes `dist/SAAM-<platform>-<arch>.zip` or `.tar.gz`, plus a
SHA-256 file. The archive records its source commit and runtime in `bundle.json`.
For pre-commit development, stage new source files and use
`npm run bundle -- --development`; the archive name and metadata mark that state.
It copies tracked working files, including staged changes, rather than exporting
an older commit. Untracked files are never silently included.

Git metadata, personal Prints, local extensions, setup caches and credentials
are excluded. The builder refuses tracked private/generated roots. The existing
demo generators are included; generated print bundles are not. Selected shared
examples belong in `examples/prints/` under the current repository convention.

## Verify the affected distribution

```sh
node scripts/test-first-run.mjs --source
node scripts/test-first-run.mjs --archive dist/SAAM-win32-x64.zip
```

Choose the check for what changed: source checks exercise downloading/bootstrap;
archive checks exercise a prepared folder offline. Both extract outside the
checkout into a path containing spaces, block system Node/npm/Git, check setup
reuse, and create and serve unapproved geometry through the real Studio launcher.
They stop only their own test process; Studio's viewer grace period is unchanged.
Reports in `dist/` describe CLI/HTTP evidence, not desktop permission UI or
physical printing. Reuse results until relevant inputs change, following
[change-based selection](../DEVELOP.md#avoid-check-spirals).

The [manual packaging workflow](../.github/workflows/first-run.yml) builds
all six targets when release validation calls for it; local commands above
check the current platform. Enable its source check when bootstrap changes
need that evidence. It uploads archives
and reports to Actions artifacts; it does not publish GitHub Releases. Extract
the Actions artifact ZIP, then the contained SAAM archive. The existing required
PR `test` check and separate stress/document checks remain unchanged. Packaging
does not add a full regression gate or a run on every branch push.
GitHub's manual workflow UI becomes available after the workflow is on main.

Runtime updates require refreshing the official archive names and checksums in
[runtime.tsv](runtime.tsv), then checking the affected targets. Never modify
installed third-party source to make a package work.
