# Waterfowl — Distribution / Packaging Tracker

> **Purpose:** single source of truth for shipping Waterfowl across package managers.
> Pick up here in any session. Update the status table as things land.

---

## ⏭️ Pick up next (start here in a new session)

Work happens on branch **`packaging/distribution`**. Current state is **uncommitted** (user opted not to commit on 2026-05-29).

Two independent threads are ready to go, pick either:

1. **Publish AUR `waterfowl-bin`** — package is built, installed, and launch-tested locally (`makepkg -si` → `waterfowl` ran fine). Only the *publish* steps remain: create AUR account + SSH key, `git clone ssh://aur@aur.archlinux.org/waterfowl-bin.git`, copy in `PKGBUILD` + `.SRCINFO`, push. See §1.
2. **Wire up the updater guard (Strategy A)** — design is locked (see "Open decisions" §1 below); not yet implemented. ~15 lines of Rust + a guard clause in `Welcome.tsx`. This should land before publishing to *any* channel widely, because the app currently auto-updates silently over managed installs.

After that, the next *new* channel to build is **Scoop** (easiest Windows) or **Flathub** (broadest Linux). See status table.

---

## Project facts (verified 2026-05-29)

| Thing | Value |
| --- | --- |
| GitHub repo | `github.com/fosslife/waterfowl` |
| App / binary name | `waterfowl` (lowercase) |
| Bundle identifier | `com.fosslife.waterfowl` |
| Current version | `0.2.2` |
| Release tag format | `Waterfowl-v<version>` (e.g. `Waterfowl-v0.2.2`) |
| Asset URL base | `https://github.com/fosslife/waterfowl/releases/download/Waterfowl-v<version>/` |
| Release CI | `.github/workflows/release.yml` (`tauri-action`, on push to `master`) |

### Release asset names (per version `X.Y.Z`)

| Platform | Asset |
| --- | --- |
| Linux deb | `waterfowl_X.Y.Z_amd64.deb` |
| Linux AppImage | `waterfowl_X.Y.Z_amd64.AppImage` |
| Linux rpm | `waterfowl-X.Y.Z-1.x86_64.rpm` |
| Windows NSIS | `waterfowl_X.Y.Z_x64-setup.exe` |
| Windows MSI | `waterfowl_X.Y.Z_x64_en-US.msi` |
| macOS (Apple Silicon) | `waterfowl_X.Y.Z_aarch64.dmg` |
| macOS app bundle | `waterfowl_aarch64.app.tar.gz` |

> Every asset also has a matching `.sig` (Tauri updater signature, **not** a GPG/code-signing sig).

---

## The two distribution models

- **You push** (submit a manifest/recipe): AUR, Homebrew, winget, Chocolatey, Scoop, Flathub, Snap. → We can do these ourselves.
- **A maintainer pulls** (sponsored, policy-gated): official Debian `apt`, official Fedora `dnf`, official Arch `[extra]`. → Only realistic once popular; needs a volunteer maintainer.

Everything below targets the "you push" model, plus self-hosted repos as the practical substitute for official `apt`/`dnf`.

---

## Status overview

Legend: ✅ done · 🚧 in progress · ⏳ todo · 🔒 blocked (dependency) · ❌ not pursuing (yet)

