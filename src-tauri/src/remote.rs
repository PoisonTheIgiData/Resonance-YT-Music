//! Phone remote: a tiny web page on the local network (same Wi-Fi) with play controls.
//!
//! * Off by default. When on, Resonance listens on port 48720 (or the next free one up to 48730).
//! * Every address contains a random secret ("token"), so only someone who scanned the QR code
//!   (or was given the link) can use it. "New link" replaces the secret; old links stop working.
//! * Nothing leaves your network: the phone talks straight to this PC.

use serde_json::{json, Value};
use std::hash::{BuildHasher, Hasher};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager};

const PAGE: &str = include_str!("../remote.html");

#[derive(Default)]
pub struct Remote {
    token: Mutex<String>,
    port: Mutex<u16>,
    stop: Mutex<Option<Arc<AtomicBool>>>,
}

fn new_token() -> String {
    const A: &[u8] = b"abcdefghijkmnpqrstuvwxyz23456789";
    let mut s = String::new();
    for round in 0..2u64 {
        let mut h = std::collections::hash_map::RandomState::new().build_hasher();
        h.write_u64(round ^ std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(7));
        let mut v = h.finish();
        for _ in 0..6 {
            s.push(A[(v % A.len() as u64) as usize] as char);
            v /= A.len() as u64;
        }
    }
    s
}

/// This PC's address on the local network (no data is sent; UDP "connect" only picks a route).
fn lan_ip() -> String {
    UdpSocket::bind("0.0.0.0:0")
        .and_then(|s| { s.connect("192.168.1.1:80").or_else(|_| s.connect("8.8.8.8:80"))?; s.local_addr() })
        .map(|a| a.ip().to_string())
        .unwrap_or_else(|_| "127.0.0.1".into())
}

fn qr_bits(text: &str) -> Value {
    match qrcodegen::QrCode::encode_text(text, qrcodegen::QrCodeEcc::Medium) {
        Ok(q) => {
            let n = q.size();
            let mut bits = String::with_capacity((n * n) as usize);
            for y in 0..n {
                for x in 0..n {
                    bits.push(if q.get_module(x, y) { '1' } else { '0' });
                }
            }
            json!({ "size": n, "bits": bits })
        }
        Err(_) => Value::Null,
    }
}

fn respond(s: &mut TcpStream, code: &str, ctype: &str, body: &[u8]) {
    let head = format!(
        "HTTP/1.1 {code}\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = s.write_all(head.as_bytes());
    let _ = s.write_all(body);
}

fn handle(app: &AppHandle, mut s: TcpStream) {
    let _ = s.set_read_timeout(Some(Duration::from_secs(3)));
    let mut buf = [0u8; 4096];
    let mut got = Vec::new();
    while !got.windows(4).any(|w| w == b"\r\n\r\n") && got.len() < 8192 {
        match s.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => got.extend_from_slice(&buf[..n]),
        }
    }
    let req = String::from_utf8_lossy(&got);
    let mut first = req.lines().next().unwrap_or("").split_whitespace();
    let method = first.next().unwrap_or("");
    let target = first.next().unwrap_or("/");
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    let token = app.state::<Remote>().token.lock().unwrap().clone();
    let mut parts = path.trim_start_matches('/').splitn(3, '/');
    if token.is_empty() || parts.next() != Some(token.as_str()) {
        return respond(&mut s, "404 Not Found", "text/plain; charset=utf-8", b"Not found");
    }
    let q = |k: &str| query.split('&').find_map(|kv| kv.strip_prefix(&format!("{k}="))).and_then(|v| v.parse::<f64>().ok());
    match (method, parts.next().unwrap_or(""), parts.next().unwrap_or("")) {
        ("GET", "", _) => respond(&mut s, "200 OK", "text/html; charset=utf-8", PAGE.as_bytes()),
        ("GET", "state", _) => {
            let st = app.state::<crate::AppState>().now_playing.lock().unwrap().to_string();
            respond(&mut s, "200 OK", "application/json", st.as_bytes())
        }
        ("POST", "cmd", c) => {
            match c {
                "toggle" | "next" | "prev" | "like" | "shuffle" | "volUp" | "volDown" => crate::send_cmd(app, c),
                "vol" => {
                    if let (Some(v), Some(w)) = (q("v"), app.get_webview_window("main")) {
                        let _ = w.eval(format!("window.__res && window.__res.cmd('volume', {})", v.clamp(0.0, 100.0).round()));
                    }
                }
                "seek" => {
                    if let (Some(f), Some(w)) = (q("f"), app.get_webview_window("main")) {
                        let _ = w.eval(format!("window.__res && window.__res.cmd('seekPct', {})", f.clamp(0.0, 1.0)));
                    }
                }
                _ => return respond(&mut s, "400 Bad Request", "text/plain", b"unknown command"),
            }
            respond(&mut s, "200 OK", "application/json", b"{\"ok\":true}")
        }
        _ => respond(&mut s, "404 Not Found", "text/plain; charset=utf-8", b"Not found"),
    }
}

