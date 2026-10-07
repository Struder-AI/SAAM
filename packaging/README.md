# Packaging SAAM

[INSTALL.md](INSTALL.md), published at the stable [latest-release URL](https://github.com/Struder-AI/SAAM/releases/latest/download/INSTALL.md), owns installation, migration and client setup. [Application](../core/application/README.md) owns commands, chat attachment and the SAAM home; `app/` is replaceable while prints, extensions and `state/` persist. An invite is optional for local making.

Ship all three platforms: `win-x64`, `darwin-arm64` and `darwin-x64`; omit one only by owner decision. Build from one clean committed snapshot:
`node packaging/build.mjs --version VERSION --relay-url https://saam-relay.remettub.workers.dev --update-host https://github.com/Struder-AI/SAAM/releases/download --mesh-repair DIR` (all three into `dist/PLATFORM/`; `--platform` picks some).
Nothing is installed from the network: dependencies come from the checkout's installed `node_modules` (`--modules DIR`), checked against `package-lock.json`, with manifold-3d reduced to the files SAAM loads; official Node comes from `build/node-runtime/VERSION/`, checked against nodejs.org's SHASUMS256, fetching an archive only when the cache lacks it (or platform-checked `--node PATH` plus LICENSE). Each package is setup-checked (on its own Node when the host can run it). `--mesh-repair DIR` supplies the verified Windows helper; Mac availability is separate. Record SHA, platform, ZIP size/hash and runtime provenance. Review candidates use `--review` and explicit `--review-file`; publication requires clean tracked source. Installation preserves a recoverable app while replacing it and leaves user data intact. Unsigned alpha archive checks do not establish native execution.

## Publishing

1. Fetch/integrate history and push release work explicitly to `origin/codex/remettub-dev-branch`, preserving existing commits.
2. The builder's own checks are the package verification. Ask the owner each release whether to run any trial beyond them (isolated install, generation, Studio/Wing, repair, isolated Update) and record the answer (owner, 2026-10-06: "ask me about them next time"); no such trial has yet found a defect. Never replace a user's installation as a test.
3. With release authorization create `vVERSION` at the exact source SHA in [SAAM Releases](https://github.com/Struder-AI/SAAM/releases); upload three ZIPs, three checksums and `INSTALL.md`; the notes' first line tells agents to follow that release's `INSTALL.md` for exactly that version. Guide-only corrections need not rebuild unchanged archives.
4. Compare the published assets' hashes with the build's, then update all three relay `LATEST_RELEASE` entries and deploy the existing service.
5. Confirm the relay offers the new version (authenticated `/device/release`, credentials not printed). Commit/push corrections to the same release branch. A local ZIP or draft is not a published update.
