# winget — `Fosslife.Waterfowl`

Windows Package Manager manifests, laid out in the exact `microsoft/winget-pkgs` tree:

```
manifests/f/Fosslife/Waterfowl/0.2.2/
  Fosslife.Waterfowl.installer.yaml     # nullsoft (NSIS) x64 installer + sha256
  Fosslife.Waterfowl.locale.en-US.yaml  # default-locale metadata
  Fosslife.Waterfowl.yaml               # version manifest
```

Install (once accepted upstream): `winget install Fosslife.Waterfowl`

## Design notes

- **Installer = NSIS `.exe`** (`InstallerType: nullsoft`), same artifact Scoop uses.
  `Scope: user` because Tauri's NSIS bundle installs per-user into `%LOCALAPPDATA%`.
  sha256 `2727…169B57` (uppercase) verified against the live asset.
- **Manifest schema 1.6.0**, three-file split (installer + defaultLocale + version) as
  winget-pkgs requires.
- **Updater:** winget can't easily set `WATERFOWL_PACKAGED`, so the in-app updater stays
  on. On Windows that only risks *version drift* vs winget (the app self-updates in its
  per-user dir) — no root-owned corruption. Acceptable; `UpgradeBehavior: install`.

## Verified in Phase 1 (2026-06-01)

- ✅ Installer sha256 recomputed from the real `waterfowl_0.2.2_x64-setup.exe`
  (3,222,884 bytes) — matches.
- ⬜ `winget validate` / schema lint — needs Windows (Phase 2).

## Phase-2 (user, on Windows)

```powershell
winget validate --manifest manifests\f\Fosslife\Waterfowl\0.2.2
winget install  --manifest manifests\f\Fosslife\Waterfowl\0.2.2   # local install test
```

Then submit — easiest via `wingetcreate`:

```powershell
wingetcreate update Fosslife.Waterfowl --version 0.2.2 `
  --urls https://github.com/fosslife/waterfowl/releases/download/Waterfowl-v0.2.2/waterfowl_0.2.2_x64-setup.exe `
  --submit
```

or open a PR adding this folder to `microsoft/winget-pkgs`. The Azure pipeline validates +
sandbox-installs automatically.

## Before submitting

- **LICENSE must be live on `master`** — `LicenseUrl` points at
  `…/blob/master/LICENSE`; merge the MIT license to `master` first (it's currently on the
  `packaging/distribution` branch).
- Set the real `ReleaseDate`.
- **Code signing (recommended, not required):** the NSIS exe is unsigned, so users hit a
  SmartScreen warning. An OV/EV Authenticode cert removes it — cross-cutting Windows
  prereq, pending user decision. winget accepts unsigned installers regardless.
- **AppsAndFeaturesEntries / ProductCode** omitted (winget falls back to name matching).
  If upgrade-detection misbehaves in testing, add the NSIS uninstall `ProductCode` (read
  it from `HKCU\…\Uninstall` after a test install).
