# Checkout setup

For a checkout that has not been used yet, complete setup before either role's
work; the person need not request it separately:

1. Run `node --version`. Node.js 22+ is required. If it is missing or older,
   direct the person to the Node.js 22+ installer for their operating system.
2. Run `npm ci` from the repository root unless `node_modules/` is already
   present, as in a packaged download.
3. Run `npm run setup:check` to verify dependency loading, geometry kernels and
   an unapproved geometry preview served by Studio. This short check needs no Git
   metadata and creates no toolpath or manufacturing approval. Do not run the
   full regression suite as maker onboarding.
4. Apply [Studio agent permissions](studio/README.md#studio-agent-permissions): project trust,
   the shared launcher permission and browser access.

Report a failure as a setup problem and stop there. Setup does not create a
manufacturing approval. Git is needed only to clone; the wedge requires no
Rhino desktop installation or Compute server. After setup, use the
[Avoid check spirals](DEVELOP.md#avoid-check-spirals) policy for development work.

Manage dependencies through `package.json`, `package-lock.json` and installation
with `npm ci`. Installed source in `node_modules/` stays outside project edits
and Git.

Reuse completed setup while its relevant dependencies and environment are
unchanged. A new agent or print does not require another setup run.

For development demos and print commands, use [print tools](core/print/USAGE.md)
and the relevant [skill manual](skills/README.md). [Studio](studio/README.md)
owns launch behavior, print directories and client permissions.
