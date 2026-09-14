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

## Windows checkout ownership

Create the initial checkout from your own PowerShell or Git terminal, outside
an agent sandbox, in a folder your Windows account controls. For example, from
your projects directory:

```powershell
git clone https://github.com/Struder-AI/SAAM.git
cd SAAM
git status
```

Then open that checkout in the agent client and follow the setup steps above.
For an existing checkout, use `git pull` to obtain updates. Git remotes and pulls
do not transfer the originating machine's Windows ownership or access rules.
When copying an existing checkout, avoid preserving another account's ownership
or permissions; check that your account controls the copied `.git` directory.
An agent sandbox can create files under its own Windows account.

If Codex reports `helper_unknown_error: setup refresh had errors` before even
starting a command, inspect its log under `%USERPROFILE%\.codex\.sandbox\`
from your own terminal. An error applying a deny access rule to `.git`, with
`SetNamedSecurityInfoW` error `5` (access denied), indicates a local permissions
problem. Check the affected path's owner with `Get-Acl .git` from the checkout.
This does not call for reinstalling Node or changing the Git remote.

If the directory belongs to a sandbox or other account, have its ownership
restored to your Windows account and grant that account Full Control on the
affected `.git` directory and its contents, using administrator approval when
required. Preserve existing sandbox protections and scope the repair to the
affected checkout. Adding a Git `safe.directory` exception only addresses Git's
ownership check; it does not repair Windows permissions. Verify the repair with
a normal sandboxed command and, if affected, a minimal Node REPL call.

For other setup failures, follow the client's
[Windows sandbox troubleshooting](https://learn.chatgpt.com/docs/windows/windows-sandbox#troubleshooting-and-faq).
