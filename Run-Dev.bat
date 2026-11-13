@echo off
title Resonance (dev)
cd /d "%~dp0"
if not exist node_modules\@tauri-apps\cli call npm install
call npx tauri dev
