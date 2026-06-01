# Waterfowl — Distribution / Packaging Tracker

> **Purpose:** single source of truth for shipping Waterfowl across package managers.
> Pick up here in any session. Update the status table as things land.

---

## 🧭 Operating principle (READ FIRST — defines what "done" means here)

**Phase 1 (now): bootstrap & wire up _every_ channel.** Author every manifest/recipe/repo-scaffold and get each one to the point where the only thing left is the user running an install on real hardware. Commit everything.

**Phase 2 (later, all at once): the _user_ validates + publishes** every package on every OS in a single dedicated pass. The user owns all on-device testing and all go-live pushes.

**Therefore — for any agent reading this:** per-channel "install test", "launch test", "Windows validation", "`scoop install`", "`makepkg -si`", AUR/bucket/PR _publishing_, etc. are **NOT blockers and NOT pending work.** They are deliberately deferred to Phase 2 and belong to the user. When asked "where are we", report progress as **how many channels are wired up (Phase 1)**, never as "stuck on testing/validation/publishing channel X." A channel with its manifest authored + committed is **done for Phase 1**, even if never installed anywhere. The only real Phase-1 blockers are missing _inputs_ the user must supply (decisions, accounts, keys, hosting, a LICENSE) — those are tracked in "What we need from the user" below.

---

## ⏭️ Pick up next (start here in a new session)

Work happens on branch **`packaging/distribution`**. The AUR `waterfowl-bin` files and this tracker are committed (`53cac10 feat: arch packaging`). Phase-1 wiring continues; nothing goes live until Phase 2.

Channels already wired up (Phase-1 done — validation/publish deferred to user, per Operating principle):

1. **AUR `waterfowl-bin`** — ✅ Phase-1 done. `PKGBUILD` + `.SRCINFO` authored and committed. (Local `makepkg -si` + launch already happened to run, but that was a bonus, not a gate.) Publish = Phase 2, user-owned. See §1.
2. ~~**Updater guard (Strategy A)**~~ — ✅ **IMPLEMENTED 2026-05-31.** `updater_allowed` command (`src-tauri/src/commands/updater.rs`), registered in `lib.rs`, guarded at the top of `checkForUpdates()` in `Welcome.tsx`. Both backend (`cargo check`) and frontend (`tsc`) compile clean.
3. **Scoop (Windows)** — ✅ Phase-1 done. Manifest at `packaging/scoop/waterfowl.json` with real verified SHA256, `env_set WATERFOWL_PACKAGED=1`, `checkver`+`autoupdate`. The `extract_dir`/`bin`-path uncertainty is a Phase-2 thing for the user to resolve on Windows — it does not block wiring up other channels. See §3.

4. **apt/dnf self-hosted repos** (§10/§12) — ✅ Phase-1 done. Multi-app GPG-signed apt+dnf repo kit authored at `packaging/repo/` (scripts + publish workflow + landing + key slot). User has created `fosslife/packages`, generated the signing key, and set the CI secrets. Deploy/validate = Phase 2.

Next channels to **wire up** (Phase 1):

5. **Flathub** (§8) — broadest Linux reach from one manifest. Authorable now (app id `com.fosslife.waterfowl`). ← **next**
6. **Homebrew tap** (§6) — `fosslife/homebrew-tap` cask; authorable now (notarization is a Phase-2 concern, not a wiring blocker).
7. **winget / choco** (§4/§5) — per-app manifests authorable now (code-signing affects UX, not wiring).

---

## 📥 What we need from the user (the only real Phase-1 gates)

These are _inputs_, not work an agent can do alone. Everything else gets wired up regardless.

### Multi-app strategy (DECIDED 2026-06-01) — shared infra across all Fosslife Tauri apps

User has **several other Tauri desktop apps** to publish, near-identical in packaging. Decision: make the **self-hosted / own-namespace channels app-agnostic and shared**, so each new app is just one more manifest/package dropped into existing infra. Templatable because all apps are Tauri.

| Channel | Shareable across apps? | Shared container |
| ------- | ---------------------- | ---------------- |
| **apt repo** | ✅ Yes — one repo = a pool of many `.deb`s | `fosslife/packages` → `…/deb/` (waterfowl + others coexist; `apt install <app>`) |
| **dnf repo** | ✅ Yes — one repo = many `.rpm`s | same repo → `…/rpm/` |
| **GPG signing key** | ✅ Yes — one key signs all repo metadata | one **"Fosslife Packages"** key, reused for every app |
| **Scoop bucket** | ✅ Yes — a bucket is a folder of manifests | `fosslife/scoop-bucket` (move `waterfowl.json` here; add others alongside) |
| **Homebrew tap** | ✅ Yes — a tap holds many casks | `fosslife/homebrew-tap` |
| AUR | ❌ No — each pkg is its own AUR git repo | `waterfowl-bin`, `<app>-bin`, … (separate, but same PKGBUILD template) |
| Flathub | ❌ No — per-app repo/PR under flathub org | per app (same manifest template) |
| winget / choco | ❌ No — central registries, per-app manifests | per app |

