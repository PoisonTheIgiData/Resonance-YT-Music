// Resonance — a desktop player for YouTube Music (Tauri + WebView2)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod devices;
mod extras;
mod remote;

use std::io::Read;
use std::sync::Mutex;
use std::time::Duration;

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent, Wry,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_window_state::StateFlags;

const YTM: &str = "https://music.youtube.com/";

/// WebView2 requires every webview in the app to use identical browser arguments
/// (they share one browser process). Media keys are handled by Resonance itself, and
/// autoplay is allowed so the player buttons always work.
/// When Windows media controls are on, WebView2 handles media keys itself (and shows the
/// Windows media overlay / lock screen controls); otherwise Resonance registers the keys.
#[cfg(windows)]
fn browser_args(smtc: bool) -> String {
    if smtc {
        "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,SpareRendererForSitePerProcess --enable-features=HardwareMediaKeyHandling,GlobalMediaControls --autoplay-policy=no-user-gesture-required".into()
    } else {
        "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,HardwareMediaKeyHandling,SpareRendererForSitePerProcess --autoplay-policy=no-user-gesture-required".into()
    }
}

pub fn register_media_keys(app: &AppHandle) {
    if extras::smtc_enabled(app) {
        return; // WebView2 + Windows handle them
    }
    for code in [Code::MediaPlayPause, Code::MediaTrackNext, Code::MediaTrackPrevious, Code::MediaStop] {
        let _ = app.global_shortcut().register(Shortcut::new(None, code));
    }
}

#[derive(Default)]
struct AppState {
    close_to_tray: Mutex<bool>,
    now_item: Mutex<Option<MenuItem<Wry>>>,
    toggle_item: Mutex<Option<MenuItem<Wry>>>,
    widget_enabled: Mutex<bool>,
    now_playing: Mutex<serde_json::Value>,
    widget_layout: Mutex<serde_json::Value>,
    mini_prev: Mutex<Option<(PhysicalPosition<i32>, PhysicalSize<u32>, bool)>>,
    /// Taskbar player extras (logical px): the Bluetooth / audio bubble next to it, and the
    /// panel that opens above the bubble.
    widget_bubble: Mutex<f64>,
    widget_panel: Mutex<(f64, f64)>,
    /// Start-up: stay hidden (started with Windows, or closed while in taskbar-player mode)
    boot_hidden: Mutex<bool>,
    /// The main window has been shown at least once
    main_ready: Mutex<bool>,
    /// Song-change pop-up: (on, corner, also when Resonance is in front, milliseconds)
    overlay: Mutex<(bool, String, bool, u64)>,
    last_play_key: Mutex<String>,
    last_mode: Mutex<String>,
}

/// Which mode Resonance is in: "windowed", "mini" or "taskbar" (hidden / minimized with the
/// taskbar player on). Saved, so the next start opens the same way.
fn remember_mode(app: &AppHandle) {
    // try_lock everywhere: this runs from window events, which can fire while another part of
    // Resonance is in the middle of changing the window — never wait, just skip that update.
    let st = app.state::<AppState>();
    match st.main_ready.try_lock() { Ok(r) if *r => {}, _ => return } // still starting up / busy
    let Ok(mini) = st.mini_prev.try_lock().map(|p| p.is_some()) else { return };
    let Ok(widget_on) = st.widget_enabled.try_lock().map(|w| *w) else { return };
    let mode = if mini {
        "mini"
    } else if let Some(m) = main_window(app) {
        let away = !m.is_visible().unwrap_or(true) || m.is_minimized().unwrap_or(false);
        if away && widget_on { "taskbar" } else { "windowed" }
    } else {
        "windowed"
    };
    let Ok(mut last) = st.last_mode.try_lock() else { return };
    if *last != mode {
        *last = mode.to_string();
        drop(last);
        extras::save_pref(app, "lastMode", serde_json::json!(mode));
    }
}

// ---------------- transitions ----------------

/// Bumped whenever a window transition starts, so an older one still running stops.
static WIN_ANIM: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
/// Bumped whenever the taskbar player is shown or hidden (a delayed hide must not hide it again).
static WIDGET_GEN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Smoothly move/resize a window between two rectangles (physical pixels), then run `done`.
fn animate_window<F>(w: &WebviewWindow, from: (PhysicalPosition<i32>, PhysicalSize<u32>), to: (PhysicalPosition<i32>, PhysicalSize<u32>), ms: u64, done: F)
where
    F: FnOnce(&WebviewWindow) + Send + 'static,
{
    use std::sync::atomic::Ordering;
    let gen = WIN_ANIM.fetch_add(1, Ordering::SeqCst) + 1;
    let w = w.clone();
    std::thread::spawn(move || {
        let steps = (ms / 15).max(1);
        let lerp = |a: f64, b: f64, t: f64| a + (b - a) * t;
        for i in 1..=steps {
            if WIN_ANIM.load(Ordering::SeqCst) != gen {
                return; // a newer transition took over
            }
            let t = i as f64 / steps as f64;
            let e = 1.0 - (1.0 - t).powi(3); // ease-out
            let x = lerp(from.0.x as f64, to.0.x as f64, e).round() as i32;
            let y = lerp(from.0.y as f64, to.0.y as f64, e).round() as i32;
            let cw = lerp(from.1.width as f64, to.1.width as f64, e).round() as u32;
            let ch = lerp(from.1.height as f64, to.1.height as f64, e).round() as u32;
            let _ = w.set_position(PhysicalPosition::new(x, y));
            let _ = w.set_size(PhysicalSize::new(cw.max(1), ch.max(1)));
            std::thread::sleep(Duration::from_millis(15));
        }
        if WIN_ANIM.load(Ordering::SeqCst) == gen {
            done(&w);
        }
    });
}

// ---------------- gliding into / out of the taskbar player ----------------

/// Settings → Animations (the page tells us when it changes).
static ANIMS: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(true);

