# Packaging SAAM

[INSTALL.md](INSTALL.md), published at the stable [latest-release URL](https://github.com/Struder-AI/SAAM/releases/latest/download/INSTALL.md), owns installation, migration and client setup. [Application](../core/application/README.md) owns commands, chat attachment and the SAAM home; `app/` is replaceable while prints, extensions and `state/` persist. An invite is optional for local making.

Ship all three platforms: `win-x64`, `darwin-arm64` and `darwin-x64`; omit one only by owner decision. Build from one clean committed snapshot:
`node packaging/build.mjs --platform PLATFORM --version VERSION --relay-url https://saam-relay.remettub.workers.dev --update-host https://github.com/Struder-AI/SAAM/releases/download --out dist/PLATFORM`.
The builder verifies official Node or platform-checked `--node PATH` plus LICENSE, then setup-checks the built package (on its own Node when the host can run it), stopping on failure. `--mesh-repair DIR` supplies the verified Windows helper; Mac availability is separate. Record SHA, platform, ZIP size/hash and runtime provenance. Review candidates use `--review` and explicit `--review-file`; publication requires clean tracked source. Installation preserves a recoverable app while replacing it and leaves user data intact. Unsigned alpha archive checks do not establish native execution.

## Publishing

1. Fetch/integrate history and push release work explicitly to `origin/codex/remettub-dev-branch`, preserving existing commits.
2. Verify three ZIPs/sidecars, embedded manifests and runtime architectures, installer permissions and archived bytes. Run isolated Windows install, generation, Studio/Wing and repair checks; record Mac acceptance limits. Never replace a user's installation as a test.
3. With release authorization create `vVERSION` at the exact source SHA in [SAAM Releases](https://github.com/Struder-AI/SAAM/releases); upload three ZIPs, three checksums and `INSTALL.md`. Guide-only corrections need not rebuild unchanged archives.
4. Verify public hashes, assets, tag and stable guide before updating all three relay `LATEST_RELEASE` entries and deploying the existing service.
5. Verify authenticated `/device/release` offers without exposing credentials and the isolated Update/restart path with data preserved. Commit/push corrections to the same release branch and state native verification limits. A local ZIP or draft is not a published update.
