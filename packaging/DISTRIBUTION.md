# Waterfowl — Distribution / Packaging Tracker

> **Purpose:** single source of truth for shipping Waterfowl across package managers.
> Pick up here in any session. Update the status table as things land.

---

## ⏭️ Pick up next (start here in a new session)

Work happens on branch **`packaging/distribution`**. The AUR `waterfowl-bin` files and this tracker are committed (`53cac10 feat: arch packaging`). **All actual _publishing_ to AUR and every other channel is deliberately held open** until packaging is ready across most platforms — so build/prep work continues, no channel goes live yet.

Build/prep threads ready to pick up:

1. **AUR `waterfowl-bin`** — package is built, installed, and launch-tested locally (`makepkg -si` → `waterfowl` ran fine). Publish steps remain but are intentionally deferred (see note above): create AUR account + SSH key, `git clone ssh://aur@aur.archlinux.org/waterfowl-bin.git`, copy in `PKGBUILD` + `.SRCINFO`, push. See §1.
2. ~~**Updater guard (Strategy A)**~~ — ✅ **IMPLEMENTED 2026-05-31.** `updater_allowed` command (`src-tauri/src/commands/updater.rs`), registered in `lib.rs`, guarded at the top of `checkForUpdates()` in `Welcome.tsx`. Both backend (`cargo check`) and frontend (`tsc`) compile clean.

Build/prep in flight:

3. **Scoop (Windows)** 🚧 — manifest at `packaging/scoop/waterfowl.json` (2026-05-31), with the real verified SHA256 already filled. One thing remains and it needs an actual Windows box: `scoop install` the manifest, confirm the `bin`/shortcut path (the NSIS extract layout is unverified — may need `extract_dir`), and confirm the updater stays silent. Then publish to a bucket. See §3 for exact commands. After that, the next _new_ channel is **Flathub** (broadest Linux).

---

## Project facts (verified 2026-05-29)

| Thing              | Value                                                                           |
| ------------------ | ------------------------------------------------------------------------------- |
| GitHub repo        | `github.com/fosslife/waterfowl`                                                 |
| App / binary name  | `waterfowl` (lowercase)                                                         |
| Bundle identifier  | `com.fosslife.waterfowl`                                                        |
| Current version    | `0.2.2`                                                                         |
| Release tag format | `Waterfowl-v<version>` (e.g. `Waterfowl-v0.2.2`)                                |
| Asset URL base     | `https://github.com/fosslife/waterfowl/releases/download/Waterfowl-v<version>/` |
| Release CI         | `.github/workflows/release.yml` (`tauri-action`, on push to `master`)           |

### Release asset names (per version `X.Y.Z`)

| Platform              | Asset                            |
| --------------------- | -------------------------------- |
| Linux deb             | `waterfowl_X.Y.Z_amd64.deb`      |
| Linux AppImage        | `waterfowl_X.Y.Z_amd64.AppImage` |
| Linux rpm             | `waterfowl-X.Y.Z-1.x86_64.rpm`   |
| Windows NSIS          | `waterfowl_X.Y.Z_x64-setup.exe`  |
| Windows MSI           | `waterfowl_X.Y.Z_x64_en-US.msi`  |
| macOS (Apple Silicon) | `waterfowl_X.Y.Z_aarch64.dmg`    |
| macOS app bundle      | `waterfowl_aarch64.app.tar.gz`   |

> Every asset also has a matching `.sig` (Tauri updater signature, **not** a GPG/code-signing sig).

---

## The two distribution models

- **You push** (submit a manifest/recipe): AUR, Homebrew, winget, Chocolatey, Scoop, Flathub, Snap. → We can do these ourselves.
- **A maintainer pulls** (sponsored, policy-gated): official Debian `apt`, official Fedora `dnf`, official Arch `[extra]`. → Only realistic once popular; needs a volunteer maintainer.

Everything below targets the "you push" model, plus self-hosted repos as the practical substitute for official `apt`/`dnf`.

---

## Status overview

Legend: ✅ done · 🚧 in progress · ⏳ todo · 🔒 blocked (dependency) · ❌ not pursuing (yet)