/// Where the window was before it glided into the taskbar player, so it can grow back out of it.
#[derive(Clone, Copy)]
#[cfg_attr(not(windows), allow(dead_code))]
struct Docked {
    pos: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    mini: bool,
    /// screen → Windows "workspace" coordinates (differs when the taskbar is on the top or left)
    dx: i32,
    dy: i32,
}
static DOCKED: Mutex<Option<Docked>> = Mutex::new(None);
/// True while the window is shrinking into the taskbar player.
static DOCKING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[cfg(windows)]
mod winfx {
    use std::ffi::c_void;
    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    pub struct Pt { pub x: i32, pub y: i32 }
    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    pub struct Rect { pub left: i32, pub top: i32, pub right: i32, pub bottom: i32 }
    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    pub struct Placement { pub length: u32, pub flags: u32, pub show_cmd: u32, pub min: Pt, pub max: Pt, pub normal: Rect }
    #[link(name = "user32")]
    extern "system" {
        fn GetWindowPlacement(hwnd: *mut c_void, p: *mut Placement) -> i32;
        fn SetWindowPlacement(hwnd: *mut c_void, p: *const Placement) -> i32;
    }
    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmSetWindowAttribute(hwnd: *mut c_void, attr: u32, value: *const c_void, size: u32) -> i32;
    }
    pub const SW_MINIMIZE: u32 = 6;
    pub const SW_RESTORE: u32 = 9;
    fn hwnd(w: &tauri::WebviewWindow) -> Option<*mut c_void> {
        w.hwnd().ok().map(|h| h.0 as *mut c_void)
    }
    /// Turn Windows' own minimize / restore animation off (it always flies to the taskbar icon).
    pub fn no_transitions(w: &tauri::WebviewWindow, off: bool) {
        if let Some(h) = hwnd(w) {
            let v: i32 = off as i32;
            unsafe { DwmSetWindowAttribute(h, 3 /* DWMWA_TRANSITIONS_FORCEDISABLED */, &v as *const i32 as *const c_void, 4); }
        }
    }
    pub fn placement(w: &tauri::WebviewWindow) -> Option<Placement> {
        let h = hwnd(w)?;
        let mut p = Placement { length: std::mem::size_of::<Placement>() as u32, ..Default::default() };
        (unsafe { GetWindowPlacement(h, &mut p) } != 0).then_some(p)
    }
    pub fn set_placement(w: &tauri::WebviewWindow, p: &Placement) {
        if let Some(h) = hwnd(w) {
            let mut p = *p;
            p.length = std::mem::size_of::<Placement>() as u32;
            unsafe { SetWindowPlacement(h, &p); }
        }
    }
}

/// With the taskbar player on, Windows' minimize animation (aimed at the taskbar icon) is replaced
/// by Resonance's own (into the taskbar player). Without it, Windows' animation is the right one.
fn sync_transitions(app: &AppHandle) {
    #[cfg(windows)]
    if let Some(m) = main_window(app) {
        let on = *app.state::<AppState>().widget_enabled.lock().unwrap();
        winfx::no_transitions(&m, on);
    }
    #[cfg(not(windows))]
    let _ = app;
}

fn restore_min_size(w: &WebviewWindow, mini: bool) {
    let _ = if mini { w.set_min_size(Some(tauri::LogicalSize::new(300.0, 120.0))) } else { w.set_min_size(Some(tauri::LogicalSize::new(960.0, 620.0))) };
}

/// The taskbar player's rectangle (positioned even while hidden).
fn widget_rect(app: &AppHandle, place: bool) -> Option<(PhysicalPosition<i32>, PhysicalSize<u32>)> {
    let wg = app.get_webview_window("widget")?;
    if place {
        position_widget(app, &wg);
    }
    let (p, s) = (wg.outer_position().ok()?, wg.inner_size().ok()?);
    (s.width > 0 && s.height > 0).then_some((p, s))
}

/// Minimize (or hide to the tray) by shrinking the window straight into the taskbar player.
/// Returns false when that doesn't apply (animations off, no taskbar player, maximized…), so the
/// caller does a normal minimize / hide.
fn dock(app: &AppHandle, w: &WebviewWindow, to_tray: bool) -> bool {
    use std::sync::atomic::Ordering;
    if !ANIMS.load(Ordering::SeqCst) || !*app.state::<AppState>().widget_enabled.lock().unwrap() {
        return false;
    }
    if !w.is_visible().unwrap_or(false) || w.is_minimized().unwrap_or(true) || w.is_maximized().unwrap_or(true) || w.is_fullscreen().unwrap_or(true) {
        return false;
    }
    let (Ok(pos), Ok(size)) = (w.outer_position(), w.inner_size()) else { return false };
    let Some(target) = widget_rect(app, true) else { return false };
    #[cfg(windows)]
    let (dx, dy) = winfx::placement(w).map(|p| (pos.x - p.normal.left, pos.y - p.normal.top)).unwrap_or((0, 0));
    #[cfg(not(windows))]
    let (dx, dy) = (0, 0);
    let mini = app.state::<AppState>().mini_prev.lock().unwrap().is_some();
    *DOCKED.lock().unwrap() = Some(Docked { pos, size, mini, dx, dy });
    DOCKING.store(true, Ordering::SeqCst);
    sync_transitions(app);
    let _ = w.eval("window.__resDock && window.__resDock(150)"); // tint the window like the taskbar player
    let _ = w.set_min_size(None::<tauri::Size>);
    let a = app.clone();
    animate_window(w, (pos, size), target, 250, move |w| {
        // the taskbar player appears exactly where the window ended up, then the window goes away
        maybe_show_widget_as(&a, "pop");
        if to_tray {
            let _ = w.hide();
            let _ = w.set_position(pos);
            let _ = w.set_size(size);
        } else {
            #[cfg(windows)]
            match winfx::placement(w) {
                Some(mut p) => {
                    // minimized, but remembering the full-size spot to come back to
                    p.flags = 0;
                    p.show_cmd = winfx::SW_MINIMIZE;
                    p.normal = winfx::Rect { left: pos.x - dx, top: pos.y - dy, right: pos.x - dx + size.width as i32, bottom: pos.y - dy + size.height as i32 };
                    winfx::set_placement(w, &p);
                }
                None => { let _ = w.set_position(pos); let _ = w.set_size(size); let _ = w.minimize(); }
            }
            #[cfg(not(windows))]
            { let _ = w.set_position(pos); let _ = w.set_size(size); let _ = w.minimize(); }
        }
        DOCKING.store(false, Ordering::SeqCst);
        remember_mode(&a);
        main_memory(&a);
    });
    true
}

// ---------------- memory ----------------

/// While Resonance is hidden or minimized, ask WebView2 to use as little memory as it can
/// (it frees caches; music keeps playing). Back to normal when the window is shown again.
#[cfg(windows)]
fn set_memory_low(w: &WebviewWindow, low: bool) {
    let _ = w.with_webview(move |wv| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::*;
        use windows::core::Interface;
        if let Ok(core) = wv.controller().CoreWebView2() {
            if let Ok(c19) = core.cast::<ICoreWebView2_19>() {
                let _ = c19.SetMemoryUsageTargetLevel(if low { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW } else { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL });
            }
        }
    });
    let _ = w.eval(format!("window.__resHidden = {low}"));
}
#[cfg(not(windows))]
fn set_memory_low(w: &WebviewWindow, low: bool) {
    let _ = w.eval(format!("window.__resHidden = {low}"));
}
fn main_memory(app: &AppHandle) {
    if let Some(m) = main_window(app) {
        let away = !m.is_visible().unwrap_or(true) || m.is_minimized().unwrap_or(false);
        set_memory_low(&m, away);
    }
}

