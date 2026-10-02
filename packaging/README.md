# Packaging SAAM

[INSTALL.md](INSTALL.md) is the agent-facing guide published at the stable [latest-release URL](https://github.com/Struder-AI/SAAM/releases/latest/download/INSTALL.md). It owns installation paths and desktop-agent setup. Prints and service credentials stay outside the replaceable application; an invite is optional for local making.

Ship **all three platforms**: `win-x64`, `darwin-arm64` (Apple Silicon), and `darwin-x64` (Intel Mac). A previous release or handoff may be incomplete; compare the builder platform list and release assets. Omit a platform only on the owner's explicit decision.

Build each from one clean committed snapshot: `node packaging/build.mjs --platform PLATFORM --version VERSION --relay-url https://saam-relay.remettub.workers.dev --update-host https://github.com/Struder-AI/SAAM/releases/download --out dist/PLATFORM`. The builder downloads and verifies official Node, or takes a platform-checked `--node PATH` with adjacent LICENSE. Supply the verified Windows repair helper through `--mesh-repair DIR`; Mac helper availability is separate. Record source SHA, platform, ZIP size/hash and runtime provenance.

Local candidates may use `--review` with explicit `--review-file` entries; their manifest is marked `reviewBuild:true`. Published builds require a clean tracked snapshot. Each ZIP contains `app.tar`, installer and update scripts; installation replaces only the app, creates its icon and refuses to replace a running instance. Alpha packages are unsigned; archive checks do not establish native Mac execution.

## Publishing

1. Fetch and integrate the intended remote history. Push release work to **`origin/codex/remettub-dev-branch`**, even when the current task uses another worktree branch; use an explicit destination and preserve existing commits. Do not substitute the task branch or `main`.
2. Verify all three ZIPs, sidecars, embedded manifests/runtime architectures, installer permissions and archived source bytes. Run isolated Windows installation, checked generation, Studio/Wing and native-repair checks. Keep the owner's agreed Mac acceptance timing explicit; never replace the user's installation as a packaging test.
3. With the owner's release authorization, create `vVERSION` at the exact application source SHA in [SAAM Releases](https://github.com/Struder-AI/SAAM/releases). Upload three ZIPs, their three `.zip.sha256` files, and `INSTALL.md` naming all three platforms. A separately corrected installation guide need not rebuild unchanged application archives; record that distinction.
4. Verify uploaded sizes/hashes, publish as latest, then verify all public download URLs, checksum sidecars, tag SHA and the stable installation-guide URL. Only after these succeed, set **all three** entries in `relay/wrangler.jsonc`'s `LATEST_RELEASE` and deploy the existing service.
5. Verify an authenticated `/device/release` response matches the published version, URLs and hashes without printing credentials. Check the Update/restart path in an isolated installation, or the user's installation when authorized, preserving its data folder. Commit and push offer/configuration and guide corrections to the same intended branch. Report native-platform validation limits; a local ZIP or draft is not a published update.