| # | Channel | Install command | Status | Blocked on |
| --- | --- | --- | --- | --- |
| 1 | **AUR (Arch)** `waterfowl-bin` | `yay -S waterfowl-bin` | 🚧 | — |
| 2 | AUR (Arch) `waterfowl` (from source) | `yay -S waterfowl` | ⏳ | — |
| 3 | Scoop (Windows) | `scoop install waterfowl` | ⏳ | — |
| 4 | winget (Windows) | `winget install waterfowl` | ⏳ | code signing (recommended) |
| 5 | Chocolatey (Windows) | `choco install waterfowl` | ⏳ | code signing (recommended) |
| 6 | Homebrew Cask (macOS) — own tap | `brew install --cask fosslife/tap/waterfowl` | ⏳ | macOS notarization |
| 7 | Homebrew Cask — `homebrew/cask` central | `brew install --cask waterfowl` | ⏳ | notarization + popularity |
| 8 | Flathub (Linux, all distros) | `flatpak install flathub <id>` | ⏳ | — |
| 9 | Snap Store (Linux) | `snap install waterfowl` | ⏳ | — |
| 10 | Self-hosted apt repo (Debian/Ubuntu) | `apt install waterfowl` | ⏳ | GPG repo key + hosting |
| 11 | Ubuntu PPA (Launchpad) | `add-apt-repository ppa:…` | ❌ | (alt to #10) |
| 12 | Self-hosted dnf repo (Fedora/RHEL) | `dnf install waterfowl` | ⏳ | GPG repo key + hosting |
| 13 | Fedora COPR | `dnf copr enable …` | ❌ | (alt to #12) |
| 14 | Official Debian | `apt install waterfowl` | ❌ | sponsor + ITP |
| 15 | Official Fedora | `dnf install waterfowl` | ❌ | sponsor + review |
| 16 | Official Arch `[extra]` | `pacman -S waterfowl` | ❌ | Package Maintainer adoption |

---

## Cross-cutting prerequisites (the real gates)

These block multiple channels. Track them here.

| Prereq | Needed for | Status | Notes |
| --- | --- | --- | --- |
| GitHub Releases automation | everything | ✅ | `tauri-action` already attaches all bundles |
| Stable download URLs + checksums | all "you push" channels | ✅ | URL base known; checksums computed per release |
| Windows code signing (Authenticode OV/EV) | winget, choco (recommended) | ⏳ | unsigned ⇒ SmartScreen warnings |
| macOS Developer ID + notarization | Homebrew Cask | ⏳ | unsigned ⇒ Gatekeeper blocks |
| GPG repo signing key | apt/dnf self-hosted repos | ⏳ | — |
| x86_64 macOS build | Intel mac users | ⏳ | CI currently aarch64 only (commented out in release.yml) |
| **Updater vs package-manager conflict** | all packaged builds | 🚧 | Design DECIDED (Strategy A, runtime guard), not yet implemented. `Welcome.tsx:29-63` currently silently auto-installs over any install. Full spec in "Open decisions" §1. **Do before publishing widely.** |

---

## Per-channel detail & checklists

### 1. AUR — `waterfowl-bin` 🚧 (STARTED HERE)

**Approach:** repackage the released `.deb` (contains `/usr/bin/waterfowl`, `.desktop`, icons). Standard for Tauri apps on AUR.

Files: `packaging/aur/waterfowl-bin/`
- [x] `PKGBUILD`
- [x] `.SRCINFO` (generated with `makepkg --printsrcinfo > .SRCINFO`)
- [x] Local build test: `makepkg -f` succeeds; package ships `/usr/bin/waterfowl`, `.desktop`, 3 icon sizes — verified
- [x] Install + launch test: `makepkg -si` then `waterfowl` — **launches fine on Arch (verified 2026-05-29)**
- [ ] Create AUR account + add SSH key (https://aur.archlinux.org)  ← **next for this thread**
- [ ] `git clone ssh://aur@aur.archlinux.org/waterfowl-bin.git`, copy in `PKGBUILD` + `.SRCINFO`, push
- [ ] Verify `yay -S waterfowl-bin` works on a clean-ish system

> **Note:** upstream `.desktop` is still the Tauri template default (`Comment=A Tauri App`, empty `Categories`). Cosmetic, baked into the bundle — fix in `tauri.conf.json` bundle config, not here.

**Runtime deps (Arch):** `webkit2gtk-4.1`, `gtk3` (pull cairo/glib/etc transitively).

### 2. AUR — `waterfowl` (build from source) ⏳
Compiles via `cargo`/`pnpm` in `build()`. Heavier; needs `rust`, `pnpm`, `nodejs`, webkit dev headers as `makedepends`. Do after `-bin` is proven.

### 3. Scoop (Windows) ⏳
Easiest Windows channel. JSON manifest in a bucket (own repo `fosslife/scoop-bucket` or submit to `extras`). Points at the NSIS `.exe` + SHA256. Supports `autoupdate`.

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

### 1. Updater strategy for packaged builds — ✅ DECIDED (Strategy A), ⏳ NOT YET IMPLEMENTED

**The problem (verified in code 2026-05-29):**
- `src/pages/Welcome.tsx:29-63` — a `useEffect` runs on mount and **silently auto-installs**: `check()` → `downloadAndInstall()` → `relaunch()`. No user confirmation, no gate.
- `src-tauri/src/lib.rs:34` — `tauri_plugin_updater::Builder::new().build()` registers the plugin unconditionally.
- `tauri.conf.json` — `createUpdaterArtifacts: true`; updater endpoint = the GitHub `latest.json`.
- On a pacman/apt/etc install the binary is at `/usr/bin/waterfowl` (root-owned, package-tracked). Self-update either errors (Linux) or corrupts package-tracked files (Win/macOS). Must be gated.

**Key constraint:** the "am I packaged?" signal must come from the **install environment**, not the binary — because the channels that hurt most reuse the *identical* prebuilt artifact (AUR `-bin` repackages the CI `.deb`; winget/choco run the stock NSIS `.exe`; Homebrew Cask installs the stock `.dmg`). They never recompile, so a compile-time flag can't reach them.

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

**Also worth doing (UX, not strictly packaging):** replace the silent auto-install with "notify + user clicks update". Friendlier, and lets packaged builds show "updates are managed by your package manager" instead.

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