/// Create the taskbar player window (only while the feature is on).
fn ensure_widget(app: &AppHandle) -> bool {
    if app.get_webview_window("widget").is_some() {
        return true;
    }
    #[allow(unused_mut)]
    let mut b = WebviewWindowBuilder::new(app, "widget", WebviewUrl::App("widget.html".into()))
        .title("Resonance mini player")
        .disable_drag_drop_handler()
        .inner_size(520.0, 40.0)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .focused(false)
        .visible(false);
    #[cfg(windows)]
    {
        b = b.additional_browser_args(&browser_args(extras::smtc_enabled(app)));
    }
    match b.build() {
        Ok(_) => true,
        Err(e) => { log_line(&format!("taskbar mini player unavailable: {e}")); false }
    }
}

/// Create the song-change pop-up window (only while the feature is on).
fn ensure_overlay(app: &AppHandle) -> bool {
    if app.get_webview_window("overlay").is_some() {
        return true;
    }
    #[allow(unused_mut)]
    let mut b = WebviewWindowBuilder::new(app, "overlay", WebviewUrl::App("overlay.html".into()))
        .title("Resonance now playing")
        .disable_drag_drop_handler()
        .inner_size(360.0, 84.0)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .focused(false)
        .visible(false);
    #[cfg(windows)]
    {
        b = b.additional_browser_args(&browser_args(extras::smtc_enabled(app)));
    }
    match b.build() {
        Ok(_) => true,
        Err(e) => { log_line(&format!("song-change pop-up unavailable: {e}")); false }
    }
}

fn destroy_window(app: &AppHandle, label: &str) {
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.destroy();
    }
}

/// Song-change pop-up in a corner of the screen.
fn show_overlay(app: &AppHandle, data: serde_json::Value) {
    let Some(w) = app.get_webview_window("overlay") else { return };
    let st = app.state::<AppState>();
    let (corner, ms) = { let o = st.overlay.lock().unwrap(); (o.1.clone(), o.3) };
    let monitor = main_window(app)
        .filter(|m| m.is_visible().unwrap_or(false) && !m.is_minimized().unwrap_or(true))
        .and_then(|m| m.current_monitor().ok().flatten())
        .or_else(|| w.primary_monitor().ok().flatten());
    if let Some(m) = monitor {
        let scale = m.scale_factor();
        let wa = m.work_area();
        let (ww, wh) = ((360.0 * scale) as i32, (84.0 * scale) as i32);
        let margin = (16.0 * scale) as i32;
        let (l, t) = (wa.position.x, wa.position.y);
        let (r, b) = (l + wa.size.width as i32, t + wa.size.height as i32);
        let x = if corner.ends_with("left") { l + margin } else { r - ww - margin };
        let y = if corner.starts_with("top") { t + margin } else { b - wh - margin };
        let _ = w.set_size(PhysicalSize::new(ww as u32, wh as u32));
        let _ = w.set_position(PhysicalPosition::new(x, y));
    }
    let mut d = data;
    d["ms"] = serde_json::json!(ms);
    let _ = w.eval(format!("window.resOverlay && window.resOverlay({d})"));
    let _ = w.show();
    raise_topmost(&w);
}

/// Everything injected into every page at document start.
fn inject_script() -> String {
    format!(
        "window.__RES_PAGE_CSS__ = {};\nwindow.__RES_UI_CSS__ = {};\ntry {{\n{}\n}} catch (e) {{ console.error('[resonance] widget-render', e); }}\ntry {{\n{}\n}} catch (e) {{ console.error('[resonance] adblock', e); (window.__resErrors = window.__resErrors || []).push('adblock: ' + ((e && e.stack) || e)); }}\ntry {{\n{}\n}} catch (e) {{ console.error('[resonance] bridge', e); (window.__resErrors = window.__resErrors || []).push('bridge: ' + ((e && e.stack) || e)); }}\ntry {{\n{}\n}} catch (e) {{ console.error('[resonance] ui', e); (window.__resErrors = window.__resErrors || []).push('ui: ' + ((e && e.stack) || e)); }}\n",
        serde_json::to_string(include_str!("../inject/page.css")).unwrap(),
        serde_json::to_string(include_str!("../inject/ui.css")).unwrap(),
        include_str!("../../dist/widget-render.js"),
        include_str!("../inject/adblock.js"),
        include_str!("../inject/bridge.js"),
        include_str!("../inject/ui.js"),
    )
}

/// Put a window back on top of everything, including the taskbar, without focusing it.
#[cfg(windows)]
fn raise_topmost(w: &WebviewWindow) {
    #[link(name = "user32")]
    extern "system" {
        fn SetWindowPos(hwnd: *mut std::ffi::c_void, after: *mut std::ffi::c_void, x: i32, y: i32, cx: i32, cy: i32, flags: u32) -> i32;
    }
    const HWND_TOPMOST: isize = -1;
    // SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_ASYNCWINDOWPOS
    const FLAGS: u32 = 0x0001 | 0x0002 | 0x0010 | 0x0200 | 0x4000;
    if let Ok(h) = w.hwnd() {
        unsafe {
            SetWindowPos(h.0 as *mut std::ffi::c_void, HWND_TOPMOST as *mut std::ffi::c_void, 0, 0, 0, 0, FLAGS);
        }
    }
}

#[cfg(not(windows))]
fn raise_topmost(w: &WebviewWindow) {
    let _ = w.set_always_on_top(true);
}

/// Append a line to %TEMP%\resonance-log.txt (used for crash reports).
fn log_line(msg: &str) {
    use std::io::Write;
    let path = std::env::temp_dir().join("resonance-log.txt");
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "[{:?}] {msg}", std::time::SystemTime::now());
    }
}

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("main")
}

