//! Python sidecar: JSON-RPC 2.0 over stdin/stdout, one message per line.
//! The engine writes only protocol lines on stdout; its logs (stderr) are
//! forwarded to our log and kept for error messages.
//!
//! Where the engine comes from, in order:
//! 1. `SCORE_STUDIO_ENGINE=/path/to/binary`;
//! 2. development builds: `uv run python -m score_engine` in `engine/`
//!    (source edits apply on the next start), else `binaries/engine-<triple>`;
//! 3. bundled app: `engine` next to the executable (Tauri `externalBin`).
//!
//! Requests are serialised: one in flight at a time. The process starts on
//! the first request (or on `warm_up`) and is restarted if it has died.

use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

const STDERR_TAIL: usize = 20;

#[derive(Debug, Clone, PartialEq)]
pub struct Launcher {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub cwd: Option<PathBuf>,
}

impl Launcher {
    fn binary(program: PathBuf) -> Self {
        Self { program, args: Vec::new(), cwd: None }
    }

    /// Find the engine for this build (see the module documentation).
    pub fn locate() -> Option<Self> {
        if let Some(p) = std::env::var_os("SCORE_STUDIO_ENGINE").map(PathBuf::from) {
            return Some(Self::binary(p));
        }
        if cfg!(debug_assertions) {
            let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
            let project = manifest.join("../../engine");
            if project.join("pyproject.toml").is_file() && which("uv").is_some() {
                return Some(Self {
                    program: "uv".into(),
                    args: ["run", "--quiet", "python", "-m", "score_engine"].map(String::from).to_vec(),
                    cwd: Some(project),
                });
            }
            let built = manifest.join("binaries").join(format!("engine-{}", env!("TARGET_TRIPLE")));
            if built.is_file() {
                return Some(Self::binary(built));
            }
        }
        let dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
        ["engine".to_string(), format!("engine-{}", env!("TARGET_TRIPLE"))]
            .into_iter()
            .map(|name| dir.join(name))
            .find(|p| p.is_file())
            .map(Self::binary)
    }
}

fn which(program: &str) -> Option<PathBuf> {
    std::env::var_os("PATH")
        .map(|paths| std::env::split_paths(&paths).map(|d| d.join(program)).collect::<Vec<_>>())
        .unwrap_or_default()
        .into_iter()
        .find(|p| p.is_file())
}

struct Process {
    child: Child,
    stdin: ChildStdin,
    lines: Receiver<String>,
}

impl Drop for Process {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

pub struct EngineClient {
    launcher: Option<Launcher>,
    process: Mutex<Option<Process>>,
    next_id: Mutex<u64>,
    stderr: Arc<Mutex<VecDeque<String>>>,
}

impl EngineClient {
    pub fn new(launcher: Option<Launcher>) -> Self {
        Self {
            launcher,
            process: Mutex::new(None),
            next_id: Mutex::new(1),
            stderr: Arc::new(Mutex::new(VecDeque::new())),
        }
    }

