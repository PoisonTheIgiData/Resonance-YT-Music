# Resonance

**A desktop player for YouTube Music on Windows: a Spotify-style app built on Tauri 2 and Windows' built-in WebView2.**

Resonance opens the real YouTube Music website (music.youtube.com) and wraps it in its own interface: a sidebar,
player bar, now-playing panel, lyrics, a taskbar player, a mini player and much more. Your library, playlists,
likes and recommendations are YouTube Music's own, because you sign in with your normal Google account.

> Resonance is an independent project and is **not affiliated with Google, YouTube or Discord**.
> Your password is only ever typed on Google's own sign-in page and is never stored by Resonance.

---

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Building and installing](#building-and-installing)
- [First start](#first-start)
- [Ways to use Resonance](#ways-to-use-resonance)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Command box](#command-box)
- [Right-click menus](#right-click-menus)
- [Settings, tab by tab](#settings-tab-by-tab)
- [Phone remote](#phone-remote)
- [Bluetooth and audio output](#bluetooth-and-audio-output)
- [Lyrics](#lyrics)
- [Sound: equalizer, crossfade, leveling, visualizer](#sound-equalizer-crossfade-leveling-visualizer)
- [Taskbar player and layouts](#taskbar-player-and-layouts)
- [Themes](#themes)
- [Updates and releases](#updates-and-releases)
- [Code signing](#code-signing-optional)
- [Discord status](#discord-status-optional)
- [Privacy: what Resonance connects to and stores](#privacy-what-resonance-connects-to-and-stores)
- [Memory and performance](#memory-and-performance)
- [Troubleshooting](#troubleshooting)
- [Project structure](#project-structure)
- [How it works (for developers)](#how-it-works-for-developers)
- [Known limitations](#known-limitations)
- [Credits](#credits)

---

## Features

**Player**
- Spotify-style layout: collapsible sidebar with your playlists, player bar, now-playing panel with *Up next* and *Lyrics*
- Your playlists from YouTube Music with cover art; pin playlists, put them in folders, drag to reorder
- Queue with drag-to-reorder, right-click actions and **Save queue as playlist**
- Cover / Video switch, pop-out video (picture in picture), full player, full-screen view (F11)
- Continue the last song (or playlist) where you left off after a restart
- Shuffle that really shuffles, sleep timer with fade-out, skip intro/outro points per song
- Built-in ad blocker

**Windows integration**
- **Taskbar player**: play controls sitting on the taskbar while Resonance is minimized or in the tray, with
  editable layouts and a Bluetooth/audio bubble
- **Mini player**: a small always-on-top window
- Tray icon and close-to-tray, Windows media controls (volume pop-up and lock screen), media keys
- Global hotkeys, including a **command box from any app**
- Song-change pop-up and notifications, start with Windows
- Opens the way you closed it (windowed, mini player or taskbar player), without a black flash on start

**Lyrics**
- Synced lyrics (LRCLIB) in the side panel, full-screen view and YouTube Music's own full player
- Word-by-word **karaoke** highlighting, **translation** and **romanization** (romaji, romaja, pinyin…)

**Sound**
- 10-band equalizer with presets, remembered **per audio output**; crossfade; volume leveling
- Visualizer (bars, wave or glow) in the player bar and/or full-screen view

**Devices**
- Battery level of connected Bluetooth devices, Bluetooth on/off and switching audio output, in the player bar,
  mini player and taskbar player
- Auto-pause when headphones disconnect (optional resume), low-battery warning

**Phone remote**
- Scan a QR code and control Resonance from your phone's browser on the same Wi-Fi; no app needed

**Personal**
- Listening stats, listening history, a yearly recap
- Themes: dark, light, system, or your own custom themes (save, export, import)
- Interface size from 90% to 140%, corners, glow strength, accent color, profile picture (inside Resonance only)
- Backup and restore of all settings

**Maintenance**
- Optional update checks against **your own GitHub repository** (off by default), a "What's new" card after updates
- **Health check** that tests every connection to YouTube Music, plus a *Recent problems* log you can copy

---

## Requirements

- **Windows 10 or 11** (64-bit). The WebView2 runtime is built into Windows 11 and current Windows 10. If it's
  missing, the installer offers it.
- To **build** it: **Rust** (https://rustup.rs) and **Node.js LTS** (https://nodejs.org).
- An internet connection. A YouTube Music / Google account is optional (you can browse as a guest), but needed
  for your library, playlists and likes.

---

## Building and installing

1. Install **Rust** from https://rustup.rs (accept the defaults; it also installs the Microsoft C++ build tools
   if they're missing) and **Node.js LTS** from https://nodejs.org.
2. Double-click **`Build.bat`**.
   - The first build downloads and compiles everything and takes several minutes. Later builds are much faster.
   - The app: `src-tauri\target\release\resonance.exe`
   - The installer: `src-tauri\target\release\bundle\nsis\Resonance_<version>_x64-setup.exe`
3. Run the installer (or the `.exe` directly).

If the installer step fails, it's usually because the build couldn't download NSIS (the installer maker) from
github.com. The app itself is still built and usable.

`Run-Dev.bat` starts a development build with developer tools (F12) for working on Resonance itself.

---

## First start

1. Resonance shows its sign-in screen. Click **Sign in with Google**. This opens Google's own sign-in page inside
   the window. Or choose **Continue without signing in**.
2. Windows SmartScreen may warn about an "unknown publisher" the first time. Choose *More info → Run anyway*,
   or see [Code signing](#code-signing-optional) to remove the warning for good.
3. Open **Settings** (your profile picture in the top-right corner, or right-click empty space) to make it yours.

---

## Ways to use Resonance

| Mode | How | Notes |
|---|---|---|
| **Windowed** | Normal window | Custom title bar; drag it, double-click to maximize |
| **Full-screen view** | F11 or the full-screen button in the player bar | Big cover art and lyrics; Esc to leave |
| **Mini player** | Mini-player button in the title bar | Small, always on top; double-click it or ⤢ to go back |
| **Taskbar player** | Settings → Taskbar → turn it on, then minimize or close to tray | Sits on the taskbar with your chosen layout |
| **Tray** | Settings → General → *Close to tray* | Closing keeps the music playing; left-click the tray icon to reopen |

**Start-up:** Resonance reopens in the mode it was closed in (windowed, mini player, or hidden with the taskbar
player). Started with Windows and set to *straight into the tray*, it stays hidden.

---

## Keyboard shortcuts

**Inside the app**

| Keys | Action |
|---|---|
| Ctrl+K or Ctrl+L | Search (type `>` for commands) |
| Space | Play / pause |
| Ctrl+→ / Ctrl+← | Next / previous song |
| Ctrl+↑ / Ctrl+↓ | Volume up / down |
| Alt+← / Alt+→ | Back / forward |
| F11 | Full-screen view |
| Esc | Close menus, pop-ups and dialogs; leave full-screen view |
| F12 | Developer tools |
| Mouse wheel on the volume slider, mini player or taskbar player | Volume |

**Global (work from any app):** change them in Settings → Shortcuts. Click a box, press the keys, Backspace to clear.

| Default | Action |
|---|---|
| Ctrl+Alt+K | Command box (from any app) |
| Ctrl+Alt+Space | Play / pause |
| Ctrl+Alt+→ / Ctrl+Alt+← | Next / previous |
| Ctrl+Alt+↑ / Ctrl+Alt+↓ | Volume up / down |
| Ctrl+Alt+M | Show / hide Resonance |
| *(unset)* | Like, shuffle, mute |

Media keys (play/pause, next, previous) also work, through Windows media controls or directly.

---

## Command box

Type `>` in the search box, or press **Ctrl+Alt+K** anywhere. Tab completes, ↑/↓ choose, Enter runs.
When opened from another app, Resonance goes back to where it was after quick commands (like `>next`).

| Command | Does |
|---|---|
| `>play` `>next` `>previous` | Playback |
| `>like` `>shuffle` `>repeat` `>mute` | Toggles |
| `>volume 40` | Set the volume (0–100) |
| `>sleep 30` · `>sleep end` · `>sleep off` | Sleep timer |
| `>mini` `>fullscreen` `>lyrics` `>queue` `>pip` | Views |
| `>home` `>explore` `>library` `>liked` | Go to a page |
| `>history` `>stats` `>recap` | Your listening |
| `>savequeue` | Save the queue as a playlist |
| `>theme dark` · `>theme light` · `>theme system` · `>theme <saved theme name>` | Theme |
| `>settings` `>appearance` `>equalizer` `>shortcuts` `>health` | Settings pages |
| `>sidebar` `>reload` | Collapse the sidebar, reload YouTube Music |

---

## Right-click menus

Resonance replaces both the browser's menu and YouTube Music's own menu with one menu in its own style:

- **On a song, album or playlist** (in pages, the queue or the player bar): YouTube Music's own actions such as
  *Start radio, Play next, Add to queue, Save to playlist, Go to album, Go to artist, Share (copies the link),
  Remove from playlist*, in your YouTube language. *Save to library* and like/dislike are left out; likes live
  on the heart button.
- **On the playing song** (player bar, now-playing panel, full-screen view, mini player): additionally
  *Always start this song at…* / *Always end this song at…* (skip intros and outros).
- **On a sidebar playlist or folder:** pin, move to folder, rename/delete folders.
- **On empty space:** playback, navigation, views, sleep timer, stats, settings.
- Text fields keep the normal cut/copy/paste menu.

**Save to playlist** opens Resonance's own picker. It shows which playlists already contain the song; tick or
untick to add or remove, or create a new playlist.

---

## Settings, tab by tab

| Tab | What's there |
|---|---|
| **General** | Ad blocker · close to tray · start with Windows (and straight into the tray) · **Bluetooth & audio output** (+ pause on headphone disconnect, resume on reconnect, low-battery warning) · **song-change pop-up** (corner, also when in front) · song-change notifications · start page · offer to continue the last song |
| **Appearance** | Theme (dark / light / system / **custom** with editor) · **interface size** · color scheme (song / profile picture / custom) · accent color · glow strength · corners · playlist covers |
| **Player bar** | Choose which buttons appear (shuffle, repeat, like, phone remote, cover/video, pop-out, full screen, sleep, full player, queue, volume) · time display |
| **Taskbar** | Taskbar player on/off · layout editor |
| **Playback** | Crossfade · volume leveling · **karaoke lyrics** · **visualizer** (where, style, strength) · Windows media controls · translate lyrics (+ language) · **romanize lyrics** · sleep-timer fade |
| **Equalizer** | 10 bands, presets, **remember per audio output** |
| **Shortcuts** | Global hotkeys |
| **Connections** | **Phone remote** (QR code, link) · Discord status |
| **Updates** | What's new · GitHub repository · automatic checks · check / install |
| **Backup & stats** | Export / import settings · listening stats |
| **Health check** | Connection tests · **Recent problems** (copy / clear) |
| **Account** | Profile picture in Resonance (custom or YouTube's) · sign out |

---

## Phone remote

Control Resonance from your phone's browser; no app needed.

1. **Settings → Connections → Phone remote**, or the **phone button** in the player bar (between the song and the heart).
2. Scan the QR code with your phone's camera. Your phone must be on **the same Wi-Fi** as the PC.
3. The remote page shows the cover art and has play/pause, previous/next, like, shuffle, seeking and volume.

- **Security:** the link contains a random secret code. Only people you give it to can use it. **New link**
  makes old links stop working. The link stays the same across restarts, so a bookmark keeps working.
- **Network:** Resonance listens on port **48720** (or the next free one up to 48730) only while the remote is on.
  Nothing goes through the internet; the phone talks straight to your PC.
- The first time, Windows Firewall asks whether Resonance may use the network. Allow it on **private** networks.

---

## Bluetooth and audio output

Settings → General → **Bluetooth & audio output** (on by default).

- An indicator in the player bar, the mini player and a separate **bubble next to the taskbar player**:
  - Bluetooth device connected: its **battery percentage** (red at 20% or less)
  - Bluetooth on, nothing connected: a Bluetooth icon
  - Bluetooth off: a crossed-out icon
  - No Bluetooth on this PC: just a speaker icon (audio output only)
- Click it to turn **Bluetooth on/off**, see connected devices with their battery, and **switch the audio output**
  (speakers, headphones, monitor…). Switching changes the Windows default output.
- **Pause when headphones disconnect**, optional **resume when they reconnect**, and a **low-battery warning** at
  15% (once per charge).

Battery levels appear for devices that report them to Windows (the same ones Windows Settings shows a percentage
for). If turning Bluetooth on/off is refused, enable *Settings → Privacy & security → Radios → Let apps control
device radios* in Windows.

---

## Lyrics

- **Source:** synced lyrics come from **LRCLIB** (https://lrclib.net, a free open lyrics database). If it has none,
  YouTube Music's own (unsynced) lyrics are used.
- **Where:** now-playing panel → *Lyrics*, the full-screen view, and YouTube Music's full player (its Lyrics tab
  becomes synced). Click a line to jump there.
- **Karaoke:** *When available* uses real word timings (some LRCLIB songs have them); *Always* estimates them.
- **Translation and romanization** use Google Translate's free web service. It's unofficial and may stop working some
  day. With only romanization on, lyrics are sent only if they're in a non-Latin script.

---

## Sound: equalizer, crossfade, leveling, visualizer

These run through the browser's audio processing on YouTube Music's own player. They only start when one of them is on.

- **Equalizer:** 10 bands (32 Hz–16 kHz), presets (Flat, Bass boost, Treble, Vocal, Rock, Electronic, Lo-fi), and
  optionally a separate setting for every audio output that switches automatically.
- **Crossfade:** 1–12 seconds. **Volume leveling:** evens out quiet and loud songs.
- **Visualizer:** player bar, full screen or both; **Bars**, **Wave** or **Glow** (the album art pulses with the
  bass); adjustable strength.

If a song ever goes silent with any of these on, turn them off. YouTube may have changed how it plays audio.
Please report it with the Health check report.

---

## Taskbar player and layouts

Settings → Taskbar. When Resonance is minimized or in the tray, a player sits **on top of the taskbar**, colored by
the song's cover.

- **Layout editor:** five built-in layouts (Classic, Compact, Now playing, Minimal, Spotlight) or your own.
  Choose and order the elements (cover, previous, play, next, title, like, shuffle, spacer), and set width, shape,
  background (album glow / solid / glass / dark), progress (none / line / fill), position (left / center / right)
  and nudge.
- Scroll on it for volume, click the progress line to seek, and click the cover or title to open Resonance.
- With Bluetooth & audio output on, a **bubble** next to it shows battery or output and opens a panel above it.

---

## Themes

Settings → Appearance → Theme → **Custom**: pick **background**, **panel** and **accent** colors with a live preview,
or start from Midnight, Forest, Wine, Ember or Mono. **Save as theme…** keeps it in your list. **Export** saves a
`.json` file you can share, and **Import…** loads one. YouTube Music's pages follow the theme's panel color.

---

## Updates and releases

Updates are **off by default**. When on, Resonance checks **only GitHub, and only your repository's latest release**.
It compares that release's version number with the installed one. No other server is involved.

1. Create a GitHub repository (e.g. `your-name/resonance`) and push this folder to it.
2. To publish a version: raise `version` in `src-tauri/tauri.conf.json` **and** `src-tauri/Cargo.toml`, commit, then
   tag it with the same number:
   ```
   git tag v1.1.0
   git push --tags
   ```
   The included GitHub Actions workflow (`.github/workflows/release.yml`) builds the installer and publishes the release.
   Write the release notes in the GitHub release; Resonance shows them in its **What's new** card.
3. In Resonance: **Settings → Updates**, enter `your-name/resonance`, then **Check for updates** or turn on
   automatic checks (once a day at start-up). **Install update** downloads the installer from that same GitHub
   release (only github.com addresses are accepted) and runs it.

---

## Code signing (optional)

Signing removes Windows' "Unknown publisher" / SmartScreen warning. It needs a code-signing certificate; there's a
free route for open-source projects. See **[docs/CODE-SIGNING.md](docs/CODE-SIGNING.md)** for the options
(SignPath Foundation, Certum open-source, Azure Trusted Signing, OV/EV certificates) and how to plug one into the build.

---

## Discord status (optional)

Settings → Connections → *Show what you're listening to on Discord*. Discord requires every app to have an
**application ID**:

1. Open https://discord.com/developers/applications and sign in.
2. **New Application**, name it **Resonance** (the name your friends see), create.
3. Copy the **Application ID** from *General Information* into Resonance.

Discord must be running on the same PC. Nothing is shown while music is paused.

---

## Privacy: what Resonance connects to and stores

**Connections**

| To | When | Why |
|---|---|---|
| music.youtube.com, Google sign-in pages | Always | The music itself |
| lrclib.net | When lyrics are needed | Lyrics |
| translate.googleapis.com | Only if translation or romanization is on | Translating and romanizing lyrics |
| api.github.com / github.com | Only if you set a repository and check for updates | Updates, release notes |
| Discord (local, on your PC) | Only if Discord status is on | "Listening to…" status |
| Your phone (local network) | Only while the phone remote is on | Remote control |

No analytics or telemetry, and no other servers.

**Stored on your PC only**
- Settings, listening stats, history, themes, playlist cache: in YouTube Music's local storage inside Resonance's WebView2 profile
- `prefs.json` (Windows media controls, start-up mode, window size, phone-remote secret): in `%APPDATA%\app.resonance.desktop\`
- Crash log: `%TEMP%\resonance-log.txt` (only if something crashes)

---

## Memory and performance

- Most memory is YouTube Music's page itself (as in a browser tab). Resonance's own code uses a few MB.
- The taskbar player and song-change pop-up windows only exist while those features are on.
- While minimized or in the tray, Resonance asks WebView2 to use as little memory as possible. Music keeps playing.
- After 6+ hours open, hidden and idle for 15 minutes, it quietly reloads YouTube Music's page to free memory.
  Play continues where you left off.
- The interface only redraws what actually changes, so CPU use while playing stays low.

---

## Troubleshooting

**First stop: Settings → Health check.** It tests each connection Resonance uses with YouTube Music and shows
**Recent problems**. Use **Copy report** / **Copy errors** and include them when reporting an issue.

| Problem | Try |
|---|---|
| Songs go silent | Turn off crossfade, leveling, equalizer and visualizer; report it |
| A control stopped working after a YouTube change | Run the Health check and send the report |
| Global hotkey doesn't work | Another app owns that combination; Settings → Shortcuts shows which failed, pick another |
| Phone can't reach the remote | Same Wi-Fi? Allow Resonance in Windows Firewall on private networks; try **New link** |
| Bluetooth switch refused | Windows Settings → Privacy & security → Radios → *Let apps control device radios* |
| No battery shown | The device doesn't report its battery to Windows |
| Translation stopped working | Google's free web service changed or limited it; nothing to fix on your side |
| Window doesn't appear on start | It opens how it was closed: check the tray icon or the taskbar player |
| Build: installer step failed | NSIS couldn't be downloaded from github.com; the app `.exe` is still built |
| App crashes | Look for `%TEMP%\resonance-log.txt` and include it in the report |

---

## Project structure

```
Build.bat / Run-Dev.bat        build the installer / run a development build
package.json                   Tauri CLI
dist/
  widget.html, widget-render.js  taskbar player (+ Bluetooth bubble); renderer shared with the layout editor
  overlay.html                 song-change pop-up
docs/CODE-SIGNING.md           code-signing options
.github/workflows/release.yml  builds and publishes a release when you push a version tag
src-tauri/
  tauri.conf.json, Cargo.toml  app config and Rust dependencies
  build.rs                     list of commands the page may call
  capabilities/                which pages/windows may call which commands
  remote.html                  the phone remote page
  src/
    main.rs                    windows, start-up/modes, tray, taskbar player, mini player, pop-up, media keys, memory
    extras.rs                  preferences, updates & release notes, lyrics, translation, Discord, hotkeys, autostart, notifications, logs
    devices.rs                 Bluetooth radio, connected devices & battery, audio outputs (Windows APIs)
    remote.rs                  phone remote web server and QR code
  inject/
    ui.js, ui.css              Resonance's interface, injected into YouTube Music
    bridge.js                  reads and controls YouTube Music's player, queue, menus and API
    page.css                   restyles YouTube Music's own page to fit inside the interface
    adblock.js                 ad blocker
```

---

## How it works (for developers)

- The main window loads **music.youtube.com** in WebView2. At document start, Tauri injects one script made of
  `page.css`, `ui.css`, `widget-render.js`, `adblock.js`, `bridge.js` and `ui.js` (see `inject_script()` in `main.rs`).
- **The interface lives in a Shadow DOM** (`<res-shell>`), so YouTube's styles and Resonance's don't clash.
- **YouTube enforces Trusted Types**, so `innerHTML` is never used. `setHTML()` / `buildNodes()` in `ui.js` build DOM
  nodes directly.
- **`window.__res` (bridge.js)** is the only place that knows YouTube Music's page: its hidden player bar,
  `#movie_player` API, queue, menus and its internal API (authenticated like the website itself). When YouTube
  changes something, fixes usually go here; the Health check shows what broke.
- **Native features** are Tauri commands. A new command must be listed in `build.rs` *and* allowed in
  `capabilities/*.json`, or the page can't call it.
- All WebView2 windows must use identical browser arguments (`browser_args()` in `main.rs`).
- The taskbar player is kept above the taskbar with `SetWindowPos(HWND_TOPMOST)`, re-applied every 350 ms while visible.

---

## Known limitations

- Depends on YouTube Music's website. When YouTube changes its page, some controls may stop working until Resonance
  is updated (the Health check shows which).
- Windows only. A Linux build is possible (Tauri supports it) but needs work: WebKitGTK instead of WebView2,
  plus Wayland's limits on the taskbar player and always-on-top.
- Translation and romanization rely on an unofficial Google endpoint.
- Switching the default audio output uses an undocumented Windows interface (the one Windows' own sound settings
  and tools like EarTrumpet use).
- The ad blocker may need updates when YouTube changes how ads are delivered.

---

## Credits

- [Tauri](https://tauri.app) and Microsoft **WebView2**
- [LRCLIB](https://lrclib.net) for synced lyrics
- [discord-rich-presence](https://crates.io/crates/discord-rich-presence), [qrcodegen](https://crates.io/crates/qrcodegen),
  [ureq](https://crates.io/crates/ureq), [semver](https://crates.io/crates/semver), [image](https://crates.io/crates/image),
  [windows-rs](https://github.com/microsoft/windows-rs), [webview2-com](https://crates.io/crates/webview2-com)
- Icons in the style of Google's Material Symbols

**License:** none is included yet. 

Resonance is not affiliated with, endorsed by or sponsored by Google, YouTube or Discord. YouTube Music is a
trademark of Google LLC.