fn start(app: &AppHandle) -> Result<u16, String> {
    let r = app.state::<Remote>();
    if r.stop.lock().unwrap().is_some() {
        return Ok(*r.port.lock().unwrap());
    }
    let mut listener = None;
    // keep the usual port if possible (a just-stopped remote may need a moment to let go of it),
    // so the QR code / bookmark stays the same
    for _ in 0..4 {
        if let Ok(l) = TcpListener::bind(("0.0.0.0", 48720u16)) { listener = Some((l, 48720u16)); break; }
        std::thread::sleep(Duration::from_millis(100));
    }
    if listener.is_none() {
        for port in 48721..=48730u16 {
            if let Ok(l) = TcpListener::bind(("0.0.0.0", port)) { listener = Some((l, port)); break; }
        }
    }
    let (l, port) = listener.ok_or("No free network port (48720–48730) — another app is using them")?;
    l.set_nonblocking(true).map_err(|e| e.to_string())?;
    let stop = Arc::new(AtomicBool::new(false));
    *r.stop.lock().unwrap() = Some(stop.clone());
    *r.port.lock().unwrap() = port;
    let app = app.clone();
    std::thread::spawn(move || {
        while !stop.load(Ordering::Relaxed) {
            match l.accept() {
                Ok((s, _)) => {
                    let _ = s.set_nonblocking(false);
                    let a = app.clone();
                    std::thread::spawn(move || handle(&a, s));
                }
                Err(_) => std::thread::sleep(Duration::from_millis(80)),
            }
        }
    });
    Ok(port)
}

fn stop(app: &AppHandle) {
    if let Some(f) = app.state::<Remote>().stop.lock().unwrap().take() {
        f.store(true, Ordering::Relaxed);
    }
}

/// Turn the phone remote on/off (renew = make a new secret link). Returns { url, qr } or { error }.
#[tauri::command]
pub async fn res_remote(app: AppHandle, enabled: bool, renew: Option<bool>) -> Value {
    if !enabled {
        stop(&app);
        return json!({ "on": false });
    }
    {
        let r = app.state::<Remote>();
        let mut t = r.token.lock().unwrap();
        if t.is_empty() && !renew.unwrap_or(false) {
            // keep the same link across restarts, so a bookmark on the phone keeps working
            *t = crate::extras::load_prefs(&app).get("remoteToken").and_then(|v| v.as_str()).unwrap_or("").to_string();
        }
        if t.len() < 8 || renew.unwrap_or(false) {
            *t = new_token();
            crate::extras::save_pref(&app, "remoteToken", json!(t.clone()));
        }
    }
    match start(&app) {
        Ok(port) => {
            let token = app.state::<Remote>().token.lock().unwrap().clone();
            let url = format!("http://{}:{}/{}", lan_ip(), port, token);
            json!({ "on": true, "url": url, "qr": qr_bits(&url) })
        }
        Err(e) => json!({ "on": false, "error": e }),
    }
}