fn show_main(app: &AppHandle) {
    use std::sync::atomic::Ordering;
    let from = widget_rect(app, false).filter(|_| app.get_webview_window("widget").map(|w| w.is_visible().unwrap_or(false)).unwrap_or(false));
    hide_widget(app);
    if let Some(w) = main_window(app) {
        let hidden = !w.is_visible().unwrap_or(true);
        let minimized = w.is_minimized().unwrap_or(false);
        let docked = DOCKED.lock().unwrap().take();
        DOCKING.store(false, Ordering::SeqCst);
        match (docked, from) {
            (Some(d), Some(from)) if (hidden || minimized) && ANIMS.load(Ordering::SeqCst) => {
                // grow back out of the taskbar player
                let _ = w.eval("window.__resDock && window.__resDock(0)");
                if minimized {
                    #[cfg(windows)]
                    match winfx::placement(&w) {
                        Some(mut p) => {
                            p.flags = 0;
                            p.show_cmd = winfx::SW_RESTORE;
                            p.normal = winfx::Rect { left: from.0.x - d.dx, top: from.0.y - d.dy, right: from.0.x - d.dx + from.1.width as i32, bottom: from.0.y - d.dy + from.1.height as i32 };
                            winfx::set_placement(&w, &p);
                        }
                        None => { let _ = w.unminimize(); }
                    }
                    #[cfg(not(windows))]
                    { let _ = w.unminimize(); }
                } else {
                    let _ = w.set_position(from.0);
                    let _ = w.set_size(from.1);
                }
                let _ = w.show();
                let _ = w.set_focus();
                animate_window(&w, from, (d.pos, d.size), 260, move |w| {
                    restore_min_size(w, d.mini);
                    let _ = w.eval("window.__resAppear && window.__resAppear()");
                });
            }
            (d, _) => {
                if hidden || d.is_some() {
                    let _ = w.eval("window.__resAppear && window.__resAppear()"); // fades in (no Windows animation for this)
                }
                let _ = w.unminimize();
                if let Some(d) = d {
                    if hidden { let _ = w.set_position(d.pos); let _ = w.set_size(d.size); }
                    restore_min_size(&w, d.mini);
                }
                let _ = w.show();
                let _ = w.set_focus();
            }
        }
    }
    *app.state::<AppState>().main_ready.lock().unwrap() = true;
    remember_mode(app);
    main_memory(app);
}

// ---------------- taskbar mini player ----------------

/// Place the widget centered on the taskbar of the monitor the main window is on.
fn position_widget(app: &AppHandle, w: &WebviewWindow) {
    // A minimized window sits off-screen, so Windows may report the wrong monitor for it.
    // Prefer the main window's monitor only while it's on screen, then the widget's own, then the primary.
    let main = main_window(app);
    let main_on_screen = main.as_ref().map(|m| !m.is_minimized().unwrap_or(true) && m.is_visible().unwrap_or(false)).unwrap_or(false);
    let monitor = main
        .filter(|_| main_on_screen)
        .and_then(|m| m.current_monitor().ok().flatten())
        .or_else(|| if w.is_visible().unwrap_or(false) { w.current_monitor().ok().flatten() } else { None })
        .or_else(|| w.primary_monitor().ok().flatten());
    let Some(m) = monitor else { return };
    let scale = m.scale_factor();
    let (mx, my) = (m.position().x, m.position().y);
    let (mw, mh) = (m.size().width as i32, m.size().height as i32);
    let wa = m.work_area();
    let bottom_bar = (my + mh) - (wa.position.y + wa.size.height as i32);
    let top_bar = wa.position.y - my;
    let layout = app.state::<AppState>().widget_layout.lock().unwrap().clone();
    let lw = layout.get("width").and_then(|v| v.as_f64()).unwrap_or(520.0).clamp(100.0, 1000.0);
    let offset = layout.get("offset").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let align = layout.get("align").and_then(|v| v.as_str()).unwrap_or("center").to_string();
    let width = ((lw * scale) as i32).max(60);
    let pad = (5.0 * scale) as i32;
    let (h, y) = if bottom_bar > (20.0 * scale) as i32 {
        let h = bottom_bar - pad * 2;
        (h, my + mh - bottom_bar + pad)
    } else if top_bar > (20.0 * scale) as i32 {
        (top_bar - pad * 2, my + pad)
    } else {
        // taskbar on the side or auto-hidden: float just above the bottom edge
        let h = (40.0 * scale) as i32;
        (h, my + mh - h - (14.0 * scale) as i32)
    };
    let margin = (12.0 * scale) as i32;
    let x = match align.as_str() {
        "left" => mx + margin,
        "right" => mx + mw - width - margin,
        _ => mx + (mw - width) / 2,
    } + (offset * scale) as i32;
    let x = x.clamp(mx, mx + mw - width.min(mw));
    let h = h.max(24);

    // Bluetooth / audio bubble beside the player (left of it when the player sits on the right)
    let st = app.state::<AppState>();
    let bubble_l = *st.widget_bubble.lock().unwrap();
    let (panel_wl, panel_hl) = *st.widget_panel.lock().unwrap();
    let (bubble, gap) = if bubble_l > 0.0 { ((bubble_l * scale) as i32, (8.0 * scale) as i32) } else { (0, 0) };
    let side_left = align == "right";
    let mut win_x = if side_left { x - bubble - gap } else { x };
    let mut win_w = width + bubble + gap;
    let mut win_y = y;
    let mut win_h = h;
    let (panel_w, panel_h) = ((panel_wl * scale) as i32, (panel_hl * scale) as i32);
    if bubble > 0 && panel_h > 0 {
        // the panel opens above the bubble, growing toward the player
        if panel_w > win_w {
            if !side_left { win_x -= panel_w - win_w; }
            win_w = panel_w;
        }
        win_y = y - panel_h - (6.0 * scale) as i32;
        win_h = h + panel_h + (6.0 * scale) as i32;
    }
    win_x = win_x.clamp(mx, (mx + mw - win_w).max(mx));
    let _ = w.set_size(PhysicalSize::new(win_w as u32, win_h as u32));
    let _ = w.set_position(PhysicalPosition::new(win_x, win_y));
    // tell the page where the player, bubble and panel are (CSS px)
    let geom = serde_json::json!({
        "player": { "x": (x - win_x) as f64 / scale, "w": width as f64 / scale },
        "bubble": if bubble > 0 { serde_json::json!({ "x": (if side_left { x - bubble - gap } else { x + width + gap } - win_x) as f64 / scale, "w": bubble as f64 / scale }) } else { serde_json::Value::Null },
        "bar": h as f64 / scale,
        "panel": panel_h > 0 && bubble > 0,
        "side": if side_left { "left" } else { "right" },
    });
    let _ = w.eval(format!("window.resGeom && window.resGeom({geom})"));
}

fn reposition_widget(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("widget") {
        if w.is_visible().unwrap_or(false) {
            position_widget(app, &w);
        }
    }
}

fn push_widget_layout(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("widget") {
        let json = app.state::<AppState>().widget_layout.lock().unwrap().to_string();
        let _ = w.eval(format!("window.resLayout && window.resLayout({json})"));
        if w.is_visible().unwrap_or(false) {
            position_widget(app, &w);
        }
    }
}

fn push_widget_state(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("widget") {
        let json = app.state::<AppState>().now_playing.lock().unwrap().to_string();
        let _ = w.eval(format!("window.resUpdate && window.resUpdate({json})"));
    }
}

fn maybe_show_widget(app: &AppHandle) {
    maybe_show_widget_as(app, "rise");
}