> **Net:** one GPG key + one `fosslife/packages` repo (apt **and** dnf) + one Scoop bucket + one Homebrew tap serve **all** your apps. AUR/Flathub/winget/choco are inherently per-app but reuse the same templates.

### For apt/dnf self-hosted repos (next target — §10/§12) — DECIDED 2026-06-01

| # | Input | Decision | Still need from user |
| - | ----- | -------- | -------------------- |
| A | **Hosting target** | ✅ **GitHub Pages, shared multi-app repo `fosslife/packages`**, published at `https://fosslife.github.io/packages/` (apt under `…/deb/`, dnf under `…/rpm/`). Sets the `deb [signed-by=…] https://fosslife.github.io/packages/deb …` line and the `.repo` `baseurl`. | Confirm name `fosslife/packages` (or preferred). Custom domain (e.g. `pkgs.fosslife.dev`) optional later. |
| B | **GPG repo-signing key** | ✅ **One dedicated key, CI-signed, reused for all apps.** Suggested UID: **`Fosslife Packages <zetabytes.pp@gmail.com>`**. Public key committed/published; private key never in the repo. | ① Confirm the UID name (`Fosslife Packages`, or specify). ② Run the keygen steps below and hold the private key. |
| C | **CI signing secrets** | ✅ **CI-signed** — GitHub Actions signs repo metadata on each release. | After keygen: add **Actions secrets** `GPG_PRIVATE_KEY` (base64 of the exported private key) + `GPG_PASSPHRASE`. I'll wire the workflow to read them. |

> **Ready to wire now (key/secrets as the only blanks):** the `.deb`/`.rpm` ingestion + `gpg` signing scripts, `Packages`/`Release`/`InRelease` (apt) + `createrepo_c` + `repomd.xml.asc` (dnf), the `.list`/`.repo` snippets, the "add our key + repo" install instructions, and a GitHub Actions release workflow that signs + publishes to Pages. **Outstanding user inputs:** UID-name confirm, repo-name confirm, and (post-keygen) the two Actions secrets.

### GPG keygen steps (run these once; output feeds the Actions secrets)

```bash
# 1. Generate a dedicated 4096-bit repo-signing key (NOT your personal key).
#    Pick a strong passphrase when prompted — you'll also store it as GPG_PASSPHRASE.
gpg --full-generate-key
#    Choose: (1) RSA and RSA · 4096 · 0 = no expiry (or e.g. 5y) ·
#    Real name: Fosslife Packages · Email: zetabytes.pp@gmail.com

# 2. Find the key id (the long hex after rsa4096/).
gpg --list-secret-keys --keyid-format=long zetabytes.pp@gmail.com

# 3. Export the PUBLIC key — this gets committed into the repo; users import it to trust the repo.
gpg --armor --export zetabytes.pp@gmail.com > fosslife-packages.asc

# 4. Export the PRIVATE key and base64 it — paste into the GitHub Actions secret GPG_PRIVATE_KEY.
gpg --armor --export-secret-keys zetabytes.pp@gmail.com | base64 -w0 > private.b64
#    Then: GitHub repo → Settings → Secrets and variables → Actions →
#      GPG_PRIVATE_KEY = contents of private.b64
#      GPG_PASSPHRASE  = the passphrase from step 1

# 5. Clean up local secret artifacts.
shred -u private.b64   # (the key stays in your gpg keyring; only the loose export is wiped)
```

> **Why a key at all:** apt and dnf refuse unsigned repos. apt signs the `Release` file (→ `InRelease`/`Release.gpg`); dnf signs `repomd.xml` (→ `repomd.xml.asc`). Users import the **public** key once, then their package manager cryptographically verifies every download came from you, untampered. The **private** key signs the metadata — it lives only in your keyring + the CI secret, never in the repo. One key covers every app's packages.

### Already-tracked decisions that gate _other_ channels (not apt/dnf)

