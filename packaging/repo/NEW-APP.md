# Releasing a new Fosslife Tauri app — Linux checklist

How to ship a brand-new desktop Tauri app (e.g. `fosslife/devtools-x`) on Linux, reusing
the shared infra already set up for Waterfowl. **Nothing here needs a new signing key, a new
repo, or new hosting** — those are shared. Per-app work is just template copies.

> Conventions used below — substitute for your app:
> | Placeholder        | Example                       |
> | ------------------ | ----------------------------- |
> | `<repo>`           | `fosslife/devtools-x`         |
> | `<app>`            | `devtools-x`                  |
> | `<app-id>`         | `com.fosslife.devtools-x`     |
> | `<TAG>`            | `Devtools-X-v0.1.0`           |

---

## The model: shared vs per-app

| Channel    | Shared?                         | Per-app work                          |
| ---------- | ------------------------------- | ------------------------------------- |
| apt + dnf  | ✅ one repo + one key for all    | **none** — just dispatch the workflow |
| AUR        | ❌ each pkg is its own AUR repo  | copy `PKGBUILD` template, swap fields |
| Flathub    | ❌ per-app repo/PR               | copy the flatpak kit, swap fields     |

---

## 0. Prerequisite (once per app)

- The app's release CI (`tauri-action`) must publish a GitHub Release whose assets include
  **`*.deb`** and **`*.rpm`** (the same asset shapes Waterfowl produces). Everything below
  consumes those assets.
- Port the **updater guard** into the app's code: an `updater_allowed` Tauri command + an
  `<APP>_PACKAGED` env opt-out, mirrored from `src-tauri/src/commands/updater.rs` in
  Waterfowl. (Package installs land in `/usr/bin` with no `$APPIMAGE`, so the guard already
  disables self-update on Linux — but the command must exist in the app.)

---

## 1. apt + dnf — shared, ~2 minutes

No new key, repo, hosting, or Pages config. The `fosslife/packages` repo pools every app's
packages behind one GPG key.

1. Confirm the release has `.deb` + `.rpm` assets:
   ```bash
   gh release view <TAG> -R <repo> --json assets -q '.assets[].name'
   ```
2. Dispatch the existing publish workflow:
   ```bash
   gh workflow run publish.yml -R fosslife/packages -f app_repo=<repo> -f tag=<TAG>
   gh run watch $(gh run list -R fosslife/packages --workflow=publish.yml -L1 --json databaseId -q '.[0].databaseId') -R fosslife/packages --exit-status
   ```
3. Done — users get it from the same repo + key already documented at
   https://fosslife.github.io/packages/ :
   ```bash
   apt install <app>      # Debian/Ubuntu
   dnf install <app>      # Fedora/RHEL
   ```

**Optional auto-publish:** add a cross-repo dispatch step to the app's `release.yml` so each
release publishes itself (needs a PAT with `repo` scope on `fosslife/packages` as
`PACKAGES_DISPATCH_TOKEN`) — snippet in `README.md` (“Auto-trigger from an app repo”).

---

## 2. AUR `<app>-bin` — per-app, copy the template

Repackages the released `.deb`. Template = Waterfowl's `packaging/aur/waterfowl-bin/`.

1. Copy `PKGBUILD`; change `pkgname=<app>-bin`, `_pkgname=<app>`, `pkgver`, `url`, `depends`
   (usually `webkit2gtk-4.1` + `gtk3`), and `sha256sums` = sha256 of the new `.deb`:
   ```bash
   curl -fsSL -o <app>.deb https://github.com/<repo>/releases/download/<TAG>/<app>_<ver>_amd64.deb
   sha256sum <app>.deb
   ```
2. Regenerate metadata:
   ```bash
   makepkg --printsrcinfo > .SRCINFO
   ```
3. Stage a clean repo (only `PKGBUILD` + `.SRCINFO`) and push — **the push runs in your own
   terminal** (the AUR SSH key is passphrase-protected):
   ```bash
   mkdir <app>-bin-aur && cd <app>-bin-aur && git init -b master
   cp /path/to/PKGBUILD /path/to/.SRCINFO .
   git add . && git commit -m "Initial import: <app>-bin <ver>-1"
   git remote add aur ssh://aur@aur.archlinux.org/<app>-bin.git
   ssh aur@aur.archlinux.org help   # verify auth first
   git push -u aur master           # creates the package
   ```

---

## 3. Flathub `<app-id>` — per-app, copy the kit

Template = Waterfowl's `packaging/flatpak/`. Repackages the `.deb` against
`org.gnome.Platform//47` (ships GTK3 + WebKitGTK-4.1 + libsoup3).

1. Copy the kit; rename the three files to `<app-id>.{yaml,desktop,metainfo.xml}` and update:
   `app-id`, `command`, the `.deb` source `url` + `sha256`, name/summary/description, icon
   install paths (renamed to `<app-id>`).
2. Commit ≥1 **real screenshot** to the app repo's `master` (Flathub validation downloads it),
   reference it in the metainfo, and set the real `<release date="…">`.
3. Keep `flathub.json` `{"only-arches": ["x86_64"]}` if the app ships an amd64-only `.deb`.
4. Validate locally:
   ```bash
   appstreamcli validate <app-id>.metainfo.xml
   desktop-file-validate <app-id>.desktop
   ```
5. Submit (base branch is **`new-pr`**, not `master`):
   - Fork `flathub/flathub`.
   - Create branch `<app-id>` off `new-pr`; add the 4 files (yaml + desktop + metainfo +
     flathub.json) — Waterfowl did this via the GitHub Git Data API since the GitHub SSH key
     is passphrase-locked; a normal `git push` from your terminal works too.
   - Open a PR against base `new-pr`, title **“Add `<app-id>`”**.
   - The Flatpak build bot builds it; respond to review. On merge, `flathub/<app-id>` is
     created and `flatpak install flathub <app-id>` works.

---

## Quick reference — what got reused (set up once for Waterfowl)

- **GPG key** `Fosslife Packages` (fpr `A336A8D1D686BFCF46FFFF7B30EF7740D6BC79A7`) — signs every app.
- **`fosslife/packages`** (apt + dnf, GitHub Pages) — one workflow dispatch per app.
- **AUR / Flathub** — per-app, but copy Waterfowl's manifests and swap the fields above.
- Windows (`fosslife/scoop-bucket`, winget) and macOS (`fosslife/homebrew-tap`) follow the
  same copy-and-swap pattern — see the main tracker `packaging/DISTRIBUTION.md`.