/// `how`: "rise" (up into the taskbar) or "pop" (in place, when the window just shrank into it)
fn maybe_show_widget_as(app: &AppHandle, how: &str) {
    if !*app.state::<AppState>().widget_enabled.lock().unwrap() {
        return;
    }
    if let Some(w) = app.get_webview_window("widget") {
        let was_visible = w.is_visible().unwrap_or(false);
        WIDGET_GEN.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        position_widget(app, &w);
        push_widget_state(app);
        if !was_visible {
            let _ = w.eval(format!("window.resShow && window.resShow({how:?})")); // rises up into the taskbar
        }
        let _ = w.show();
        let _ = w.set_always_on_top(true);
        // Windows can ignore a position set before a window's first show and re-place it;
        // re-apply the taskbar position a few times right after it appears.
        let handle = app.clone();
        std::thread::spawn(move || {
            for ms in [60u64, 250, 700, 1500] {
                std::thread::sleep(Duration::from_millis(ms));
                if let Some(w) = handle.get_webview_window("widget") {
                    if w.is_visible().unwrap_or(false) {
                        position_widget(&handle, &w);
                    }
                }
            }
        });
    }
}

fn hide_widget(app: &AppHandle) {
    *app.state::<AppState>().widget_panel.lock().unwrap() = (0.0, 0.0);
    if let Some(w) = app.get_webview_window("widget") {
        if !w.is_visible().unwrap_or(false) {
            return;
        }
        let _ = w.eval("window.resPanel && window.resPanel(false); window.resHideAnim && window.resHideAnim()");
        // let it slide down first; skip if it was shown again meanwhile
        let gen = WIDGET_GEN.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(170));
            if WIDGET_GEN.load(std::sync::atomic::Ordering::SeqCst) == gen {
                let _ = w.hide();
            }
        });
    }
}

/// Hide the taskbar player once the main window has really stayed on screen for a moment
/// (window events fire in bursts while Windows minimizes / restores; reacting to each one made
/// the taskbar player flicker).
fn hide_widget_soon(app: &AppHandle) {
    let gen = WIDGET_GEN.load(std::sync::atomic::Ordering::SeqCst);
    let a = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(120));
        if WIDGET_GEN.load(std::sync::atomic::Ordering::SeqCst) != gen || DOCKED.lock().map(|d| d.is_some()).unwrap_or(false) {
            return;
        }
        if let Some(m) = main_window(&a) {
            if m.is_visible().unwrap_or(false) && !m.is_minimized().unwrap_or(true) {
                hide_widget(&a);
            }
        }
    });
}

/// Send a player command (toggle / next / prev / pause) into the page.
fn send_cmd(app: &AppHandle, cmd: &str) {
    if let Some(w) = main_window(app) {
        let _ = w.eval(format!("window.__res && window.__res.cmd({:?})", cmd));
    }
}

fn truncate(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        s.chars().take(n.saturating_sub(1)).collect::<String>() + "…"
    }
}

// ---------------- commands (called from the injected UI) ----------------

#[tauri::command]
fn res_win(window: WebviewWindow, action: String) -> Result<bool, String> {
    // "mini_on:instant" / "mini_off:instant": the same without the resize animation (animations off)
    let (action, instant) = match action.strip_suffix(":instant") { Some(a) => (a.to_string(), true), None => (action, false) };
    let r = match action.as_str() {
        "minimize" => {
            if !instant && dock(window.app_handle(), &window, false) { Ok(()) } else { window.minimize() }
        }
        "anim:on" | "anim:off" => {
            ANIMS.store(action == "anim:on", std::sync::atomic::Ordering::SeqCst);
            Ok(())
        }
        "toggle_max" => {
            if window.is_maximized().unwrap_or(false) {
                window.unmaximize()
            } else {
                window.maximize()
            }
        }
        "close" => window.close(),
        "drag" => window.start_dragging(),
        "ready" => {
            // the page has drawn Resonance's interface: show the window now (no black flash)
            let app = window.app_handle().clone();
            let st = app.state::<AppState>();
            let hidden = *st.boot_hidden.lock().unwrap();
            let first = !*st.main_ready.lock().unwrap();
            *st.main_ready.lock().unwrap() = true;
            if first && !hidden && !window.is_visible().unwrap_or(true) {
                let _ = window.show();
                let _ = window.set_focus();
            }
            // (unless the window was already brought up meanwhile, e.g. by starting Resonance again)
            if first && hidden && !window.is_visible().unwrap_or(false) {
                maybe_show_widget(&app);
            }
            remember_mode(&app);
            main_memory(&app);
            Ok(())
        }
        "hide" => {
            // back to the tray / taskbar player (after a global command)
            let r = window.hide();
            maybe_show_widget(window.app_handle());
            remember_mode(window.app_handle());
            set_memory_low(&window, true);
            r
        }
        "mini_on" => {
            // Never hold a lock while resizing: resizing fires window events that also read this
            // state, and waiting on our own lock froze the app.
            let st = window.state::<AppState>();
            let need_prev = st.mini_prev.lock().unwrap().is_none();
            if need_prev {
                let maxed = window.is_maximized().unwrap_or(false);
                let scale = window.scale_factor().unwrap_or(1.0);
                let booting = !*st.main_ready.lock().unwrap();
                let pos_size = (window.outer_position(), window.inner_size());
                let mut saved = None;
                if let (Ok(p), Ok(sz)) = pos_size {
                    if !booting && (sz.width as f64 / scale) > 520.0 {
                        // a normal window: remember it (also on disk, for the next start)
                        extras::save_pref(window.app_handle(), "winPrev", serde_json::json!({ "x": p.x, "y": p.y, "w": sz.width, "h": sz.height, "max": maxed }));
                        saved = Some((p, sz, maxed));
                    } else {
                        // started in mini mode: the window's last normal size comes from disk
                        let wp = extras::load_prefs(window.app_handle()).get("winPrev").cloned().unwrap_or_default();
                        let g = |k: &str| wp.get(k).and_then(|v| v.as_i64());
                        saved = Some(match (g("x"), g("y"), g("w"), g("h")) {
                            (Some(x), Some(y), Some(w), Some(h)) => (PhysicalPosition::new(x as i32, y as i32), PhysicalSize::new(w.max(800) as u32, h.max(500) as u32), wp.get("max").and_then(|v| v.as_bool()).unwrap_or(false)),
                            _ => (p, PhysicalSize::new((1320.0 * scale) as u32, (840.0 * scale) as u32), false),
                        });
                    }
                }
                *st.mini_prev.lock().unwrap() = saved;
                if maxed {
                    let _ = window.unmaximize();
                }
            }
            let _ = window.set_min_size(Some(tauri::LogicalSize::new(300.0, 120.0)));
            let _ = window.set_always_on_top(true);
            let scale = window.scale_factor().unwrap_or(1.0);
            let target = PhysicalSize::new((400.0 * scale) as u32, (152.0 * scale) as u32);
            let visible = window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false);
            match (visible && !instant, window.outer_position(), window.inner_size()) {
                (true, Ok(p), Ok(sz)) if sz.width > target.width => {
                    // shrink toward the window's top-right corner, where the mini player ends up
                    let to_pos = PhysicalPosition::new(p.x + sz.width as i32 - target.width as i32, p.y);
                    animate_window(&window, (p, sz), (to_pos, target), 220, |_| {});
                }
                _ => {
                    let _ = window.set_size(target);
                }
            }
            remember_mode(window.app_handle());
            Ok(())
        }
        "mini_off" => {
            let st = window.state::<AppState>();
            let prev = st.mini_prev.lock().unwrap().take();
            let _ = window.set_always_on_top(false);
            let scale = window.scale_factor().unwrap_or(1.0);
            let (to_pos, to_size, maxed) = match prev {
                Some((p, sz, maxed)) => (Some(p), sz, maxed),
                None => (None, PhysicalSize::new((1320.0 * scale) as u32, (840.0 * scale) as u32), false),
            };
            let finish = move |w: &WebviewWindow| {
                let _ = w.set_min_size(Some(tauri::LogicalSize::new(960.0, 620.0)));
                if let Some(p) = to_pos { let _ = w.set_position(p); }
                let _ = w.set_size(to_size);
                if maxed { let _ = w.maximize(); }
            };
            let visible = window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false);
            match (visible && !instant, window.outer_position(), window.inner_size()) {
                (true, Ok(p), Ok(sz)) => {
                    // grow from the mini player back to the normal window (min size applied at the end)
                    let dest = to_pos.unwrap_or(PhysicalPosition::new(p.x + sz.width as i32 - to_size.width as i32, p.y));
                    animate_window(&window, (p, sz), (dest, to_size), 240, finish);
                }
                _ => finish(&window),
            }
            remember_mode(window.app_handle());
            Ok(())
        }
        "fullscreen" => {
            let fs = window.is_fullscreen().unwrap_or(false);
            let _ = window.set_fullscreen(!fs);
            return Ok(!fs);
        }
        "fullscreen_off" => {
            let _ = window.set_fullscreen(false);
            return Ok(false);
        }
        z if z.starts_with("zoom:") => {
            // interface size (Settings → Appearance): scales the whole page, YouTube Music included
            let f = z[5..].parse::<f64>().unwrap_or(1.0).clamp(0.75, 1.5);
            window.set_zoom(f)
        }
        "devtools" => {
            window.open_devtools();
            Ok(())
        }
        _ => Ok(()),
    };
    r.map_err(|e| e.to_string())?;
    Ok(window.is_maximized().unwrap_or(false))
}

