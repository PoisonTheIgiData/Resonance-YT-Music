// Resonance — native extras: preferences file, GitHub update check, lyrics, Discord status,
// custom global hotkeys.
use std::collections::HashMap;
use std::io::Read;
use std::path::PathBuf;
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

const UA: &str = "Resonance-Desktop (https://github.com/PoisonTheIgiData/Resonance-YT-Music)";

/// The official repository: updates and release notes only ever come from here.
pub const UPDATE_REPO: &str = "PoisonTheIgiData/Resonance-YT-Music";
/// The repository's earlier name (GitHub redirects it to the new one).
pub const OLD_UPDATE_REPO: &str = "PoisonTheIgiData/Ressonance-YT-Music";

// ---------------- preferences needed before the window exists ----------------

fn prefs_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("prefs.json"))
}

pub fn load_prefs<R: Runtime>(app: &AppHandle<R>) -> Value {
    prefs_path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| json!({}))
}

/// Windows media overlay / lock screen controls (WebView2's media session). Default on.
pub fn smtc_enabled<R: Runtime>(app: &AppHandle<R>) -> bool {
    load_prefs(app).get("smtc").and_then(|v| v.as_bool()).unwrap_or(true)
}

/// Save one value in prefs.json (internal use; the page can only change the keys res_set_pref allows).
pub fn save_pref<R: Runtime>(app: &AppHandle<R>, key: &str, value: Value) {
    let mut prefs = load_prefs(app);
    if prefs.get(key) == Some(&value) {
        return;
    }
    prefs[key] = value;
    if let Some(path) = prefs_path(app) {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(path, prefs.to_string());
    }
}

#[tauri::command]
pub fn res_set_pref(app: AppHandle, key: String, value: Value) -> Result<(), String> {
    if !["smtc", "startMinimized"].contains(&key.as_str()) {
        return Err("unknown preference".into());
    }
    let mut prefs = load_prefs(&app);
    prefs[key] = value;
    let path = prefs_path(&app).ok_or("no config dir")?;
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    std::fs::write(path, prefs.to_string()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn res_get_prefs(app: AppHandle) -> Value {
    let mut p = load_prefs(&app);
    p["smtc"] = json!(smtc_enabled(&app));
    p["startMinimized"] = json!(load_prefs(&app).get("startMinimized").and_then(|v| v.as_bool()).unwrap_or(true));
    p["version"] = json!(app.package_info().version.to_string());
    if let Some(o) = p.as_object_mut() {
        o.remove("remoteToken"); // the page doesn't need the phone remote's secret
    }
    p
}

// ---------------- HTTP ----------------

fn get_text(url: &str, accept: &str) -> Result<String, String> {
    let resp = ureq::get(url)
        .set("User-Agent", UA)
        .set("Accept", accept)
        .timeout(Duration::from_secs(12))
        .call()
        .map_err(|e| match e {
            ureq::Error::Status(code, _) => format!("HTTP {code}"),
            other => other.to_string(),
        })?;
    let mut s = String::new();
    resp.into_reader().take(5_000_000).read_to_string(&mut s).map_err(|e| e.to_string())?;
    Ok(s)
}

// ---------------- updates: compare with the latest release on your GitHub repo ----------------

fn valid_repo(repo: &str) -> bool {
    let parts: Vec<&str> = repo.split('/').collect();
    parts.len() == 2
        && parts.iter().all(|p| !p.is_empty() && p.len() <= 100 && p.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c)))
}

/// Asks GitHub's public API for the latest release of `owner/repo` and compares its version
/// number with this app's version. No other server is involved.
#[tauri::command]
pub async fn res_check_update(app: AppHandle, repo: Option<String>) -> Result<Value, String> {
    let _ = repo; // always the official repository
    let repo = UPDATE_REPO.to_string();
    if !valid_repo(&repo) {
        return Err("Enter the repository as owner/name, e.g. igor/resonance".into());
    }
    let url = format!("https://api.github.com/repos/{repo}/releases/latest");
    let body = tauri::async_runtime::spawn_blocking(move || get_text(&url, "application/vnd.github+json"))
        .await
        .map_err(|e| e.to_string())??;
    let j: Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    let tag = j["tag_name"].as_str().unwrap_or("").trim().trim_start_matches(['v', 'V']).to_string();
    let latest = semver::Version::parse(&tag).map_err(|_| format!("The latest release tag \"{tag}\" isn't a version number like v1.2.0"))?;
    let current = semver::Version::parse(&app.package_info().version.to_string()).map_err(|e| e.to_string())?;
    let asset = j["assets"].as_array().and_then(|a| {
        a.iter()
            .find(|x| x["name"].as_str().map(|n| n.ends_with("-setup.exe")).unwrap_or(false))
            .or_else(|| a.iter().find(|x| x["name"].as_str().map(|n| n.ends_with(".exe")).unwrap_or(false)))
    });
    Ok(json!({
        "current": current.to_string(),
        "latest": latest.to_string(),
        "newer": latest > current,
        "notes": j["body"].as_str().unwrap_or(""),
        "page": j["html_url"].as_str().unwrap_or(""),
        "assetUrl": asset.and_then(|a| a["browser_download_url"].as_str()).unwrap_or(""),
        "assetName": asset.and_then(|a| a["name"].as_str()).unwrap_or(""),
        "size": asset.and_then(|a| a["size"].as_u64()).unwrap_or(0),
    }))
}

