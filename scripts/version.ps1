# Reads or sets Resonance's version number in every file that holds it.
#   powershell -File scripts\version.ps1 -Current        -> prints e.g. 1.0.0
#   powershell -File scripts\version.ps1 -Next           -> prints the next patch version, e.g. 1.0.1
#   powershell -File scripts\version.ps1 -Set 1.2.0      -> writes 1.2.0 everywhere
param([switch]$Current, [switch]$Next, [string]$Set)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$utf8 = New-Object System.Text.UTF8Encoding $false   # no BOM: JSON/TOML readers dislike it

function Get-Text([string]$p) { [IO.File]::ReadAllText((Join-Path $root $p)) }
function Set-Text([string]$p, [string]$t) { [IO.File]::WriteAllText((Join-Path $root $p), $t, $utf8) }
function Replace-First([string]$text, [string]$pattern, [string]$with, [int]$count = 1) {
  ([regex]$pattern).Replace($text, $with, $count)
}

$conf = Get-Text 'src-tauri/tauri.conf.json'
$cur = [regex]::Match($conf, '"version"\s*:\s*"(\d+\.\d+\.\d+)"').Groups[1].Value
if (-not $cur) { Write-Error 'No version found in src-tauri/tauri.conf.json'; exit 1 }

if ($Current) { $cur; exit 0 }
if ($Next) { $p = $cur.Split('.'); '{0}.{1}.{2}' -f $p[0], $p[1], ([int]$p[2] + 1); exit 0 }

if ($Set) {
  if ($Set -notmatch '^\d+\.\d+\.\d+$') { Write-Error 'A version looks like 1.2.3'; exit 1 }
  $json = '"version": "' + $Set + '"'
  Set-Text 'src-tauri/tauri.conf.json' (Replace-First (Get-Text 'src-tauri/tauri.conf.json') '"version"\s*:\s*"[^"]*"' $json)
  Set-Text 'package.json' (Replace-First (Get-Text 'package.json') '"version"\s*:\s*"[^"]*"' $json)
  # package-lock.json: the project's own version appears twice at the top
  Set-Text 'package-lock.json' (Replace-First (Get-Text 'package-lock.json') '"version"\s*:\s*"[^"]*"' $json 2)
  Set-Text 'src-tauri/Cargo.toml' (Replace-First (Get-Text 'src-tauri/Cargo.toml') '(?m)^version\s*=\s*"[^"]*"' ('version = "' + $Set + '"'))
  Set-Text 'src-tauri/Cargo.lock' (Replace-First (Get-Text 'src-tauri/Cargo.lock') '(name = "resonance"\r?\nversion = )"[^"]*"' ('${1}"' + $Set + '"'))
  "Version set to $Set"
  exit 0
}
Write-Output 'Use -Current, -Next or -Set <version>'