#[tauri::command]
fn res_set_close_to_tray(state: tauri::State<'_, AppState>, value: bool) {
    *state.close_to_tray.lock().unwrap() = value;
}

#[tauri::command]
fn res_player_state(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    playing: bool,
    title: String,
    artist: String,
    art: Option<String>,
    tint: Option<[u8; 3]>,
    time: Option<f64>,
    duration: Option<f64>,
    like: Option<String>,
    shuffle: Option<bool>,
    volume: Option<f64>,
) {
    extras::discord_update(&title, &artist, art.clone(), playing, time.unwrap_or(0.0), duration.unwrap_or(0.0));
    *state.now_playing.lock().unwrap() = serde_json::json!({
        "playing": playing, "title": title, "artist": artist, "art": art, "tint": tint,
        "time": time, "duration": duration, "like": like, "shuffle": shuffle, "volume": volume
    });
    // song-change pop-up
    if playing && !title.is_empty() {
        let key = format!("{title}\u{1}{artist}");
        let changed = { let mut k = state.last_play_key.lock().unwrap(); let c = *k != key; *k = key; c };
        let (on, always) = { let o = state.overlay.lock().unwrap(); (o.0, o.2) };
        let front = main_window(&app).map(|m| m.is_visible().unwrap_or(false) && !m.is_minimized().unwrap_or(true) && m.is_focused().unwrap_or(false)).unwrap_or(false);
        if changed && on && (always || !front) {
            show_overlay(&app, serde_json::json!({ "title": title, "artist": artist, "art": art, "tint": tint }));
        }
    }
    push_widget_state(&app);
    let label = if title.is_empty() {
        "Nothing playing".to_string()
    } else if artist.is_empty() {
        title.clone()
    } else {
        format!("{title} — {artist}")
    };
    if let Some(item) = state.now_item.lock().unwrap().as_ref() {
        let _ = item.set_text(truncate(&label, 48));
    }
    if let Some(item) = state.toggle_item.lock().unwrap().as_ref() {
        let _ = item.set_text(if playing { "Pause" } else { "Play" });
    }
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(truncate(&format!("Resonance\n{label}"), 120)));
    }
    if let Some(w) = main_window(&app) {
        let t = if title.is_empty() { "Resonance".to_string() } else { format!("{label} · Resonance") };
        let _ = w.set_title(&t);
    }
}

#[tauri::command]
fn res_set_widget(app: AppHandle, state: tauri::State<'_, AppState>, value: bool) {
    *state.widget_enabled.lock().unwrap() = value;
    sync_transitions(&app);
    if !value {
        destroy_window(&app, "widget");
    } else if app.get_webview_window("widget").is_none() {
        // build it off the command thread (creating a webview there can stall on Windows),
        // then show it if Resonance is already hidden
        let a = app.clone();
        std::thread::spawn(move || {
            if ensure_widget(&a) {
                let st = a.state::<AppState>();
                let started = *st.main_ready.lock().unwrap() || *st.boot_hidden.lock().unwrap();
                if let Some(m) = main_window(&a) {
                    if m.is_minimized().unwrap_or(false) || (!m.is_visible().unwrap_or(true) && started) {
                        maybe_show_widget(&a);
                    }
                }
            }
        });
    } else if let Some(m) = main_window(&app) {
        // e.g. started with Windows straight into the tray. While starting up the window is
        // hidden only until it's drawn — that doesn't count.
        let started = *state.main_ready.lock().unwrap() || *state.boot_hidden.lock().unwrap();
        if m.is_minimized().unwrap_or(false) || (!m.is_visible().unwrap_or(true) && started) {
            maybe_show_widget(&app);
        }
    }
    remember_mode(&app);
}