/// Release notes of one version (for the "What's new" screen after an update).
#[tauri::command]
pub async fn res_release_notes(app: AppHandle, repo: Option<String>, version: Option<String>) -> Result<Value, String> {
    let _ = repo; // always the official repository
    let repo = UPDATE_REPO.to_string();
    if !valid_repo(&repo) {
        return Err("no repository".into());
    }
    let ver = version.unwrap_or_else(|| app.package_info().version.to_string());
    let ver: String = ver.chars().filter(|c| c.is_ascii_alphanumeric() || ".-+".contains(*c)).take(40).collect();
    let (one, list, ver) = tauri::async_runtime::spawn_blocking(move || {
        let one = get_text(&format!("https://api.github.com/repos/{repo}/releases/tags/v{ver}"), "application/vnd.github+json")
            .or_else(|_| get_text(&format!("https://api.github.com/repos/{repo}/releases/tags/{ver}"), "application/vnd.github+json"));
        // every earlier release too, for the "Earlier updates" list
        let list = get_text(&format!("https://api.github.com/repos/{repo}/releases?per_page=50"), "application/vnd.github+json");
        (one, list, ver)
    })
    .await
    .map_err(|e| e.to_string())?;
    let cur = semver::Version::parse(ver.trim_start_matches(['v', 'V'])).ok();
    let mut history: Vec<(semver::Version, Value)> = Vec::new();
    if let Ok(body) = list {
        if let Ok(Value::Array(items)) = serde_json::from_str::<Value>(&body) {
            for r in items {
                if r["draft"].as_bool().unwrap_or(false) || r["prerelease"].as_bool().unwrap_or(false) {
                    continue;
                }
                let tag = r["tag_name"].as_str().unwrap_or("").trim_start_matches(['v', 'V']).to_string();
                let Ok(v) = semver::Version::parse(&tag) else { continue };
                if cur.as_ref().map(|c| &v >= c).unwrap_or(false) {
                    continue; // only versions before this one
                }
                history.push((v.clone(), json!({
                    "version": v.to_string(),
                    "body": r["body"].as_str().unwrap_or(""),
                    "date": r["published_at"].as_str().unwrap_or(""),
                    "page": r["html_url"].as_str().unwrap_or(""),
                })));
            }
        }
    }
    history.sort_by(|a, b| b.0.cmp(&a.0));
    let history: Vec<Value> = history.into_iter().map(|h| h.1).collect();
    let j: Value = match one {
        Ok(body) => serde_json::from_str(&body).map_err(|e| e.to_string())?,
        Err(e) if history.is_empty() => return Err(e),
        Err(_) => Value::Null,
    };
    Ok(json!({
        "name": j["name"].as_str().unwrap_or(""),
        "body": j["body"].as_str().unwrap_or(""),
        "page": j["html_url"].as_str().unwrap_or(""),
        "date": j["published_at"].as_str().unwrap_or(""),
        "history": history,
    }))
}

/// Downloads the installer from the GitHub release and runs it (it replaces this version).
#[tauri::command]
pub async fn res_install_update(app: AppHandle, url: String) -> Result<(), String> {
    // only installers attached to the official repository's releases
    // (the repository was renamed from "Ressonance-YT-Music"; GitHub may report either name)
    let lower = url.to_ascii_lowercase();
    let ok = [UPDATE_REPO, OLD_UPDATE_REPO].iter().any(|r| lower.starts_with(&format!("https://github.com/{}/releases/download/", r.to_ascii_lowercase())));
    if !ok || url.contains("..") {
        return Err("Updates are only downloaded from Resonance's GitHub releases".into());
    }
    let path = std::env::temp_dir().join("Resonance-update-setup.exe");
    let p2 = path.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let resp = ureq::get(&url).set("User-Agent", UA).timeout(Duration::from_secs(300)).call().map_err(|e| e.to_string())?;
        let mut bytes = Vec::new();
        resp.into_reader().take(400_000_000).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        if bytes.len() < 100_000 || &bytes[..2] != b"MZ" {
            return Err("The downloaded file isn't a Windows installer".into());
        }
        std::fs::write(&p2, bytes).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;
    // /P: just a progress bar, no questions; /UPDATE: install over the current version (no
    // "uninstall first?" page, keeps shortcuts as they are); /R: start Resonance again afterwards
    std::process::Command::new(&path).args(["/P", "/UPDATE", "/R"]).spawn().map_err(|e| e.to_string())?;
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(600));
        handle.exit(0);
    });
    Ok(())
}

