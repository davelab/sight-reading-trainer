//! Python sidecars: JSON-RPC 2.0 over stdin/stdout, one message per line.
//! A sidecar writes only protocol lines on stdout; its logs (stderr) are
//! forwarded to our log and kept for error messages.
//!
//! Two sidecars are built from the same package (docs/SPEC.md, risks):
//! `engine` (harmonic analysis, light) and `omr` (PDF import with homr).
//! Where each comes from, in order:
//! 1. `SCORE_STUDIO_ENGINE` / `SCORE_STUDIO_OMR` = path to a binary;
//! 2. development builds: `uv run python -m score_engine` in `engine/`
//!    (source edits apply on the next start), else `binaries/<name>-<triple>`;
//! 3. bundled app: `<name>` next to the executable (Tauri `externalBin`).
//!
//! A reader thread routes replies to the request waiting for them (by id) and
//! notifications (no id, e.g. `omr.progress`) to a handler, so several
//! requests can be in flight. The process starts on the first request and is
//! restarted if it has died.

use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde_json::{json, Value};

const STDERR_TAIL: usize = 20;

/// Receives every notification: method and params.
pub type NotificationHandler = Arc<dyn Fn(&str, Value) + Send + Sync>;

#[derive(Debug, Clone, PartialEq)]
pub struct Launcher {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub cwd: Option<PathBuf>,
    pub env: Vec<(String, String)>,
}

impl Launcher {
    fn binary(program: PathBuf) -> Self {
        Self { program, args: Vec::new(), cwd: None, env: Vec::new() }
    }

    pub fn with_env(mut self, key: &str, value: impl Into<String>) -> Self {
        self.env.push((key.to_string(), value.into()));
        self
    }

    /// Find the sidecar `name` ("engine" or "omr") for this build.
    pub fn locate(name: &str) -> Option<Self> {
        let override_var = format!("SCORE_STUDIO_{}", name.to_uppercase());
        if let Some(p) = std::env::var_os(&override_var).map(PathBuf::from) {
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
                    env: Vec::new(),
                });
            }
            let built = manifest.join("binaries").join(format!("{name}-{}", env!("TARGET_TRIPLE")));
            if built.is_file() {
                return Some(Self::binary(built));
            }
        }
        let dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
        [name.to_string(), format!("{name}-{}", env!("TARGET_TRIPLE"))]
            .into_iter()
            .map(|n| dir.join(n))
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

type Pending = Arc<Mutex<HashMap<u64, Sender<Result<Value, String>>>>>;

struct Process {
    child: Child,
    stdin: ChildStdin,
    alive: Arc<AtomicBool>,
}

impl Drop for Process {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

pub struct EngineClient {
    name: String,
    launcher: Option<Launcher>,
    process: Mutex<Option<Process>>,
    pending: Pending,
    next_id: AtomicU64,
    stderr: Arc<Mutex<VecDeque<String>>>,
    on_notification: Mutex<Option<NotificationHandler>>,
}

fn tail_text(tail: &Mutex<VecDeque<String>>) -> String {
    tail.lock().map(|t| t.iter().cloned().collect::<Vec<_>>().join("\n")).unwrap_or_default()
}

impl EngineClient {
    pub fn new(name: &str, launcher: Option<Launcher>) -> Self {
        Self {
            name: name.to_string(),
            launcher,
            process: Mutex::new(None),
            pending: Arc::new(Mutex::new(HashMap::new())),
            next_id: AtomicU64::new(1),
            stderr: Arc::new(Mutex::new(VecDeque::new())),
            on_notification: Mutex::new(None),
        }
    }

    pub fn set_notification_handler(&self, handler: NotificationHandler) {
        if let Ok(mut h) = self.on_notification.lock() {
            *h = Some(handler);
        }
    }

    fn spawn(&self) -> Result<Process, String> {
        let launcher = self.launcher.as_ref().ok_or_else(|| {
            format!(
                "motore «{}» non trovato: in sviluppo serve uv (https://docs.astral.sh/uv/), \
                 oppure SCORE_STUDIO_{}",
                self.name,
                self.name.to_uppercase()
            )
        })?;
        let mut cmd = Command::new(&launcher.program);
        cmd.args(&launcher.args).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        if let Some(cwd) = &launcher.cwd {
            cmd.current_dir(cwd);
        }
        for (k, v) in &launcher.env {
            cmd.env(k, v);
        }
        let mut child =
            cmd.spawn().map_err(|e| format!("impossibile avviare il motore ({}): {e}", launcher.program.display()))?;
        let stdin = child.stdin.take().ok_or("engine stdin")?;
        let stdout = child.stdout.take().ok_or("engine stdout")?;
        let stderr = child.stderr.take().ok_or("engine stderr")?;
        let alive = Arc::new(AtomicBool::new(true));

        let tail = self.stderr.clone();
        let tag = self.name.clone();
        thread::Builder::new()
            .name(format!("{}-stderr", self.name))
            .spawn(move || {
                for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                    log::info!("[{tag}] {line}");
                    if let Ok(mut t) = tail.lock() {
                        if t.len() == STDERR_TAIL {
                            t.pop_front();
                        }
                        t.push_back(line);
                    }
                }
            })
            .map_err(|e| e.to_string())?;