| #   | Channel                                 | Install command                              | Status | Blocked on                    |
| --- | --------------------------------------- | -------------------------------------------- | ------ | ----------------------------- |
| 1   | **AUR (Arch)** `waterfowl-bin`          | `yay -S waterfowl-bin`                       | 🚧     | —                             |
| 2   | AUR (Arch) `waterfowl` (from source)    | `yay -S waterfowl`                           | ⏳     | —                             |
| 3   | Scoop (Windows)                         | `scoop install waterfowl`                    | 🚧     | Windows install test + bucket |
| 4   | winget (Windows)                        | `winget install waterfowl`                   | ⏳     | code signing (recommended)    |
| 5   | Chocolatey (Windows)                    | `choco install waterfowl`                    | ⏳     | code signing (recommended)    |
| 6   | Homebrew Cask (macOS) — own tap         | `brew install --cask fosslife/tap/waterfowl` | ⏳     | macOS notarization            |
| 7   | Homebrew Cask — `homebrew/cask` central | `brew install --cask waterfowl`              | ⏳     | notarization + popularity     |
| 8   | Flathub (Linux, all distros)            | `flatpak install flathub <id>`               | ⏳     | —                             |
| 9   | Snap Store (Linux)                      | `snap install waterfowl`                     | ⏳     | —                             |
| 10  | Self-hosted apt repo (Debian/Ubuntu)    | `apt install waterfowl`                      | ⏳     | GPG repo key + hosting        |
| 11  | Ubuntu PPA (Launchpad)                  | `add-apt-repository ppa:…`                   | ❌     | (alt to #10)                  |
| 12  | Self-hosted dnf repo (Fedora/RHEL)      | `dnf install waterfowl`                      | ⏳     | GPG repo key + hosting        |
| 13  | Fedora COPR                             | `dnf copr enable …`                          | ❌     | (alt to #12)                  |
| 14  | Official Debian                         | `apt install waterfowl`                      | ❌     | sponsor + ITP                 |
| 15  | Official Fedora                         | `dnf install waterfowl`                      | ❌     | sponsor + review              |
| 16  | Official Arch `[extra]`                 | `pacman -S waterfowl`                        | ❌     | Package Maintainer adoption   |

---

## Cross-cutting prerequisites (the real gates)

These block multiple channels. Track them here.

| Prereq                                    | Needed for                  | Status | Notes                                                                                                                                                                                                                                    |
| ----------------------------------------- | --------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub Releases automation                | everything                  | ✅     | `tauri-action` already attaches all bundles                                                                                                                                                                                              |
| Stable download URLs + checksums          | all "you push" channels     | ✅     | URL base known; checksums computed per release                                                                                                                                                                                           |
| Windows code signing (Authenticode OV/EV) | winget, choco (recommended) | ⏳     | unsigned ⇒ SmartScreen warnings                                                                                                                                                                                                          |
| macOS Developer ID + notarization         | Homebrew Cask               | ⏳     | unsigned ⇒ Gatekeeper blocks                                                                                                                                                                                                             |
| GPG repo signing key                      | apt/dnf self-hosted repos   | ⏳     | —                                                                                                                                                                                                                                        |
| x86_64 macOS build                        | Intel mac users             | ⏳     | CI currently aarch64 only (commented out in release.yml)                                                                                                                                                                                 |
| **Updater vs package-manager conflict**   | all packaged builds         | ✅     | Strategy A (runtime guard) implemented 2026-05-31: `updater_allowed` command gates `checkForUpdates()`. Linux → only AppImage (`$APPIMAGE`) self-updates; `WATERFOWL_PACKAGED` env opt-out for any channel. Spec in "Open decisions" §1. |

---

## Per-channel detail & checklists

### 1. AUR — `waterfowl-bin` 🚧 (STARTED HERE)

**Approach:** repackage the released `.deb` (contains `/usr/bin/waterfowl`, `.desktop`, icons). Standard for Tauri apps on AUR.

Files: `packaging/aur/waterfowl-bin/`

- [x] `PKGBUILD`
- [x] `.SRCINFO` (generated with `makepkg --printsrcinfo > .SRCINFO`)
- [x] Local build test: `makepkg -f` succeeds; package ships `/usr/bin/waterfowl`, `.desktop`, 3 icon sizes — verified
- [x] Install + launch test: `makepkg -si` then `waterfowl` — **launches fine on Arch (verified 2026-05-29)**
- [ ] Create AUR account + add SSH key (https://aur.archlinux.org) ← **next for this thread**
- [ ] `git clone ssh://aur@aur.archlinux.org/waterfowl-bin.git`, copy in `PKGBUILD` + `.SRCINFO`, push
- [ ] Verify `yay -S waterfowl-bin` works on a clean-ish system

> **Note:** upstream `.desktop` is still the Tauri template default (`Comment=A Tauri App`, empty `Categories`). Cosmetic, baked into the bundle — fix in `tauri.conf.json` bundle config, not here.

**Runtime deps (Arch):** `webkit2gtk-4.1`, `gtk3` (pull cairo/glib/etc transitively).

### 2. AUR — `waterfowl` (build from source) ⏳

Compiles via `cargo`/`pnpm` in `build()`. Heavier; needs `rust`, `pnpm`, `nodejs`, webkit dev headers as `makedepends`. Do after `-bin` is proven.

### 3. Scoop (Windows) 🚧 (STARTED 2026-05-31)

Easiest Windows channel. JSON manifest in a bucket (own repo `fosslife/scoop-bucket` or submit to `extras`). Points at the NSIS `.exe` + SHA256. Supports `autoupdate`.

**File:** `packaging/scoop/waterfowl.json` — drafted.

**Design decisions baked into the manifest:**

- **Install method = extract, not run-installer.** The url uses the `…-setup.exe#/dl.7z` trick so Scoop 7-Zip-extracts the Tauri NSIS installer into Scoop's own app dir (`~/scoop/apps/waterfowl/<version>`) instead of running a system installer into Program Files. Keeps it self-contained and uninstall-clean, the Scoop way.
- **`bin` + `shortcuts` → `waterfowl.exe`.** ⚠️ Assumes the binary sits at the extraction root. **Needs Windows validation** — if the NSIS payload nests under a subfolder, add `"extract_dir"`.
- **`env_set: { WATERFOWL_PACKAGED: "1" }`.** This is the Scoop side of the updater guard — it makes `updater_allowed` (Rust) return `false`, so the in-app updater stays off and Scoop owns version bumps. Ties directly to "Open decisions" §1.
- **`checkver` + `autoupdate`** wired to the `Waterfowl-v$version` tag + asset naming, so future releases bump automatically.

**Checklist:**

- [x] Draft manifest (`packaging/scoop/waterfowl.json`)
- [x] **Real SHA256 filled + verified.** `2727900900a07b4cb120cdc29d98a823087c3702c0510ef3ba39f7d626169b57` for `waterfowl_0.2.2_x64-setup.exe` (3,222,884 bytes, confirmed a valid Nullsoft/NSIS PE32). Computed locally by downloading the official release asset and `sha256sum`-ing it three times (reproducible). Scoop hashes the raw file; the `#/dl.7z` fragment does not change the hash. On future bumps, `.\bin\checkver.ps1 waterfowl -u` in the bucket regenerates it.
- [ ] Validate on Windows: `scoop install .\waterfowl.json`, launch, confirm `bin`/shortcut path (adjust `extract_dir` if the NSIS payload nests — couldn't inspect here, no 7-Zip locally), confirm `WATERFOWL_PACKAGED` is set and the in-app updater is silent.
- [ ] Publish: create `fosslife/scoop-bucket`, add the manifest, then `scoop bucket add fosslife https://github.com/fosslife/scoop-bucket && scoop install waterfowl`. (Submitting to `ScoopInstaller/Extras` is the broader-reach alternative; own bucket first.)

> **Aside (not a Scoop blocker):** the repo has **no LICENSE file** and `package.json` has no `license`, so the manifest uses `"license": "Unknown"`. A repo with no license is "all rights reserved" by default — worth adding a real license, which also lets the manifest declare it.

### 4. winget (Windows) ⏳

YAML manifest PR to `microsoft/winget-pkgs`. Generate/update with `wingetcreate`. Prefers signed installer.

### 5. Chocolatey (Windows) ⏳

`.nuspec` + install script; moderation queue. Can download installer from release URL.

### 6/7. Homebrew Cask (macOS) ⏳

Own tap first (`fosslife/homebrew-tap`) — easy, no review. Ruby cask → `.dmg` URL + sha256. Central `homebrew/cask` later (needs notarization + popularity). **Note:** only aarch64 dmg today; need x86_64 or `depends_on arch:` handling.

### 8. Flathub (Linux) ⏳

Best broad-Linux coverage from one manifest. Submit manifest PR to `flathub/flathub`. Tauri supports flatpak bundling. App id = `com.fosslife.waterfowl`.

### 9. Snap ⏳

`snapcraft.yaml`, push to Snap Store.

### 10. Self-hosted apt repo ⏳

Build `.deb` (have it) → GPG-sign → generate `Packages`/`Release` → host (GitHub Pages or server). Users add repo line + key. This is the practical `apt install waterfowl`.

### 12. Self-hosted dnf repo ⏳

`.rpm` (have it) → GPG-sign → `createrepo_c` → host `.repo` file.

---

## Open decisions

### 1. Updater strategy for packaged builds — ✅ DECIDED (Strategy A), ✅ IMPLEMENTED 2026-05-31

> **Implemented:** `src-tauri/src/commands/updater.rs` (`updater_allowed`), registered in `lib.rs` invoke_handler, guarded at the top of `checkForUpdates()` in `Welcome.tsx`. Spec below kept for reference / per-channel responsibilities.

**The problem (verified in code 2026-05-29):**

- `src/pages/Welcome.tsx:29-63` — a `useEffect` runs on mount and **silently auto-installs**: `check()` → `downloadAndInstall()` → `relaunch()`. No user confirmation, no gate.
- `src-tauri/src/lib.rs:34` — `tauri_plugin_updater::Builder::new().build()` registers the plugin unconditionally.
- `tauri.conf.json` — `createUpdaterArtifacts: true`; updater endpoint = the GitHub `latest.json`.
- On a pacman/apt/etc install the binary is at `/usr/bin/waterfowl` (root-owned, package-tracked). Self-update either errors (Linux) or corrupts package-tracked files (Win/macOS). Must be gated.

**Key constraint:** the "am I packaged?" signal must come from the **install environment**, not the binary — because the channels that hurt most reuse the _identical_ prebuilt artifact (AUR `-bin` repackages the CI `.deb`; winget/choco run the stock NSIS `.exe`; Homebrew Cask installs the stock `.dmg`). They never recompile, so a compile-time flag can't reach them.

**Chosen: Strategy A — runtime guard (one build, covers every channel).**
Optionally layer Strategy B (Cargo feature) later for the from-source channels as defense-in-depth.

**Implementation spec (do this, ~15 lines + guard clause):**

1. Rust — add a command in `src-tauri/src/commands/` (and register in `lib.rs` `invoke_handler!`):
   ```rust
   #[tauri::command]
   fn updater_allowed() -> bool {
       // Explicit opt-out wins (set by packaging recipes that can).
       if std::env::var("WATERFOWL_PACKAGED").is_ok() {
           return false;
       }
       // Linux: self-update only makes sense for a directly-downloaded AppImage.
       // A package install (/usr/bin) has no $APPIMAGE set → disallow.
       #[cfg(target_os = "linux")]
       {
           return std::env::var("APPIMAGE").is_ok();
       }
       // Win/macOS: allow by default (direct installer). Packaged installs that
       // can set a marker/env opt out via WATERFOWL_PACKAGED above.
       #[allow(unreachable_code)]
       true
   }
   ```
2. Frontend — guard at the top of `checkForUpdates()` in `Welcome.tsx`:
   ```ts
   import { invoke } from "@tauri-apps/api/core";
   // ...
   if (!(await invoke<boolean>("updater_allowed"))) return;
   ```
3. Per-channel responsibilities (record in each recipe):
   - **AUR / Flatpak / Snap** → auto-handled on Linux (no `$APPIMAGE`). **Zero extra work.**
   - **Direct AppImage / `.dmg` / `.exe`** → updater stays on (intended).
   - **Homebrew Cask** → both direct + brew land in `/Applications`; add a `postflight` stanza that sets the marker (or, simpler, accept self-update on macOS — no root-owned corruption there).
   - **winget / choco** → same Program Files path as direct download. Either set `WATERFOWL_PACKAGED` in the choco install script (winget can't easily), or accept self-update on Windows (version drift in the PM, but not file corruption).

**Also worth doing (UX, not strictly packaging):** ✅ **DONE 2026-05-31.** Replaced the silent auto-install with notify-then-click: app-wide `<UpdateBanner />` (`src/components/update-banner/`, mounted in `AppLayout`) checks on mount (gated by `updater_allowed`) and shows a dismissible banner with "Update & Restart" + download progress. All updater logic removed from `Welcome.tsx`.

**Strategy B (optional follow-up):** `#[cfg(feature = "self-updater")]` (default on) around the plugin registration in `lib.rs` + expose the flag to the frontend. From-source channels (AUR `waterfowl`, Flatpak, Snap, self-built apt/dnf) build with `--no-default-features` → updater code absent entirely (smaller binary, bulletproof). Insufficient alone — does nothing for repackaging channels — so it complements A, doesn't replace it.

**Strategy C (rejected for now):** two CI variants (portable-with-updater vs packaged-without). Correct in general but doubles part of the build matrix and clutters the release page; revisit only if A+B prove inadequate.

### Other open decisions (need user input before some channels)

2. **Windows code signing cert** — buy an OV/EV Authenticode cert? Affects winget/choco UX.
3. **macOS notarization** — enroll in Apple Developer Program ($99/yr)? Required for a smooth Homebrew Cask.
4. **Hosting for apt/dnf repos** — GitHub Pages vs own server.
5. **x86_64 macOS** — enable the commented-out Intel build in `release.yml`?

---

## How a new release propagates (target end state)

On version bump → CI builds & publishes GitHub Release → automated manifest bumps fan out:

- AUR: bump `pkgver` + checksums, regen `.SRCINFO`, push (scriptable in CI)
- Scoop: `autoupdate` (automatic)
- winget: `wingetcreate update` (+ bots)
- Homebrew: `brew bump-cask-pr`
- Flathub: update bot PRs

> Not wired yet — revisit once ≥2 channels are live.

---

## Changelog

- **2026-05-29** — Created tracker on branch `packaging/distribution`. Built AUR `waterfowl-bin` (PKGBUILD + .SRCINFO), verified locally via `makepkg -si` + launch — only AUR publish remains. Locked updater strategy (Strategy A, runtime guard) — spec written, not implemented. Work left **uncommitted** at user's request.
- **2026-05-31** — Earlier work committed as `53cac10 feat: arch packaging`. Implemented updater guard (Strategy A): added `updater_allowed` Tauri command + registered it + guarded the updater check; `cargo check` and `tsc` both clean. Publishing to AUR/all channels deliberately held open until packaging is ready across most platforms.
- **2026-05-31** — Completed the updater UX: replaced the silent auto-install with an app-wide `<UpdateBanner />` (`src/components/update-banner/`, mounted in `AppLayout`) that checks on mount (gated by `updater_allowed`), then notifies → user clicks → downloads with progress → relaunches. All updater logic removed from `Welcome.tsx`. Updater story now complete.
- **2026-05-31** — Started Scoop (#3): authored `packaging/scoop/waterfowl.json` (NSIS `#/dl.7z` extract pattern, `env_set WATERFOWL_PACKAGED=1` to satisfy the updater guard, `checkver`+`autoupdate`). Filled + verified the real SHA256 (`2727900900…169b57`) by downloading the official `x64-setup.exe` and hashing it (reproducible; confirmed valid NSIS PE32). Remaining: Windows `scoop install` validation (bin/extract_dir) + publish to a bucket. Noted repo has no LICENSE (manifest uses `"license": "Unknown"`).