/// Until when (ms since 1970) Resonance must not tuck itself into the taskbar player because the
/// browser was just opened from it (opening a link is not "clicking away").
pub static NO_AUTODOCK_UNTIL: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
pub fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

#[tauri::command]
pub fn res_open_url(url: String) -> Result<(), String> {
    if !(url.starts_with("https://github.com/") || url.starts_with("https://discord.com/") || url.starts_with("https://lrclib.net/")) {
        return Err("blocked".into());
    }
    NO_AUTODOCK_UNTIL.store(now_ms() + 4000, std::sync::atomic::Ordering::SeqCst);
    #[cfg(windows)]
    {
        std::process::Command::new("rundll32").args(["url.dll,FileProtocolHandler", &url]).spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("xdg-open").arg(&url).spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ---------------- lyrics (LRCLIB, free open lyrics database) ----------------

#[tauri::command]
pub async fn res_lyrics(artist: String, title: String, album: String, duration: f64) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<Value, String> {
        let mut u = tauri::Url::parse("https://lrclib.net/api/get").unwrap();
        u.query_pairs_mut()
            .append_pair("artist_name", &artist)
            .append_pair("track_name", &title);
        if !album.is_empty() {
            u.query_pairs_mut().append_pair("album_name", &album);
        }
        if duration > 0.0 {
            u.query_pairs_mut().append_pair("duration", &format!("{}", duration.round() as i64));
        }
        let pick = |v: &Value| json!({ "synced": v["syncedLyrics"], "plain": v["plainLyrics"], "instrumental": v["instrumental"], "source": "LRCLIB" });
        if let Ok(body) = get_text(u.as_str(), "application/json") {
            if let Ok(v) = serde_json::from_str::<Value>(&body) {
                if v.get("id").is_some() {
                    return Ok(pick(&v));
                }
            }
        }
        // no exact match: search and take the closest result by duration
        let mut s = tauri::Url::parse("https://lrclib.net/api/search").unwrap();
        s.query_pairs_mut().append_pair("track_name", &title).append_pair("artist_name", &artist);
        let body = get_text(s.as_str(), "application/json")?;
        let list: Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
        let best = list.as_array().and_then(|a| {
            a.iter()
                .filter(|x| x["syncedLyrics"].is_string() || x["plainLyrics"].is_string())
                .min_by_key(|x| ((x["duration"].as_f64().unwrap_or(0.0) - duration).abs() * 10.0) as i64)
        });
        Ok(best.map(pick).unwrap_or(Value::Null))
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------------- Discord status ----------------

enum DMsg {
    Config { enabled: bool, id: String },
    Update { title: String, artist: String, art: Option<String>, playing: bool, time: f64, duration: f64 },
}
static DISCORD: OnceLock<Mutex<Sender<DMsg>>> = OnceLock::new();

fn discord_tx() -> &'static Mutex<Sender<DMsg>> {
    DISCORD.get_or_init(|| {
        let (tx, rx) = channel::<DMsg>();
        std::thread::spawn(move || {
            use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
            let mut enabled = false;
            let mut id = String::new();
            let mut client: Option<DiscordIpcClient> = None;
            let mut last_key = String::new();
            let mut pending: Option<DMsg> = None;
            loop {
                let msg = match pending.take() {
                    Some(m) => Ok(m),
                    None => rx.recv_timeout(Duration::from_secs(20)),
                };
                match msg {
                    Ok(DMsg::Config { enabled: e, id: i }) => {
                        if !e || i != id {
                            if let Some(mut c) = client.take() {
                                let _ = c.clear_activity();
                                let _ = c.close();
                            }
                            last_key.clear();
                        }
                        enabled = e;
                        id = i;
                    }
                    Ok(DMsg::Update { title, artist, art, playing, time, duration }) => {
                        // only the newest update matters
                        while let Ok(m) = rx.try_recv() {
                            if let DMsg::Config { .. } = m {
                                pending = Some(m);
                                break;
                            }
                            if let DMsg::Update { title: t, artist: a, art: r, playing: p, time: ti, duration: d } = m {
                                return_update(&mut client, &mut last_key, enabled, &id, t, a, r, p, ti, d);
                            }
                        }
                        return_update(&mut client, &mut last_key, enabled, &id, title, artist, art, playing, time, duration);
                    }
                    Err(RecvTimeoutError::Timeout) => {}
                    Err(RecvTimeoutError::Disconnected) => break,
                }
            }

            #[allow(clippy::too_many_arguments)]
            fn return_update(
                client: &mut Option<DiscordIpcClient>, last_key: &mut String, enabled: bool, id: &str,
                title: String, artist: String, art: Option<String>, playing: bool, time: f64, duration: f64,
            ) {
                if !enabled || id.is_empty() {
                    return;
                }
                let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
                let start = now - time as i64;
                let key = format!("{title}|{artist}|{playing}|{}", start / 3);
                if key == *last_key {
                    return;
                }
                if client.is_none() {
                    let mut c = DiscordIpcClient::new(id);
                    if c.connect().is_err() {
                        return; // Discord not running — try again on the next update
                    }
                    *client = Some(c);
                }
                let c = client.as_mut().unwrap();
                let res = if !playing || title.is_empty() {
                    c.clear_activity()
                } else {
                    let mut a = activity::Activity::new()
                        .activity_type(activity::ActivityType::Listening)
                        .status_display_type(activity::StatusDisplayType::Details)
                        .details(title.clone())
                        .state(format!("by {artist}"));
                    if duration > 0.0 {
                        a = a.timestamps(activity::Timestamps::new().start(start).end(start + duration as i64));
                    }
                    let assets = match art.as_deref() {
                        Some(u) if u.starts_with("https://") => activity::Assets::new().large_image(u.to_string()).large_text("Resonance"),
                        _ => activity::Assets::new().large_text("Resonance"),
                    };
                    c.set_activity(a.assets(assets))
                };
                if res.is_err() {
                    *client = None; // reconnect next time
                } else {
                    *last_key = key;
                }
            }
        });
        Mutex::new(tx)
    })
}

#[tauri::command]
pub fn res_discord(enabled: bool, client_id: String) {
    let id: String = client_id.chars().filter(|c| c.is_ascii_digit()).collect();
    let _ = discord_tx().lock().unwrap().send(DMsg::Config { enabled, id });
}

pub fn discord_update(title: &str, artist: &str, art: Option<String>, playing: bool, time: f64, duration: f64) {
    if let Some(tx) = DISCORD.get() {
        let _ = tx.lock().unwrap().send(DMsg::Update {
            title: title.to_string(),
            artist: artist.to_string(),
            art,
            playing,
            time,
            duration,
        });
    }
}

// ---------------- custom global hotkeys ----------------

pub static HOTKEYS: Mutex<Vec<(u32, String)>> = Mutex::new(Vec::new());

/// Registers user hotkeys ({action: "Control+Alt+ArrowRight"}). Returns the ones that failed.
#[tauri::command]
pub fn res_set_hotkeys(app: AppHandle, map: HashMap<String, String>) -> Value {
    let gs = app.global_shortcut();
    let mut list = HOTKEYS.lock().unwrap();
    list.clear();
    // start clean, then put the media keys back (if Resonance handles them) and add the user's keys
    let _ = gs.unregister_all();
    crate::register_media_keys(&app);
    let mut failed = serde_json::Map::new();
    for (action, accel) in map {
        if accel.trim().is_empty() {
            continue;
        }
        match accel.parse::<Shortcut>() {
            Ok(sc) => {
                if gs.register(sc).is_ok() {
                    list.push((sc.id(), action));
                } else {
                    failed.insert(action, json!("already used by another app"));
                }
            }
            Err(_) => {
                failed.insert(action, json!("not a valid key combination"));
            }
        }
    }
    Value::Object(failed)
}

pub fn hotkey_action(id: u32) -> Option<String> {
    HOTKEYS.lock().unwrap().iter().find(|(i, _)| *i == id).map(|(_, a)| a.clone())
}

// ---------------- start with Windows ----------------

/// Get (value = None) or set "start with Windows". Returns the current state.
#[tauri::command]
pub fn res_autostart(app: AppHandle, value: Option<bool>) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    let al = app.autolaunch();
    if let Some(v) = value {
        if v { al.enable() } else { al.disable() }.map_err(|e| e.to_string())?;
    }
    al.is_enabled().map_err(|e| e.to_string())
}

/// Whether a start-up from Windows (launched with --minimized) should stay in the tray.
pub fn start_minimized<R: Runtime>(app: &AppHandle<R>) -> bool {
    std::env::args().any(|a| a == "--minimized") && load_prefs(app).get("startMinimized").and_then(|v| v.as_bool()).unwrap_or(true)
}

// ---------------- song-change notifications ----------------

#[tauri::command]
pub fn res_notify(app: AppHandle, title: String, body: String, always: Option<bool>) {
    use tauri_plugin_notification::NotificationExt;
    // song changes: only when Resonance isn't in front; warnings (always = true): every time
    if always.unwrap_or(false) {
        let _ = app.notification().builder().title(title).body(body).show();
        return;
    }
    if let Some(w) = app.get_webview_window("main") {
        if w.is_focused().unwrap_or(false) && w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false) {
            return;
        }
    }
    let _ = app.notification().builder().title(title).body(body).show();
}

