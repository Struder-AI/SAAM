# Repository downloads and first use

The supported entry point is an extracted SAAM folder opened in Claude Code
Desktop or Codex Desktop. The agent follows AGENTS.md, runs setup once, creates
an unapproved part and opens Studio. The maker supplies the prompt and reviews
the part. No MCP registration, hosted relay, system Node installer or full
regression run is part of that first-use flow.

## Download choices

Prepared archives contain tracked source, manuals, a pinned official Node
distribution including its licenses/npm, and matching installed dependencies
with their license files. Windows uses ZIP; macOS and Linux use tar.gz. Extract
the outer GitHub Actions artifact ZIP and then the contained SAAM archive.
Choose Windows x64/ARM64, macOS Intel/Apple Silicon, or Linux x64/ARM64; Linux
targets the official glibc runtime, not Alpine/musl. The matrix uses native
platform runners because the dependency tree includes native optional packages.

GitHub's ordinary source ZIP contains neither runtime nor dependencies. The
same setup launcher downloads and verifies Node, extracts it locally and installs
the lockfile in one operation. This needs HTTPS access to nodejs.org and the npm
registry. Prepared archives need no installation downloads on their matching
platform. Neither distribution includes Git metadata, personal Prints, local
extensions, credentials, npm caches or a preapproved part.

## Agent commands

From the extracted root, use `.\saam.ps1 setup` in Windows PowerShell or
`sh saam.sh setup` on macOS/Linux. The Node pin and per-platform SHA-256 values
live in [runtime.tsv](runtime.tsv), sourced from the official
[Node checksums](https://nodejs.org/dist/v22.23.2/SHASUMS256.txt).
The launcher never changes the system PATH or installs global software.

Translate the manuals' leading `node` to `.\saam.ps1 node` or `sh saam.sh node`;
translate `npm` to the same launcher's `npm` subcommand. For Studio, use
`.\saam.ps1 studio Prints/my-part` or `sh saam.sh studio Prints/my-part`.
The launcher's studio mode delegates to the same server and creates no new
approval route. [Client permissions](../studio/README.md#studio-agent-permissions)
still require workspace trust and any browser/site access requested by the client.
If Windows blocks the downloaded PowerShell script, invoke this trusted script
with `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\saam.ps1 setup`.
Use the same prefix with `studio` or `node` as needed. The execution-policy
override applies only to that process; it does not change global policy or
override administrator-enforced policy. The explicit Studio form has a scoped
client rule, and setup retains the client's normal command approval behavior.

## Setup reuse and repair

[setup.mjs](setup.mjs) binds installation to package.json, package-lock.json,
the running Node version, OS and architecture. A separate local successful-check
record also includes the smoke-check source hash. It checks required package
folders before returning a cached result. Presence of node_modules alone is
insufficient. Lockfile/runtime changes reinstall; a changed smoke check reruns
the check. The cache is setup evidence, not a manufacturing approval or a
substitute for per-print geometry and exported-program validation.

`setup --force` reinstalls dependencies and reruns the smoke check when an install
is damaged. No successful check is retained after a failed recheck. It preserves
Prints. Interrupted setup can leave `.saam/setup.lock`; after confirming that no
setup is running, remove only that lock directory and retry. Node downloads use
temporary directories and checksum verification before publishing the runtime.
The OS launchers report unsupported architectures and never silently use a
runtime for the wrong platform. Concurrent first-time Node downloads into the
same folder should be avoided; dependency setup has its own exclusive lock.

The smoke check resolves direct dependency entry points, exercises geometry kernels and
serves a temporary unapproved geometry through Studio. It does not generate a
toolpath, approve a print, contact a machine or invoke Git. Source installation
and extraction report their own progress; no estimated percentage is invented.

## Build and verify downloads

Run the full regression suite locally before committing, according to the
[check policy](../CONTRIBUTING.md#checks). It is not repeated automatically by
GitHub. The manual [repository check](../.github/workflows/test.yml) remains
available when a remote full run is explicitly wanted.

`npm run bundle` packages tracked working files from a clean checkout on the
target platform. For local verification before committing, stage new files and
use `npm run bundle -- --development`; its filename and bundle.json identify it
as a development archive. Each archive includes its source commit and runtime
identity and has an adjacent SHA-256 file. Source bytes stay editable; this is
a prepared repository, not a compiled desktop app. Runtime updates require
refreshing all checksum rows from the official Node release and rechecking the
platform matrix. Installed third-party source is never edited or tracked.

The [packaging workflow](../.github/workflows/first-run.yml) runs on the packaging
branch, release tags and explicit dispatch. It builds and uploads archives only
after the platform's first-run checks pass; it does not publish GitHub Releases
or repeat the manufacturing suite. Download artifacts from that workflow's
successful run. There is no implicit promise that every matrix platform has
passed until its actual result is recorded.

```sh
node scripts/test-first-run.mjs --source
node scripts/package-bundle.mjs
node scripts/test-first-run.mjs --archive dist/SAAM-darwin-arm64.tar.gz
```

The test extracts outside the repository into a path containing spaces, without
Git metadata or access to parent node_modules. It blocks system node/npm/git,
starts with empty setup caches, checks cached reuse, creates a geometry-only
part through the public CLI and opens it through the real Studio launcher.
Prepared-archive runs disable npm network installation and use failing outbound
proxies. Source runs exercise the actual runtime and dependency downloads.
Reports under dist record extraction, setup, cached setup and geometry-preview
timings. These establish OS/CLI/HTTP behavior, not desktop permission UI,
browser rendering, quarantine prompts or physical printing. Record those live
client observations separately; do not claim they are covered by the matrix.