/// Buttons on the taskbar mini player.
#[tauri::command]
fn res_widget_cmd(app: AppHandle, cmd: String) {
    match cmd.as_str() {
        "toggle" | "next" | "prev" | "like" | "shuffle" | "volUp" | "volDown" => send_cmd(&app, &cmd),
        c if c.starts_with("seek:") => {
            if let Ok(f) = c[5..].parse::<f64>() {
                if let Some(w) = main_window(&app) {
                    let _ = w.eval(format!("window.__res && window.__res.cmd('seekPct', {})", f.clamp(0.0, 1.0)));
                }
            }
        }
        "show" => show_main(&app),
        "overlay:hide" => {
            if let Some(w) = app.get_webview_window("overlay") {
                let _ = w.hide();
            }
        }
        "sync" => {
            push_widget_layout(&app);
            push_widget_state(&app);
            if let Some(st) = app.state::<devices::Devices>().last.lock().unwrap().clone() {
                if let Some(w) = app.get_webview_window("widget") {
                    let _ = w.eval(format!("window.resDev && window.resDev({})", serde_json::to_string(&st).unwrap_or_default()));
                }
            }
        }
        c if c.starts_with("bubble:") => {
            let v = c[7..].parse::<f64>().unwrap_or(0.0).clamp(0.0, 200.0);
            let st = app.state::<AppState>();
            let changed = (*st.widget_bubble.lock().unwrap() - v).abs() > 0.5;
            *st.widget_bubble.lock().unwrap() = v;
            if v == 0.0 { *st.widget_panel.lock().unwrap() = (0.0, 0.0); }
            if changed { reposition_widget(&app); }
        }
        c if c.starts_with("panel:") => {
            // "panel:<w>x<h>" in CSS px, or "panel:0" to close
            let mut it = c[6..].split('x');
            let pw = it.next().and_then(|v| v.parse::<f64>().ok()).unwrap_or(0.0).clamp(0.0, 600.0);
            let ph = it.next().and_then(|v| v.parse::<f64>().ok()).unwrap_or(0.0).clamp(0.0, 600.0);
            *app.state::<AppState>().widget_panel.lock().unwrap() = (pw, ph);
            reposition_widget(&app);
        }
        c => {
            devices::widget_cmd(&app, c);
        }
    }
}

#[tauri::command]
fn res_set_overlay(app: AppHandle, state: tauri::State<'_, AppState>, enabled: bool, corner: String, always: bool, ms: Option<u64>) {
    let c = if ["top-left", "top-right", "bottom-left", "bottom-right"].contains(&corner.as_str()) { corner } else { "bottom-right".into() };
    *state.overlay.lock().unwrap() = (enabled, c, always, ms.unwrap_or(5000).clamp(2000, 15000));
    if enabled {
        let a = app.clone();
        std::thread::spawn(move || { ensure_overlay(&a); });
    } else {
        destroy_window(&app, "overlay");
    }
}

#[tauri::command]
fn res_set_widget_layout(app: AppHandle, state: tauri::State<'_, AppState>, layout: serde_json::Value) {
    *state.widget_layout.lock().unwrap() = layout;
    push_widget_layout(&app);
}

static COLOR_CACHE: Mutex<Vec<(String, [u8; 3])>> = Mutex::new(Vec::new());

#[tauri::command]
async fn res_dominant_color(url: String) -> Option<[u8; 3]> {
    if !url.starts_with("https://") {
        return None;
    }
    if let Some((_, c)) = COLOR_CACHE.lock().unwrap().iter().find(|(u, _)| *u == url) {
        return Some(*c);
    }
    let key = url.clone();
    let c = tauri::async_runtime::spawn_blocking(move || dominant_color(&url)).await.ok().flatten()?;
    let mut cache = COLOR_CACHE.lock().unwrap();
    cache.push((key, c));
    if cache.len() > 200 {
        cache.remove(0);
    }
    Some(c)
}

/// Vivid "average" color of cover art, normalised so it always makes a rich tint.
fn dominant_color(url: &str) -> Option<[u8; 3]> {
    let resp = ureq::get(url).timeout(Duration::from_secs(8)).call().ok()?;
    let mut bytes = Vec::new();
    resp.into_reader().take(8_000_000).read_to_end(&mut bytes).ok()?;
    let img = image::load_from_memory(&bytes).ok()?.thumbnail(16, 16).to_rgb8();
    let (mut r, mut g, mut b, mut wsum) = (0f64, 0f64, 0f64, 0f64);
    for p in img.pixels() {
        let (rr, gg, bb) = (p[0] as f64, p[1] as f64, p[2] as f64);
        let max = rr.max(gg).max(bb);
        let min = rr.min(gg).min(bb);
        let sat = if max == 0.0 { 0.0 } else { (max - min) / max };
        let lum = (max + min) / 510.0;
        let w = 0.05 + sat * sat * (1.0 - (lum - 0.5).abs() * 1.4).max(0.0);
        r += rr * w;
        g += gg * w;
        b += bb * w;
        wsum += w;
    }
    if wsum <= 0.0 {
        return None;
    }
    let rgb = [r / wsum, g / wsum, b / wsum];
    let mx = rgb.iter().cloned().fold(1.0, f64::max);
    let k = 190.0 / mx;
    Some([
        (rgb[0] * k).min(255.0) as u8,
        (rgb[1] * k).min(255.0) as u8,
        (rgb[2] * k).min(255.0) as u8,
    ])
}

#[tauri::command]
async fn res_sign_out(window: WebviewWindow) -> Result<(), String> {
    window.clear_all_browsing_data().map_err(|e| e.to_string())?;
    window.navigate(YTM.parse().unwrap()).map_err(|e| e.to_string())?;
    Ok(())
}

// ---------------- app ----------------

