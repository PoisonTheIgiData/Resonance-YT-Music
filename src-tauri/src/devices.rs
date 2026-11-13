//! Bluetooth + audio output support (Windows only).
//!
//! * Bluetooth radio state (on / off / no Bluetooth on this PC) – Windows.Devices.Radios
//! * Connected Bluetooth devices and their battery level – Windows.Devices.Bluetooth +
//!   the "battery level" device property Windows itself shows in Settings
//! * Audio outputs (speakers, headphones…) and switching the default one – Core Audio
//!
//! Everything runs on one background thread, so the UI never waits on Windows. The thread
//! refreshes every few seconds while the feature is on and pushes the result to the main
//! window (`window.__resDev`) and to the taskbar player (`resDev`).

use serde::Serialize;
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Clone, PartialEq, Default, Debug)]
pub struct BtDevice {
    pub name: String,
    pub battery: Option<u8>,
    /// "audio" | "input" | "phone" | "other"
    pub kind: String,
}

#[derive(Serialize, Clone, PartialEq, Default, Debug)]
pub struct Output {
    pub id: String,
    pub name: String,
    pub default: bool,
    pub bt: bool,
}

#[derive(Serialize, Clone, PartialEq, Default, Debug)]
pub struct DevState {
    /// "none" (no Bluetooth on this PC) | "off" | "on"
    pub bt: String,
    pub devices: Vec<BtDevice>,
    pub outputs: Vec<Output>,
    /// A one-off message for the UI (e.g. Windows refused to turn Bluetooth on)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub enum Msg {
    Enable(bool),
    Refresh,
    BtPower(bool),
    SetOutput(String),
}

pub struct Devices {
    tx: Mutex<Option<Sender<Msg>>>,
    pub last: Mutex<Option<DevState>>,
}

impl Devices {
    pub fn new() -> Self {
        Devices { tx: Mutex::new(None), last: Mutex::new(None) }
    }
    pub fn send(&self, m: Msg) {
        if let Some(tx) = self.tx.lock().unwrap().as_ref() {
            let _ = tx.send(m);
        }
    }
}

fn push(app: &AppHandle, st: &DevState) {
    let json = serde_json::to_string(st).unwrap_or_else(|_| "null".into());
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.eval(&format!("window.__resDev && window.__resDev({json})"));
    }
    if let Some(w) = app.get_webview_window("widget") {
        let _ = w.eval(&format!("window.resDev && window.resDev({json})"));
    }
}

fn push_null(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.eval("window.__resDev && window.__resDev(null)");
    }
    if let Some(w) = app.get_webview_window("widget") {
        let _ = w.eval("window.resDev && window.resDev(null)");
    }
}