        let pending = self.pending.clone();
        let handler = self.on_notification.lock().ok().and_then(|h| h.clone());
        let tail = self.stderr.clone();
        let alive_flag = alive.clone();
        thread::Builder::new()
            .name(format!("{}-stdout", self.name))
            .spawn(move || {
                for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                    let Ok(msg) = serde_json::from_str::<Value>(&line) else {
                        log::warn!("engine: ignoring a non-JSON line on stdout: {line}");
                        continue;
                    };
                    if let Some(id) = msg.get("id").and_then(Value::as_u64) {
                        let waiter = pending.lock().ok().and_then(|mut p| p.remove(&id));
                        if let Some(tx) = waiter {
                            let reply = match msg.get("error") {
                                Some(err) => Err(err
                                    .get("message")
                                    .and_then(Value::as_str)
                                    .unwrap_or("errore sconosciuto")
                                    .to_string()),
                                None => Ok(msg.get("result").cloned().unwrap_or(Value::Null)),
                            };
                            let _ = tx.send(reply);
                        }
                    } else if let Some(method) = msg.get("method").and_then(Value::as_str) {
                        if let Some(h) = &handler {
                            h(method, msg.get("params").cloned().unwrap_or(Value::Null));
                        }
                    }
                }
                // The process has gone: fail every request still waiting.
                alive_flag.store(false, Ordering::SeqCst);
                thread::sleep(Duration::from_millis(50)); // let stderr drain into the tail
                let message = format!("il motore di analisi si è chiuso.\n{}", tail_text(&tail));
                if let Ok(mut p) = pending.lock() {
                    for (_, tx) in p.drain() {
                        let _ = tx.send(Err(message.clone()));
                    }
                }
            })
            .map_err(|e| e.to_string())?;
        Ok(Process { child, stdin, alive })
    }

    /// Call `method` and wait at most `timeout` for its result. A timeout leaves
    /// the process running (other requests, e.g. an OMR job, may be using it).
    pub fn request(&self, method: &str, params: Value, timeout: Duration) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = mpsc::channel();
        {
            let mut guard = self.process.lock().map_err(|_| "engine state poisoned")?;
            let alive = guard
                .as_mut()
                .is_some_and(|p| p.alive.load(Ordering::SeqCst) && matches!(p.child.try_wait(), Ok(None)));
            if !alive {
                *guard = Some(self.spawn()?);
            }
            self.pending.lock().map_err(|_| "engine state poisoned")?.insert(id, tx);
            let process = guard.as_mut().expect("engine process");
            let line = json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}).to_string();
            if let Err(e) = writeln!(process.stdin, "{line}").and_then(|_| process.stdin.flush()) {
                self.forget(id);
                *guard = None;
                return Err(format!("il motore non risponde: {e}\n{}", tail_text(&self.stderr)));
            }
        }
        match rx.recv_timeout(timeout) {
            Ok(reply) => reply,
            Err(RecvTimeoutError::Timeout) => {
                self.forget(id);
                Err(format!("il motore non ha risposto entro {} s", timeout.as_secs()))
            }
            Err(RecvTimeoutError::Disconnected) => Err("il motore si è chiuso".into()),
        }
    }

    fn forget(&self, id: u64) {
        if let Ok(mut p) = self.pending.lock() {
            p.remove(&id);
        }
    }

    /// Start the sidecar in the background so the first request does not pay
    /// for Python start-up.
    pub fn warm_up(self: &Arc<Self>) {
        let client = self.clone();
        thread::spawn(move || match client.request("ping", json!({}), Duration::from_secs(60)) {
            Ok(v) => log::info!("{} ready: {v}", client.name),
            Err(e) => log::warn!("{} not available: {e}", client.name),
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
        EngineClient::new(
            "engine",
            Some(Launcher { program: "python3".into(), args: vec!["-c".into(), FAKE.into()], cwd: None, env: vec![] }),
        )
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
    fn notifications_reach_the_handler() {
        let c = fake();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let sink = seen.clone();
        c.set_notification_handler(Arc::new(move |method, _| sink.lock().unwrap().push(method.to_string())));
        c.request("ping", json!({}), T).unwrap();
        c.request("ping", json!({}), T).unwrap();
        thread::sleep(Duration::from_millis(100));
        assert_eq!(*seen.lock().unwrap(), vec!["progress", "progress"]);
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
    fn times_out_without_killing_the_engine() {
        let c = fake();
        let err = c.request("slow", json!({}), Duration::from_millis(300)).unwrap_err();
        assert!(err.contains("non ha risposto"), "{err}");
        // The same process answers next, once the slow call is done; its late reply is ignored.
        assert_eq!(c.request("ping", json!({}), T).unwrap()["echo"], "ping");
    }

    #[test]
    fn missing_engine_is_reported() {
        let err = EngineClient::new("omr", None).request("ping", json!({}), T).unwrap_err();
        assert!(err.contains("motore «omr» non trovato"), "{err}");
    }

    /// The real engine through uv: `cargo test -- --ignored`.
    #[test]
    #[ignore = "needs uv and the engine's dependencies"]
    fn real_engine_analyzes_the_minuet() {
        let c = EngineClient::new("engine", Launcher::locate("engine"));
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
