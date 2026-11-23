Sidecar binaries built by `scripts/build-engine.sh`, named with the target
triple (e.g. `engine-aarch64-apple-darwin`). Git-ignored.

They are bundled only by `pnpm bundle` (which merges `tauri.bundle.conf.json`
and its `externalBin`), so `cargo test` and `pnpm tauri dev` work without them:
in development the engine runs from source through `uv`.
