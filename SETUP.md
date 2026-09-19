# Checkout setup

For a checkout that has not been used yet, complete setup before either role's
work; the person need not request it separately:

1. Run `node --version`. Node.js 22+ is required. If it is missing or older, do
   not stop and hand the task back: proactively install Node.js 22+ for the
   person's operating system (using their platform's standard installer or
   version manager), confirm `node --version` now reports 22+, then continue
   setup. Missing Node is a prerequisite to resolve in stride, not a setup
   failure to report. Once setup completes, return to and carry out the
   person's original request without waiting to be asked again.
2. Run `npm ci` from the repository root unless `node_modules/` is already
   present, as in a packaged download.
3. Run `npm run setup:check` to verify dependency loading, geometry kernels and
   an unapproved geometry preview served by Studio. This short check needs no Git
   metadata and creates no toolpath or manufacturing approval. Do not run the
   full regression suite as maker onboarding.
4. Apply [Studio agent permissions](studio/README.md#studio-agent-permissions): project trust,
   the shared launcher permission and browser access.

Report a failure as a setup problem and stop there. Setup does not create a
manufacturing approval. Git is needed only to clone; generation requires no
Rhino desktop installation or Compute server. After setup, use the
[Avoid check spirals](BUILDERS.md#avoid-check-spirals) policy for development work.

Manage dependencies through `package.json`, `package-lock.json` and installation
with `npm ci`. Installed source in `node_modules/` stays outside project edits
and Git.

Mesh repair beyond exact cleanup uses an optional native CGAL helper. Build it
with `npm run setup:mesh` and the compiler/dependency paths described in
[native mesh repair](core/geom/native/README.md). The helper has its own license
notice and build manifest. Ordinary valid STL import does not need it.

Reuse completed setup while its relevant dependencies and environment are
unchanged. A new agent or print does not require another setup run.

For development demos and print commands, use [print tools](core/print/USAGE.md)
and the relevant [skill manual](skills/README.md). [Studio](studio/README.md)
owns launch behavior, print directories and client permissions.