- **LICENSE file** — ✅ **DONE 2026-06-01: MIT.** Added `/LICENSE` (`Copyright (c) 2026 Sparkenstein` — swap to legal name/"Fosslife" if preferred), set `"license": "MIT"` in `package.json`, updated Scoop manifest `"license": "MIT"`.
- **Windows code signing cert** (OV/EV Authenticode) → winget/choco UX.
- **macOS notarization** / Apple Developer Program ($99/yr) → Homebrew Cask.
- **x86_64 macOS build** — enable the commented-out Intel job in `release.yml`?

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

> "Status" = **Phase-1 wiring** status (manifest/recipe authored + committed). ✅ here does **not** mean published — all validation + go-live is Phase 2 (user-owned). "Blocked on" lists only real Phase-1 input gaps, never testing/publishing.

| #   | Channel                                 | Install command                              | Status | Blocked on                    |
| --- | --------------------------------------- | -------------------------------------------- | ------ | ----------------------------- |
| 1   | **AUR (Arch)** `waterfowl-bin`          | `yay -S waterfowl-bin`                       | ✅     | — (publish = Phase 2)         |
| 2   | AUR (Arch) `waterfowl` (from source)    | `yay -S waterfowl`                           | ⏳     | —                             |
| 3   | Scoop (Windows)                         | `scoop install waterfowl`                    | ✅     | — (publish = Phase 2)         |
| 4   | winget (Windows)                        | `winget install waterfowl`                   | ⏳     | code signing (recommended)    |
| 5   | Chocolatey (Windows)                    | `choco install waterfowl`                    | ⏳     | code signing (recommended)    |
| 6   | Homebrew Cask (macOS) — own tap         | `brew install --cask fosslife/tap/waterfowl` | ⏳     | macOS notarization            |
| 7   | Homebrew Cask — `homebrew/cask` central | `brew install --cask waterfowl`              | ⏳     | notarization + popularity     |
| 8   | Flathub (Linux, all distros)            | `flatpak install flathub <id>`               | ⏳     | —                             |
| 9   | Snap Store (Linux)                      | `snap install waterfowl`                     | ⏳     | —                             |
| 10  | Self-hosted apt repo (Debian/Ubuntu)    | `apt install waterfowl`                      | ✅     | — (publish = Phase 2)         |
| 11  | Ubuntu PPA (Launchpad)                  | `add-apt-repository ppa:…`                   | ❌     | (alt to #10)                  |
| 12  | Self-hosted dnf repo (Fedora/RHEL)      | `dnf install waterfowl`                      | ✅     | — (publish = Phase 2)         |
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
| GPG repo signing key                      | apt/dnf self-hosted repos   | ✅     | Dedicated "Fosslife Packages" key generated by user 2026-06-01; org Actions secrets `GPG_PRIVATE_KEY`+`GPG_PASSPHRASE` set. Public key → `fosslife/packages` `keys/`.                                                                     |
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
- **Phase-1 complete.** The steps below are **Phase 2 (user-owned)**, not pending agent work:
  - [ ] _(Phase 2)_ Create AUR account + add SSH key (https://aur.archlinux.org)
  - [ ] _(Phase 2)_ `git clone ssh://aur@aur.archlinux.org/waterfowl-bin.git`, copy in `PKGBUILD` + `.SRCINFO`, push
  - [ ] _(Phase 2)_ Verify `yay -S waterfowl-bin` works on a clean-ish system

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
- **Phase-1 complete.** The steps below are **Phase 2 (user-owned)**, not pending agent work:
  - [ ] _(Phase 2)_ Validate on Windows: `scoop install .\waterfowl.json`, launch, confirm `bin`/shortcut path (adjust `extract_dir` if the NSIS payload nests), confirm `WATERFOWL_PACKAGED` is set and the in-app updater is silent.
  - [ ] _(Phase 2)_ Publish: create `fosslife/scoop-bucket`, add the manifest, then `scoop bucket add fosslife https://github.com/fosslife/scoop-bucket && scoop install waterfowl`. (Submitting to `ScoopInstaller/Extras` is the broader-reach alternative; own bucket first.)

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

### 10 & 12. Self-hosted apt + dnf repos ✅ (Phase-1 WIRED 2026-06-01)

**Unified, multi-app, GPG-signed apt+dnf repo served from GitHub Pages** (`fosslife/packages`). Kit authored at **`packaging/repo/`** (staged in this repo; deploy = copy into the `fosslife/packages` `main` branch):

- `scripts/add-release.sh` — `gh release download` an app's `*.deb`/`*.rpm` into the shared tree (app-agnostic).
- `scripts/build-repo.sh` — apt flat repo (`dpkg-scanpackages` + `apt-ftparchive release` → `InRelease`/`Release.gpg`) **and** dnf (`rpm --addsign` each rpm + `createrepo_c` + detached-sign `repomd.xml`). Both syntax-checked.
- `.github/workflows/publish.yml` — `workflow_dispatch`(app_repo, tag) + `repository_dispatch`; imports the key from `GPG_PRIVATE_KEY`/`GPG_PASSPHRASE` secrets, ingests, signs, force-pushes the whole tree to `gh-pages`.
- `site/index.html` — install-instructions landing (apt `.list` + dnf `.repo` snippets, key URL).
- `keys/` — drop the **public** key as `fosslife-packages.asc`.

**Deployed copy:** user mirrored the kit to `fosslife/packages` (local: `/home/spark/projects/packages`, pushed) + added the real public key (`keys/fosslife-packages.asc`, UID `Fosslife Packages <zetabytes.pp@gmail.com>`, fpr `A336A8D1D686BFCF46FFFF7B30EF7740D6BC79A7`) + LICENSE. `GPG_KEY_ID` is now pinned to that fingerprint in both `build-repo.sh` + `publish.yml` (both locations) — re-push `packages` after this edit.

**Remaining (recorded in `packaging/repo/README.md`):** create the empty `gh-pages` branch + point Pages at it (Settings → Pages → Source = `gh-pages`/root). All install-testing on real Debian/Fedora boxes = Phase 2.

> **rpm-signing caveat (Phase-2 watch item):** the `%__gpg_sign_cmd` macro in `build-repo.sh` is the one piece most sensitive to the runner's `rpm` version — verify it signs cleanly during Phase-2 validation.

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
- **2026-06-01** — **apt/dnf wired up (Phase 1).** Authored the multi-app repo kit at `packaging/repo/`: `add-release.sh` (gh-download a release's debs/rpms), `build-repo.sh` (apt flat repo via dpkg-scanpackages+apt-ftparchive → InRelease/Release.gpg; dnf via rpm --addsign + createrepo_c + detached-signed repomd.xml — both bash-syntax-checked & executable), `publish.yml` (dispatch-triggered, imports key from secrets, pushes to gh-pages), `site/index.html` install page, `keys/` public-key slot, README with deploy + Phase-2 checklist. User confirmed `fosslife/packages` created, key generated, CI secrets set. Status #10/#12 → ✅. Next wiring target: Flathub.
- **2026-06-01** — **MIT license added** (`/LICENSE`, `package.json`, Scoop manifest). **Multi-app strategy decided:** self-hosted/own-namespace channels are shared & app-agnostic across all the user's Tauri apps — one **"Fosslife Packages"** GPG key, one `fosslife/packages` repo (apt+dnf), one `fosslife/scoop-bucket`, one `fosslife/homebrew-tap`; AUR/Flathub/winget/choco stay per-app (same templates). apt/dnf inputs decided: hosting = GitHub Pages `fosslife/packages` → `https://fosslife.github.io/packages/`; signing = one dedicated GPG key, **CI-signed** (`GPG_PRIVATE_KEY`+`GPG_PASSPHRASE`). Added GPG keygen steps to the doc. Outstanding from user: confirm repo + key UID names, run keygen, add the two Actions secrets.
- **2026-06-01** — Codified the **two-phase strategy** ("Operating principle" section): Phase 1 = wire up every channel (manifests/recipes/scaffolds authored + committed); Phase 2 = user validates + publishes everything on every OS in one pass at the end. Re-statused AUR `-bin` and Scoop as ✅ Phase-1-done (their install-tests/publishes moved to explicit Phase-2 user-owned steps) so "where are we" never reports them as stuck. Added "📥 What we need from the user" section — for the next target (apt/dnf): (A) hosting target [GitHub Pages vs own server], (B) dedicated GPG signing key [identity + where the private key lives], (C) CI-signed vs locally-signed. Plus existing gates: LICENSE, Win code-signing, macOS notarization, x86_64 mac build.
- **2026-05-31** — Started Scoop (#3): authored `packaging/scoop/waterfowl.json` (NSIS `#/dl.7z` extract pattern, `env_set WATERFOWL_PACKAGED=1` to satisfy the updater guard, `checkver`+`autoupdate`). Filled + verified the real SHA256 (`2727900900…169b57`) by downloading the official `x64-setup.exe` and hashing it (reproducible; confirmed valid NSIS PE32). Remaining: Windows `scoop install` validation (bin/extract_dir) + publish to a bucket. Noted repo has no LICENSE (manifest uses `"license": "Unknown"`).