fn main() {
    std::panic::set_hook(Box::new(|info| log_line(&format!("CRASH: {info}"))));
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--minimized"])))
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE & !StateFlags::DECORATIONS & !StateFlags::FULLSCREEN)
                // the taskbar player is always placed fresh on the taskbar, never restored
                .with_denylist(&["widget"])
                .build(),
        )
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    if let Some(action) = extras::hotkey_action(shortcut.id()) {
                        match action.as_str() {
                            "show" => {
                                if let Some(w) = main_window(app) {
                                    if w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false) && !w.is_minimized().unwrap_or(false) {
                                        let _ = w.minimize();
                                    } else {
                                        show_main(app);
                                    }
                                }
                            }
                            a @ ("toggle" | "next" | "prev" | "like" | "volUp" | "volDown" | "shuffle" | "mute") => send_cmd(app, a),
                            "palette" => {
                                // pop Resonance up with the command box; it goes back afterwards
                                if let Some(w) = main_window(app) {
                                    let prev = if !w.is_visible().unwrap_or(true) { "hidden" } else if w.is_minimized().unwrap_or(false) { "minimized" } else if w.is_focused().unwrap_or(false) { "front" } else { "back" };
                                    show_main(app);
                                    let _ = w.eval(format!("window.__resPalette && window.__resPalette('{prev}')"));
                                }
                            }
                            _ => {}
                        }
                        return;
                    }
                    match shortcut.key {
                        Code::MediaPlayPause => send_cmd(app, "toggle"),
                        Code::MediaTrackNext => send_cmd(app, "next"),
                        Code::MediaTrackPrevious => send_cmd(app, "prev"),
                        Code::MediaStop => send_cmd(app, "pause"),
                        _ => {}
                    }
                })
                .build(),
        )
        .manage(AppState {
            now_playing: Mutex::new(serde_json::json!({})),
            widget_layout: Mutex::new(serde_json::json!({})),
            ..Default::default()
        })
        .manage(devices::Devices::new())
        .manage(remote::Remote::default())
        .invoke_handler(tauri::generate_handler![
            res_win,
            res_player_state,
            res_set_close_to_tray,
            res_dominant_color,
            res_sign_out,
            res_set_widget,
            res_widget_cmd,
            res_set_widget_layout,
            extras::res_set_pref,
            extras::res_get_prefs,
            extras::res_check_update,
            extras::res_install_update,
            extras::res_open_url,
            extras::res_lyrics,
            extras::res_discord,
            extras::res_set_hotkeys,
            extras::res_autostart,
            extras::res_notify,
            extras::res_translate,
            extras::res_read_log,
            extras::res_release_notes,
            res_set_overlay,
            remote::res_remote,
            devices::res_devices,
            devices::res_bt_power,
            devices::res_set_output
        ])
        .setup(|app| {
            // ----- main window: YouTube Music + injected Resonance UI -----
            #[allow(unused_mut)]
            let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(YTM.parse().unwrap()))
                .title("Resonance")
                .inner_size(1320.0, 840.0)
                .min_inner_size(960.0, 620.0)
                .decorations(false)
                .shadow(true)
                .background_color(tauri::window::Color(8, 8, 11, 255))
                .initialization_script(&inject_script())
                // Tauri's file-drop handling blocks normal drag & drop in the page (playlist reordering, editor)
                .disable_drag_drop_handler()
                // hidden until the page says it has drawn the interface (no black flash at start)
                .visible(false)
                .on_navigation(|url| matches!(url.scheme(), "https" | "about" | "data" | "blob"));
            #[cfg(windows)]
            {
                builder = builder.additional_browser_args(&browser_args(extras::smtc_enabled(app.handle())));
            }
            let main = builder.build()?;
            // started with Windows, or last closed while in taskbar-player mode: stay hidden
            // (the taskbar player shows once the page has loaded)
            let last_mode = extras::load_prefs(app.handle()).get("lastMode").and_then(|v| v.as_str()).unwrap_or("windowed").to_string();
            let hidden = extras::start_minimized(app.handle()) || last_mode == "taskbar";
            {
                let st = app.state::<AppState>();
                *st.boot_hidden.lock().unwrap() = hidden;
                *st.last_mode.lock().unwrap() = last_mode;
            }
            // safety net: show the window even if the page never reports in
            let handle = app.handle().clone();
            let main_h = main.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(6));
                let st = handle.state::<AppState>();
                if !*st.main_ready.lock().unwrap() {
                    *st.main_ready.lock().unwrap() = true;
                    if !*st.boot_hidden.lock().unwrap() {
                        let _ = main_h.show();
                        let _ = main_h.set_focus();
                    } else if !main_h.is_visible().unwrap_or(false) {
                        maybe_show_widget(&handle);
                    }
                }
            });

            // The taskbar player and the song-change pop-up are created only when they're switched on
            // (each one is a small web page that costs memory) — see ensure_widget / ensure_overlay.
            // Clicking the taskbar (or opening an app from it) puts the taskbar above us.
            // Re-raise the mini player to the top of the "always on top" layer while it's visible.
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_millis(350));
                if let Some(w) = handle.get_webview_window("widget") {
                    if w.is_visible().unwrap_or(false) {
                        raise_topmost(&w);
                    }
                }
            });

            // ----- tray -----
            let now = MenuItem::with_id(app, "now", "Nothing playing", false, None::<&str>)?;
            let toggle = MenuItem::with_id(app, "toggle", "Play", true, None::<&str>)?;
            let next = MenuItem::with_id(app, "next", "Next", true, None::<&str>)?;
            let prev = MenuItem::with_id(app, "prev", "Previous", true, None::<&str>)?;
            let show = MenuItem::with_id(app, "show", "Show Resonance", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[
                    &now,
                    &PredefinedMenuItem::separator(app)?,
                    &toggle,
                    &next,
                    &prev,
                    &PredefinedMenuItem::separator(app)?,
                    &show,
                    &quit,
                ],
            )?;
            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().cloned().expect("app icon"))
                .tooltip("Resonance")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, e| match e.id.as_ref() {
                    "toggle" => send_cmd(app, "toggle"),
                    "next" => send_cmd(app, "next"),
                    "prev" => send_cmd(app, "prev"),
                    "show" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, e| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;
            let st = app.state::<AppState>();
            *st.now_item.lock().unwrap() = Some(now);
            *st.toggle_item.lock().unwrap() = Some(toggle);

            // ----- media keys (ignore failures if another app already owns them) -----
            register_media_keys(app.handle());
            // ----- Bluetooth / audio output watcher (idle until the UI turns it on) -----
            devices::start(app.handle());
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            let app = window.app_handle();
            match event {
                WindowEvent::CloseRequested { api, .. } => {
                    let st = window.state::<AppState>();
                    if *st.close_to_tray.lock().unwrap() {
                        api.prevent_close();
                        if let Some(m) = main_window(app) {
                            if dock(app, &m, true) {
                                return; // shrinks into the taskbar player, then hides
                            }
                        }
                        // minimize first so Windows plays its "into the taskbar" animation, then hide
                        let _ = window.minimize();
                        let w2 = window.clone();
                        let a2 = app.clone();
                        std::thread::spawn(move || {
                            std::thread::sleep(Duration::from_millis(260));
                            if w2.is_minimized().unwrap_or(false) {
                                let _ = w2.hide();
                            }
                            maybe_show_widget(&a2);
                            remember_mode(&a2);
                            main_memory(&a2);
                        });
                    }
                    remember_mode(app);
                    main_memory(app);
                }
                WindowEvent::Resized(_) => {
                    if window.is_minimized().unwrap_or(false) {
                        maybe_show_widget(app);
                    } else if window.is_visible().unwrap_or(false) {
                        // brought back from the taskbar icon after gliding into the taskbar player
                        let back = {
                            let mut d = DOCKED.lock().unwrap();
                            if d.is_some() && !DOCKING.load(std::sync::atomic::Ordering::SeqCst) { d.take() } else { None }
                        };
                        if let Some(d) = back {
                            if let Some(m) = main_window(app) {
                                restore_min_size(&m, d.mini);
                                let _ = m.eval("window.__resAppear && window.__resAppear()");
                            }
                        }
                        hide_widget_soon(app);
                    }
                    remember_mode(app);
                    main_memory(app);
                }
                WindowEvent::Focused(true) => { hide_widget(app); main_memory(app); }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            log_line(&format!("startup error: {e}"));
            std::process::exit(1);
        });
}