// ---------------- lyrics translation ----------------

/// Translates lyric lines with Google Translate's free web endpoint (the one browser
/// extensions use). Returns { lang: detected source language, lines: [...] }.
#[tauri::command]
pub async fn res_translate(lines: Vec<String>, target: String) -> Result<Value, String> {
    let target: String = target.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').take(8).collect();
    if lines.is_empty() || target.is_empty() {
        return Ok(json!({ "lang": "", "lines": [], "roman": [] }));
    }
    tauri::async_runtime::spawn_blocking(move || -> Result<Value, String> {
        // translate in chunks to keep URLs short; one line per "\n"
        let mut out: Vec<String> = Vec::with_capacity(lines.len());
        let mut roman: Vec<String> = Vec::with_capacity(lines.len());
        let mut lang = String::new();
        let mut chunk: Vec<String> = Vec::new();
        let flush = |chunk: &mut Vec<String>, out: &mut Vec<String>, roman: &mut Vec<String>, lang: &mut String| -> Result<(), String> {
            if chunk.is_empty() {
                return Ok(());
            }
            let text = chunk.join("\n");
            let mut u = tauri::Url::parse("https://translate.googleapis.com/translate_a/single").unwrap();
            u.query_pairs_mut()
                .append_pair("client", "gtx").append_pair("sl", "auto").append_pair("tl", &target)
                .append_pair("dt", "t").append_pair("dt", "rm").append_pair("q", &text);
            let body = get_text(u.as_str(), "application/json")?;
            let v: Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
            let mut joined = String::new();
            // romanization ("dt=rm") comes as an extra part: [null, null, target, source]
            let mut rom = String::new();
            if let Some(parts) = v.get(0).and_then(|p| p.as_array()) {
                for p in parts {
                    if let Some(t) = p.get(0).and_then(|t| t.as_str()) {
                        joined.push_str(t);
                    } else if let Some(r) = p.get(3).and_then(|t| t.as_str()) {
                        rom.push_str(r);
                    }
                }
            }
            let mut rgot: Vec<String> = if rom.is_empty() { vec![] } else { rom.split('\n').map(|s| s.trim().to_string()).collect() };
            if rgot.len() != chunk.len() {
                rgot = vec![String::new(); chunk.len()]; // lines didn't line up: skip rather than mismatch
            }
            roman.extend(rgot);
            if lang.is_empty() {
                *lang = v.get(2).and_then(|l| l.as_str()).unwrap_or("").to_string();
            }
            let mut got: Vec<String> = joined.split('\n').map(|s| s.trim().to_string()).collect();
            got.resize(chunk.len(), String::new());
            out.extend(got);
            chunk.clear();
            Ok(())
        };
        let mut size = 0;
        for l in lines {
            if size + l.len() > 1500 {
                flush(&mut chunk, &mut out, &mut roman, &mut lang)?;
                size = 0;
            }
            size += l.len() + 1;
            chunk.push(l);
        }
        flush(&mut chunk, &mut out, &mut roman, &mut lang)?;
        Ok(json!({ "lang": lang, "lines": out, "roman": roman }))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Last lines of %TEMP%\resonance-log.txt (crashes and start-up problems), for the health check.
#[tauri::command]
pub fn res_read_log() -> Vec<String> {
    let path = std::env::temp_dir().join("resonance-log.txt");
    let text = std::fs::read_to_string(path).unwrap_or_default();
    let lines: Vec<String> = text.lines().map(|l| l.chars().take(400).collect()).collect();
    let n = lines.len();
    lines[n.saturating_sub(60)..].to_vec()
}
