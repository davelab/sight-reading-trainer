//! Python sidecar (milestone M3): spawn `binaries/engine-<target-triple>` and talk
//! JSON-RPC 2.0 over stdin/stdout, one message per line; the engine logs on stderr.
//!
//! The protocol is already implemented and tested on the Python side
//! (engine/score_engine); `ping` and `score.normalize` work today:
//!
//! ```text
//! echo '{"jsonrpc":"2.0","id":1,"method":"ping"}' | uv run python -m score_engine
//! ```
//!
//! To bundle it, build the binary with scripts/build-engine.sh, add
//! `"externalBin": ["binaries/engine"]` to tauri.conf.json and the shell plugin's
//! sidecar permission to capabilities/default.json.