pub fn start(app: &AppHandle) {
    let (tx, rx) = channel::<Msg>();
    *app.state::<Devices>().tx.lock().unwrap() = Some(tx);
    let app = app.clone();
    std::thread::spawn(move || {
        imp::init_thread();
        let mut enabled = false;
        let mut last: Option<DevState> = None;
        loop {
            let wait = if enabled { Duration::from_secs(8) } else { Duration::from_secs(3600) };
            let mut error = None;
            let mut force = false;
            match rx.recv_timeout(wait) {
                Ok(Msg::Enable(v)) => {
                    enabled = v;
                    force = true;
                    if !v {
                        last = None;
                        *app.state::<Devices>().last.lock().unwrap() = None;
                        push_null(&app);
                        continue;
                    }
                }
                Ok(Msg::Refresh) => force = true,
                Ok(Msg::BtPower(on)) => {
                    if let Err(e) = imp::set_bt(on) { error = Some(e); }
                    // the radio needs a moment before devices reconnect
                    std::thread::sleep(Duration::from_millis(700));
                    force = true;
                }
                Ok(Msg::SetOutput(id)) => {
                    if let Err(e) = imp::set_output(&id) { error = Some(e); }
                    force = true;
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
            if !enabled { continue; }
            let mut st = imp::query();
            let changed = last.as_ref() != Some(&st);
            last = Some(st.clone());
            *app.state::<Devices>().last.lock().unwrap() = Some(st.clone());
            if error.is_some() { st.error = error; }
            if changed || force || st.error.is_some() { push(&app, &st); }
        }
    });
}

// ---------------------------------------------------------------- commands

/// Turns the device watcher on/off (the "Bluetooth & audio output" setting).
#[tauri::command]
pub fn res_devices(app: AppHandle, enabled: Option<bool>) -> Option<DevState> {
    let d = app.state::<Devices>();
    match enabled {
        Some(v) => d.send(Msg::Enable(v)),
        None => d.send(Msg::Refresh),
    }
    let last = d.last.lock().unwrap().clone();
    last
}

#[tauri::command]
pub fn res_bt_power(app: AppHandle, on: bool) {
    app.state::<Devices>().send(Msg::BtPower(on));
}

#[tauri::command]
pub fn res_set_output(app: AppHandle, id: String) {
    app.state::<Devices>().send(Msg::SetOutput(id));
}

/// Commands coming from the taskbar player (it may only call res_widget_cmd).
pub fn widget_cmd(app: &AppHandle, cmd: &str) -> bool {
    let d = app.state::<Devices>();
    if cmd == "dev:refresh" { d.send(Msg::Refresh); return true; }
    if cmd == "bt:on" { d.send(Msg::BtPower(true)); return true; }
    if cmd == "bt:off" { d.send(Msg::BtPower(false)); return true; }
    if let Some(id) = cmd.strip_prefix("out:") { d.send(Msg::SetOutput(id.to_string())); return true; }
    false
}

// ---------------------------------------------------------------- Windows

#[cfg(windows)]
mod imp {
    use super::{BtDevice, DevState, Output};
    use std::collections::HashMap;
    use windows::core::{Interface, GUID, HSTRING, PCWSTR};
    use windows::Devices::Bluetooth::{BluetoothConnectionStatus, BluetoothDevice, BluetoothLEDevice, BluetoothMajorClass};
    use windows::Devices::Enumeration::DeviceInformation;
    use windows::Devices::Radios::{Radio, RadioAccessStatus, RadioKind, RadioState};
    use windows::Win32::Devices::DeviceAndDriverInstallation::*;
    use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
    use windows::Win32::Devices::Properties::DEVPROPTYPE;
    use windows::Win32::Foundation::{DEVPROPKEY, PROPERTYKEY};
    use windows::Win32::Media::Audio::*;
    use windows::Win32::System::Com::StructuredStorage::PropVariantToStringAlloc;
    use windows::Win32::System::Com::*;

    static KINDS: std::sync::LazyLock<std::sync::Mutex<HashMap<String, String>>> = std::sync::LazyLock::new(|| std::sync::Mutex::new(HashMap::new()));

    pub fn init_thread() {
        unsafe { let _ = CoInitializeEx(None, COINIT_MULTITHREADED); }
    }

    fn bt_radio() -> Option<Radio> {
        let radios = Radio::GetRadiosAsync().ok()?.join().ok()?;
        for i in 0..radios.Size().unwrap_or(0) {
            if let Ok(r) = radios.GetAt(i) {
                if r.Kind().ok() == Some(RadioKind::Bluetooth) { return Some(r); }
            }
        }
        None
    }

    pub fn set_bt(on: bool) -> Result<(), String> {
        let r = bt_radio().ok_or("This PC has no Bluetooth")?;
        let access = Radio::RequestAccessAsync().and_then(|a| a.join()).map_err(|e| e.message().to_string())?;
        if access != RadioAccessStatus::Allowed {
            return Err("Windows didn't allow it. Turn on Settings → Privacy & security → Radios → \"Let apps control device radios\".".into());
        }
        let res = r.SetStateAsync(if on { RadioState::On } else { RadioState::Off })
            .and_then(|a| a.join()).map_err(|e| e.message().to_string())?;
        if res != RadioAccessStatus::Allowed { return Err("Windows didn't allow changing Bluetooth.".into()); }
        Ok(())
    }

    /// "Bluetooth#Bluetooth00:1a:7d:da:71:13-a0:b1:c2:d3:e4:f5" → "A0B1C2D3E4F5"
    fn mac_from_id(id: &str) -> Option<String> {
        let tail = id.rsplit('-').next()?;
        let mac: String = tail.chars().filter(|c| c.is_ascii_hexdigit()).collect::<String>().to_uppercase();
        if mac.len() == 12 { Some(mac) } else { None }
    }

    /// Battery levels Windows knows about, keyed by the device's MAC address.
    fn batteries(macs: &[String]) -> HashMap<String, u8> {
        // DEVPKEY_Bluetooth_Battery – what Settings › Bluetooth & devices shows
        const BATTERY: DEVPROPKEY = DEVPROPKEY { fmtid: GUID::from_u128(0x104ea319_6ee2_4701_bd47_8ddbf425bbe5), pid: 2 };
        let mut out = HashMap::new();
        if macs.is_empty() { return out; }
        unsafe {
            let set = match SetupDiGetClassDevsW(None, PCWSTR::null(), None, DIGCF_ALLCLASSES | DIGCF_PRESENT) { Ok(s) => s, Err(_) => return out };
            let mut i = 0u32;
            loop {
                let mut info = SP_DEVINFO_DATA { cbSize: std::mem::size_of::<SP_DEVINFO_DATA>() as u32, ..Default::default() };
                if SetupDiEnumDeviceInfo(set, i, &mut info).is_err() { break; }
                i += 1;
                let mut buf = [0u16; 512];
                if SetupDiGetDeviceInstanceIdW(set, &info, Some(&mut buf), None).is_err() { continue; }
                let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
                let iid = String::from_utf16_lossy(&buf[..len]).to_uppercase();
                if !iid.starts_with("BTH") { continue; }
                let Some(mac) = macs.iter().find(|m| iid.contains(m.as_str())) else { continue };
                let mut ty = DEVPROPTYPE::default();
                let mut val = [0u8; 4];
                if SetupDiGetDevicePropertyW(set, &info, &BATTERY, &mut ty, Some(&mut val), None, 0).is_ok() {
                    let v = val[0].min(100);
                    out.entry(mac.clone()).and_modify(|e: &mut u8| *e = (*e).min(v)).or_insert(v);
                }
            }
            let _ = SetupDiDestroyDeviceInfoList(set);
        }
        out
    }

    fn connected() -> Vec<(String, String, String)> {
        // (mac, name, kind)
        let mut list: Vec<(String, String, String)> = Vec::new();
        let sels = [
            BluetoothDevice::GetDeviceSelectorFromConnectionStatus(BluetoothConnectionStatus::Connected).ok().map(|s| (s, false)),
            BluetoothLEDevice::GetDeviceSelectorFromConnectionStatus(BluetoothConnectionStatus::Connected).ok().map(|s| (s, true)),
        ];
        for (sel, le) in sels.into_iter().flatten() {
            let Ok(found) = DeviceInformation::FindAllAsyncAqsFilter(&sel).and_then(|a| a.join()) else { continue };
            for i in 0..found.Size().unwrap_or(0) {
                let Ok(d) = found.GetAt(i) else { continue };
                let id = d.Id().map(|s| s.to_string()).unwrap_or_default();
                let name = d.Name().map(|s| s.to_string()).unwrap_or_default();
                let Some(mac) = mac_from_id(&id) else { continue };
                if list.iter().any(|(m, _, _)| *m == mac) { continue; }
                // a device's kind never changes: look it up once, not on every check
                if let Some(k) = KINDS.lock().unwrap().get(&mac).cloned() { list.push((mac, name, k)); continue; }
                let hid = HSTRING::from(id.as_str());
                let kind = if !le {
                    BluetoothDevice::FromIdAsync(&hid).and_then(|a| a.join()).and_then(|b| b.ClassOfDevice()).and_then(|c| c.MajorClass())
                        .map(|m| match m {
                            BluetoothMajorClass::AudioVideo => "audio",
                            BluetoothMajorClass::Peripheral => "input",
                            BluetoothMajorClass::Phone => "phone",
                            _ => "other",
                        }).unwrap_or("other")
                } else {
                    // LE appearance category 0x0F = keyboard / mouse / gamepad
                    BluetoothLEDevice::FromIdAsync(&hid).and_then(|a| a.join()).and_then(|b| b.Appearance()).and_then(|a| a.Category())
                        .map(|c| if c == 0x0F { "input" } else { "other" }).unwrap_or("other")
                };
                KINDS.lock().unwrap().insert(mac.clone(), kind.to_string());
                list.push((mac, name, kind.to_string()));
            }
        }
        list
    }

    fn pwstr_to_string(p: windows::core::PWSTR) -> String {
        if p.is_null() { return String::new(); }
        let s = unsafe { p.to_string().unwrap_or_default() };
        unsafe { CoTaskMemFree(Some(p.0 as *const _)) };
        s
    }

    // PKEY_Device_EnumeratorName on an endpoint: "BTHENUM" / "BTHHFENUM" / "BTHLEDEVICE" for Bluetooth
    const ENUM_NAME: PROPERTYKEY = PROPERTYKEY { fmtid: GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0), pid: 24 };

    fn outputs(bt_names: &[String]) -> Vec<Output> {
        let mut out = Vec::new();
        unsafe {
            let Ok(en) = CoCreateInstance::<_, IMMDeviceEnumerator>(&MMDeviceEnumerator, None, CLSCTX_ALL) else { return out };
            let def = en.GetDefaultAudioEndpoint(eRender, eMultimedia).and_then(|d| d.GetId()).map(pwstr_to_string).unwrap_or_default();
            let Ok(col) = en.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE) else { return out };
            for i in 0..col.GetCount().unwrap_or(0) {
                let Ok(dev) = col.Item(i) else { continue };
                let id = dev.GetId().map(pwstr_to_string).unwrap_or_default();
                let mut name = String::new();
                let mut bt = false;
                if let Ok(store) = dev.OpenPropertyStore(STGM_READ) {
                    if let Ok(v) = store.GetValue(&PKEY_Device_FriendlyName) {
                        name = PropVariantToStringAlloc(&v).map(pwstr_to_string).unwrap_or_default();
                    }
                    if let Ok(v) = store.GetValue(&ENUM_NAME) {
                        let e = PropVariantToStringAlloc(&v).map(pwstr_to_string).unwrap_or_default();
                        bt = e.to_uppercase().starts_with("BTH");
                    }
                }
                if !bt { bt = bt_names.iter().any(|n| !n.is_empty() && name.contains(n.as_str())); }
                out.push(Output { default: id == def, id, name, bt });
            }
        }
        out
    }

    pub fn set_output(id: &str) -> Result<(), String> {
        // IPolicyConfig – the interface Windows' own sound settings use to change the default
        // device (undocumented, but stable since Windows 7; EarTrumpet & co. use it too).
        const CLSID_POLICY: GUID = GUID::from_u128(0x870af99c_171d_4f9e_af0d_e63df40c2bc9);
        const IID_POLICY: GUID = GUID::from_u128(0xf8679f50_850a_41cf_9c72_430f290290c8);
        type SetDefault = unsafe extern "system" fn(*mut core::ffi::c_void, PCWSTR, ERole) -> windows::core::HRESULT;
        unsafe {
            let unk: windows::core::IUnknown = CoCreateInstance(&CLSID_POLICY, None, CLSCTX_ALL).map_err(|e| e.message().to_string())?;
            let mut p: *mut core::ffi::c_void = std::ptr::null_mut();
            unk.query(&IID_POLICY, &mut p).ok().map_err(|e| e.message().to_string())?;
            if p.is_null() { return Err("Couldn't change the audio output".into()); }
            let vtbl = *(p as *const *const usize);
            let set: SetDefault = std::mem::transmute(*vtbl.add(13)); // IUnknown(3) + 10
            let wide: Vec<u16> = id.encode_utf16().chain(std::iter::once(0)).collect();
            let mut hr = windows::core::HRESULT(0);
            for role in [eConsole, eMultimedia, eCommunications] {
                let r = set(p, PCWSTR(wide.as_ptr()), role);
                if r.is_err() { hr = r; }
            }
            let release: unsafe extern "system" fn(*mut core::ffi::c_void) -> u32 = std::mem::transmute(*vtbl.add(2));
            release(p);
            hr.ok().map_err(|e| e.message().to_string())
        }
    }

    pub fn query() -> DevState {
        let radio = bt_radio();
        let bt = match &radio {
            None => "none",
            Some(r) => if r.State().ok() == Some(RadioState::On) { "on" } else { "off" },
        };
        let mut devices = Vec::new();
        if bt == "on" {
            let list = connected();
            let macs: Vec<String> = list.iter().map(|(m, _, _)| m.clone()).collect();
            let bats = batteries(&macs);
            for (mac, name, kind) in list {
                devices.push(BtDevice { battery: bats.get(&mac).copied(), name, kind });
            }
            // audio first, then devices with a battery level
            devices.sort_by_key(|d| (d.kind != "audio", d.battery.is_none()));
        }
        let names: Vec<String> = devices.iter().map(|d| d.name.clone()).collect();
        DevState { bt: bt.into(), devices, outputs: outputs(&names), error: None }
    }
}

#[cfg(not(windows))]
mod imp {
    use super::DevState;
    pub fn init_thread() {}
    pub fn set_bt(_on: bool) -> Result<(), String> { Err("Bluetooth control is only available on Windows".into()) }
    pub fn set_output(_id: &str) -> Result<(), String> { Err("Only available on Windows".into()) }
    pub fn query() -> DevState { DevState { bt: "none".into(), ..Default::default() } }
}
