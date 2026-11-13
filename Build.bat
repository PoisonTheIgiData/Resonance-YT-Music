@echo off
title Build Resonance
cd /d "%~dp0"
where cargo >nul 2>nul
if errorlevel 1 (
  echo Rust is not installed. Install it from https://rustup.rs and run Build.bat again.
  start https://rustup.rs
  pause
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js is required: https://nodejs.org
  pause
  exit /b 1
)
if not exist node_modules\@tauri-apps\cli call npm install
echo.
echo Building Resonance...
call npx tauri build
set BUILD_ERR=%errorlevel%
echo.
if not exist "src-tauri\target\release\resonance.exe" (
  echo Build FAILED - see the messages above.
  pause
  exit /b 1
)
echo App built:  src-tauri\target\release\resonance.exe
if exist "src-tauri\target\release\bundle\nsis\*.exe" (
  echo Installer:  src-tauri\target\release\bundle\nsis\
  explorer "src-tauri\target\release\bundle\nsis"
) else (
  echo The installer step failed ^(it needs to download NSIS from github.com^), but the app itself is ready.
  explorer /select,"src-tauri\target\release\resonance.exe"
)
pause
