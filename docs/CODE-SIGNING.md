# Code signing Resonance (optional)

Without a signature, Windows SmartScreen shows **"Windows protected your PC" / "Unknown publisher"** the first
time someone runs the installer. Signing proves the installer comes from you and hasn't been changed.
It does not change how Resonance works.

## Your options (check current prices and requirements — they change)

1. **SignPath Foundation — free for open-source projects.**
   If you publish Resonance as an open-source project on GitHub (with an open-source license), you can apply
   for free signing. They sign releases built by GitHub Actions. Good fit for this project.
2. **Certum "Open Source Code Signing" certificate** (Polish certificate authority).
   An inexpensive certificate meant for open-source developers. It comes on a smart card / cloud key.
3. **Microsoft Azure Trusted Signing (Artifact Signing).**
   A low monthly fee, signing happens in the cloud, and Microsoft verifies your identity.
   Availability for individual developers depends on your country.
4. **A regular OV/EV code signing certificate** from a certificate authority (Sectigo, DigiCert, …).
   The most expensive route.

Note: even signed apps can show a SmartScreen warning at first until the publisher builds "reputation"
(downloads over time). Signing still makes the warning less scary (it shows your name instead of "Unknown").

## Hooking a certificate into the build

Tauri signs the app and installer during `npx tauri build` when you add **one** of these to
`src-tauri/tauri.conf.json` under `bundle.windows`:

**A certificate installed on this PC** (e.g. Certum, OV/EV):
```json
"windows": {
  "certificateThumbprint": "YOUR_CERT_SHA1_THUMBPRINT",
  "digestAlgorithm": "sha256",
  "timestampUrl": "http://timestamp.digicert.com"
}
```
(Find the thumbprint in `certmgr.msc` → Personal → Certificates → your certificate → Details → Thumbprint.)

**A cloud / custom signing tool** (Azure Trusted Signing, SignPath, …):
```json
"windows": {
  "signCommand": "trusted-signing-cli -e https://YOUR-REGION.codesigning.azure.net -a YOUR-ACCOUNT -c YOUR-PROFILE %1"
}
```
`%1` is replaced with the file to sign. Use the command your provider documents.

For GitHub Actions releases, store secrets (passwords, keys) under the repository's
**Settings → Secrets and variables → Actions** and reference them in `.github/workflows/release.yml` — never commit them.
