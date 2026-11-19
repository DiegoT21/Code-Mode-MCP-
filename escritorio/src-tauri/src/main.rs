// Code Mode MCP — desktop app (Tauri, Rust).
//
// The window is a webview showing the local panel. On start the app runs `node bin/code-mode-mcp.mjs open`
// (bundled with the app, no console window), waits for http://localhost:4777 and shows it. On close it
// stops that server and everything it started. If the panel was already running (`npx code-mode-mcp`),
// it is reused and left running. Needs Node.js installed.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::OpenOptions;
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{Manager, RunEvent, Url};

const PORT: u16 = 4777;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const NO_WINDOW: u32 = 0x0800_0000; // CREATE_NO_WINDOW

struct PanelServer(Mutex<Option<Child>>);

fn answers(port: u16) -> bool {
    TcpStream::connect_timeout(&SocketAddr::from(([127, 0, 0, 1], port)), Duration::from_millis(300)).is_ok()
}

// Where the panel's code is: bundled with the app, or the repository when running from source
fn app_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(d) = std::env::var("CODE_MODE_APP_DIR") {
        candidates.push(PathBuf::from(d));
    }
    if let Ok(r) = app.path().resource_dir() {
        candidates.push(r.join("app"));
    }
    candidates.push(Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join(".."));
    candidates.into_iter().find(|c| c.join("bin").join("code-mode-mcp.mjs").is_file())
}

fn node_path() -> PathBuf {
    for p in [r"C:\Program Files\nodejs\node.exe", "/usr/local/bin/node", "/opt/homebrew/bin/node", "/usr/bin/node"] {
        let p = PathBuf::from(p);
        if p.is_file() {
            return p;
        }
    }
    PathBuf::from("node")
}

fn home_dir() -> PathBuf {
    std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."))
}

fn start_server(dir: &Path) -> Result<Child, String> {
    let logs = home_dir().join(".code-mode-mcp");
    let _ = std::fs::create_dir_all(&logs);
    let log = OpenOptions::new().create(true).append(true).open(logs.join("desktop.log")).map_err(|e| e.to_string())?;
    let log2 = log.try_clone().map_err(|e| e.to_string())?;
    let mut cmd = Command::new(node_path());
    cmd.arg(dir.join("bin").join("code-mode-mcp.mjs"))
        .args(["open", "--no-open"])
        .current_dir(dir)
        .env("CODE_MODE_PORT", PORT.to_string())
        // The server checks this process and stops by itself if the app dies without saying goodbye
        .env("CODE_MODE_PARENT", std::process::id().to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log2));
    #[cfg(windows)]
    cmd.creation_flags(NO_WINDOW);
    cmd.spawn().map_err(|e| format!("Could not start Node.js ({e}). Install Node.js 20 or newer from nodejs.org."))
}

fn stop(child: &mut Child) {
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill").args(["/PID", &child.id().to_string(), "/T", "/F"]).creation_flags(NO_WINDOW).status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn show_error(app: &tauri::AppHandle, text: &str) {
    if let Some(w) = app.get_webview_window("main") {
        let escaped = text.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', " ");
        let _ = w.eval(&format!("window.showError && window.showError(\"{escaped}\")"));
    }
}

fn main() {
    let app = tauri::Builder::default()
        // One window only: opening the app again brings the existing one to the front
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .manage(PanelServer(Mutex::new(None)))
        .setup(|app| {
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                if !answers(PORT) {
                    let Some(dir) = app_dir(&handle) else {
                        show_error(&handle, "The panel files were not found. Reinstall Code Mode MCP.");
                        return;
                    };
                    match start_server(&dir) {
                        Ok(child) => *handle.state::<PanelServer>().0.lock().unwrap() = Some(child),
                        Err(e) => {
                            show_error(&handle, &e);
                            return;
                        }
                    }
                    let start = Instant::now();
                    while !answers(PORT) {
                        if start.elapsed() > Duration::from_secs(40) {
                            show_error(&handle, "The panel did not start in 40 s. See ~/.code-mode-mcp/desktop.log");
                            return;
                        }
                        std::thread::sleep(Duration::from_millis(150));
                    }
                }
                if let Some(w) = handle.get_webview_window("main") {
                    let _ = w.navigate(format!("http://localhost:{PORT}/").parse::<Url>().unwrap());
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("could not create the app");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Some(mut child) = handle.state::<PanelServer>().0.lock().unwrap().take() {
                stop(&mut child);
            }
        }
    });
}