    fn spawn(&self) -> Result<Process, String> {
        let launcher = self.launcher.as_ref().ok_or(
            "motore di analisi non trovato: in sviluppo serve uv (https://docs.astral.sh/uv/), \
             oppure SCORE_STUDIO_ENGINE",
        )?;
        let mut cmd = Command::new(&launcher.program);
        cmd.args(&launcher.args).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        if let Some(cwd) = &launcher.cwd {
            cmd.current_dir(cwd);
        }
        let mut child =
            cmd.spawn().map_err(|e| format!("impossibile avviare il motore ({}): {e}", launcher.program.display()))?;
        let stdin = child.stdin.take().ok_or("engine stdin")?;
        let stdout = child.stdout.take().ok_or("engine stdout")?;
        let stderr = child.stderr.take().ok_or("engine stderr")?;

        let (tx, rx) = mpsc::channel();
        thread::Builder::new()
            .name("engine-stdout".into())
            .spawn(move || {
                for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                    if tx.send(line).is_err() {
                        break;
                    }
                }
            })
            .map_err(|e| e.to_string())?;
        let tail = self.stderr.clone();
        thread::Builder::new()
            .name("engine-stderr".into())
            .spawn(move || {
                for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                    log::info!("{line}");
                    if let Ok(mut t) = tail.lock() {
                        if t.len() == STDERR_TAIL {
                            t.pop_front();
                        }
                        t.push_back(line);
                    }
                }
            })
            .map_err(|e| e.to_string())?;
        Ok(Process { child, stdin, lines: rx })
    }

    fn stderr_tail(&self) -> String {
        self.stderr.lock().map(|t| t.iter().cloned().collect::<Vec<_>>().join("\n")).unwrap_or_default()
    }

    /// Call `method` and wait at most `timeout` for its result.
    pub fn request(&self, method: &str, params: Value, timeout: Duration) -> Result<Value, String> {
        let mut guard = self.process.lock().map_err(|_| "engine state poisoned")?;
        let alive = match guard.as_mut() {
            Some(p) => matches!(p.child.try_wait(), Ok(None)),
            None => false,
        };
        if !alive {
            *guard = Some(self.spawn()?);
        }
        let process = guard.as_mut().expect("engine process");

        let id = {
            let mut next = self.next_id.lock().map_err(|_| "engine state poisoned")?;
            *next += 1;
            *next
        };
        let line = json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}).to_string();
        if let Err(e) = writeln!(process.stdin, "{line}").and_then(|_| process.stdin.flush()) {
            *guard = None;
            return Err(format!("il motore di analisi non risponde: {e}\n{}", self.stderr_tail()));
        }

        let deadline = Instant::now() + timeout;
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            match process.lines.recv_timeout(left) {
                Ok(line) => {
                    let Ok(msg) = serde_json::from_str::<Value>(&line) else {
                        log::warn!("engine: ignoring a non-JSON line on stdout: {line}");
                        continue;
                    };
                    if msg.get("id").and_then(Value::as_u64) != Some(id) {
                        continue; // notification (e.g. omr.progress) or a stale reply
                    }
                    if let Some(err) = msg.get("error") {
                        let text = err.get("message").and_then(Value::as_str).unwrap_or("errore sconosciuto");
                        return Err(text.to_string());
                    }
                    return Ok(msg.get("result").cloned().unwrap_or(Value::Null));
                }
                Err(RecvTimeoutError::Timeout) => {
                    *guard = None; // kill it: a late reply would be mistaken for the next one
                    return Err(format!("il motore di analisi non ha risposto entro {} s", timeout.as_secs()));
                }
                Err(RecvTimeoutError::Disconnected) => {
                    *guard = None;
                    return Err(format!("il motore di analisi si è chiuso.\n{}", self.stderr_tail()));
                }
            }
        }
    }

    /// Start the engine in the background so the first analysis does not pay
    /// for Python and music21 start-up.
    pub fn warm_up(self: &Arc<Self>) {
        let client = self.clone();
        thread::spawn(move || match client.request("ping", json!({}), Duration::from_secs(60)) {
            Ok(v) => log::info!("analysis engine ready: {v}"),
            Err(e) => log::warn!("analysis engine not available: {e}"),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A stand-in engine: echoes the method, sends a notification first, logs on stderr,
    /// exits on "quit", sleeps on "slow", answers errors on "fail".
    const FAKE: &str = r#"
import json, sys, time
print("fake engine ready", file=sys.stderr, flush=True)
for line in sys.stdin:
    req = json.loads(line)
    m = req["method"]
    if m == "quit": sys.exit(3)
    if m == "slow": time.sleep(5)
    print(json.dumps({"jsonrpc": "2.0", "method": "progress", "params": {}}), flush=True)
    if m == "fail":
        out = {"jsonrpc": "2.0", "id": req["id"], "error": {"code": -1, "message": "boom"}}
    else:
        out = {"jsonrpc": "2.0", "id": req["id"], "result": {"echo": m, "params": req.get("params")}}
    print(json.dumps(out), flush=True)
"#;

    fn fake() -> EngineClient {
        EngineClient::new(Some(Launcher { program: "python3".into(), args: vec!["-c".into(), FAKE.into()], cwd: None }))
    }

    const T: Duration = Duration::from_secs(10);

    #[test]
    fn round_trip_skips_notifications() {
        let c = fake();
        let v = c.request("analyze", json!({"musicxml": "x"}), T).unwrap();
        assert_eq!(v, json!({"echo": "analyze", "params": {"musicxml": "x"}}));
        let v = c.request("ping", json!({}), T).unwrap();
        assert_eq!(v["echo"], "ping");
    }

    #[test]
    fn rpc_errors_become_messages() {
        assert_eq!(fake().request("fail", json!({}), T), Err("boom".into()));
    }

    #[test]
    fn restarts_after_the_engine_dies() {
        let c = fake();
        let err = c.request("quit", json!({}), T).unwrap_err();
        assert!(err.contains("si è chiuso"), "{err}");
        assert!(err.contains("fake engine ready"), "stderr tail included: {err}");
        assert_eq!(c.request("ping", json!({}), T).unwrap()["echo"], "ping");
    }

    #[test]
    fn times_out_and_recovers() {
        let c = fake();
        let err = c.request("slow", json!({}), Duration::from_millis(300)).unwrap_err();
        assert!(err.contains("non ha risposto"), "{err}");
        assert_eq!(c.request("ping", json!({}), T).unwrap()["echo"], "ping");
    }

    #[test]
    fn missing_engine_is_reported() {
        let err = EngineClient::new(None).request("ping", json!({}), T).unwrap_err();
        assert!(err.contains("motore di analisi non trovato"));
    }

    /// The real engine through uv: `cargo test -- --ignored`.
    #[test]
    #[ignore = "needs uv and the engine's dependencies"]
    fn real_engine_analyzes_the_minuet() {
        let c = EngineClient::new(Launcher::locate());
        let xml = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../engine/tests/fixtures/minuet-in-g.musicxml"
        ))
        .unwrap();
        let v = c.request("analyze", json!({ "musicxml": xml }), Duration::from_secs(120)).unwrap();
        assert_eq!(v["key"][0]["tonic"], "G");
        assert!(v["chords"].as_array().unwrap().len() > 30);
    }
}
