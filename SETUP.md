# Checkout setup

For a checkout that has not been used yet, complete setup before either role's
work; the person need not request it separately. With a prepared download or no
system Node, use [the private runtime](#private-runtime) instead of steps 1–3.

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

## Private runtime

From the extracted SAAM folder, run `.\saam.ps1 setup` in Windows PowerShell
or `sh saam.sh setup` on macOS/Linux. This prepares a project-local Node/npm,
installs the locked dependencies and runs the same lightweight setup check.
It changes no system installation or persistent PATH. Ordinary source downloads
need HTTPS access to nodejs.org and the npm registry. Matching prepared archives
already contain the runtime and dependencies and need no installation downloads.
The pinned runtime versions and checksums are in [runtime.tsv](scripts/runtime.tsv).

Successful setup is reused while the package/lockfile, runtime, platform and
setup-check source are unchanged and required dependency folders remain present.
A new task or print needs no repeat setup. Use `setup --force` only to repair a
damaged installation; it reinstalls dependencies and reruns the check without
touching saved prints. A failed check is not cached as success. If setup reports
`.saam/setup.lock`, wait for its owner; remove only that directory after confirming
the owning setup stopped. Runtime downloads use `runtime/.download.lock` in the
same way; a second invocation reports the active owner instead of replacing it.

With this runtime, translate manuals' leading `node` or `npm` to
`.\saam.ps1 node` / `.\saam.ps1 npm` on Windows, or `sh saam.sh node` /
`sh saam.sh npm` on macOS/Linux. Use `.\saam.ps1 studio Prints/my-part` or
`sh saam.sh studio Prints/my-part` for Studio. These use the existing server,
print lifecycle and [client permissions](studio/README.md#studio-agent-permissions).
For a trusted downloaded script blocked by Windows execution policy, the
process-scoped form is
`powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\saam.ps1 setup`;
the same form accepts `studio` and a print directory. Administrator-enforced
policy and client permissions still apply.

This setup supplies runtime dependencies; it creates no tour, demo collection,
human approval or machine action. Maintainers build prepared downloads using
[the packaging procedure](scripts/PACKAGING.md).
