# Update flow — how a new release reaches users

> Companion to `DISTRIBUTION.md` (channel setup) and `repo/NEW-APP.md` (adding new apps).
> This doc answers: **when I cut a new release, who updates automatically and who doesn't?**

## TL;DR

**Nothing auto-updates by default.** Cutting a release only rebuilds the GitHub Release.
Every package channel needs its pointer bumped before users see the new version. Each can be
automated, but none is wired up yet (except the GitHub Release itself).

## Key constraint: packaged Linux installs do NOT self-update

The updater guard (`src-tauri/src/commands/updater.rs`) disables the in-app Tauri updater
whenever there's no `$APPIMAGE` (i.e. every apt/dnf/AUR/Flatpak install) or when
`WATERFOWL_PACKAGED` is set. This is intentional — the package manager owns updates. So for
packaged Linux users, **the only way they get a new version is if you re-publish to that
channel.** That's why the propagation below matters.

(Direct downloads — AppImage / `.dmg` / `.exe` — keep the in-app updater ON and self-update.)

## Per-channel update flow

| Channel | Auto on release? | What a new release needs | Automatable via |
| ------- | ---------------- | ------------------------ | --------------- |
| **GitHub Release** | ✅ already | nothing — `tauri-action` builds + uploads on push | done |
| **AUR `<app>-bin`** | ❌ no | bump `pkgver`, new `.deb` sha256, `pkgrel=1`, regen `.SRCINFO`, **push to AUR** | CI job + AUR deploy key |
| **apt + dnf** | ❌ no | re-run `publish.yml` with the new tag | cross-repo dispatch snippet |
| **Flathub** | ❌ no (manual after merge) | bump `.deb` url + sha256 in the `flathub/<app-id>` repo, push → buildbot rebuilds | `flatpak-external-data-checker` |
| **Scoop** | ⚠️ scaffolded | `checkver`+`autoupdate` are in the manifest but must be *run* | scheduled Action (excavator-style) |
| **winget** | ❌ no | `wingetcreate update` + PR | wingetcreate bot / Action |
| **Homebrew** | ❌ no | `brew bump-cask-pr` | bump-cask-pr Action |

---

## Linux detail

### AUR — never automatic

AUR is just a git repo of build recipes. `yay`/`paru` users only see the new version **after
you push the bumped PKGBUILD**; until then `yay -Syu` shows nothing. Each release:

```bash
# in the AUR repo working copy: edit PKGBUILD → pkgver=<new>, pkgrel=1,
#   sha256sums=<sha256 of the new amd64 .deb>
makepkg --printsrcinfo > .SRCINFO
git commit -am "upgpkg: <new>-1"
git push aur master            # passphrase key → runs in your own terminal
```

**Automate:** a GitHub Action on the app repo that, on release, patches `pkgver`+`sha256sums`,
regenerates `.SRCINFO`, and pushes. Needs a **dedicated passphrase-less AUR SSH deploy key**
registered to the AUR account and stored as a repo secret (not your personal key).

### apt + dnf — one dispatch per release (or fully auto)

Re-run the existing publish workflow with the new tag; it ingests the new `.deb`/`.rpm` into
the shared pool, re-signs the metadata, and pushes `gh-pages`. Users then upgrade normally
(`apt update && apt upgrade` / `dnf upgrade`):

```bash
gh workflow run publish.yml -R fosslife/packages \
  -f app_repo=fosslife/<app> -f tag=<TAG>
```

**Automate:** add the cross-repo `repository_dispatch` step (documented in
`packaging/repo/README.md`, "Auto-trigger from an app repo") to the app's `release.yml` so a
release auto-fires this workflow. Needs a PAT with `repo` scope on `fosslife/packages` stored
as `PACKAGES_DISPATCH_TOKEN`.

> Pool note: old `.deb`/`.rpm` versions accumulate in the pool; apt/dnf always serve the
> newest, so this is harmless — prune occasionally if size matters.

### Flatpak — manual after merge, or bot

After the Flathub PR merges you get push access to `flathub/<app-id>`. Each release, bump the
`.deb` source `url` + `sha256` there and push; the Flatpak buildbot rebuilds and publishes,
and users get it via `flatpak update`.

**Automate:** add an `x-checker-data` block to the manifest's `.deb` source and enable
[`flatpak-external-data-checker`](https://github.com/flathub/flatpak-external-data-checker) —
it opens update PRs on your Flathub repo automatically when it detects a new GitHub release.

---

## Recommended automation order (cheapest value first)

1. **apt/dnf dispatch snippet** — near-free, covers two channels at once.
2. **AUR auto-push CI** — needs a dedicated AUR deploy key.
3. **Flathub external-data-checker** — manifest annotation; set up after the app is merged.
4. Windows/macOS bots (`wingetcreate`, `brew bump-cask-pr`, Scoop excavator) — when those
   channels go live.

None of these is wired yet. Until they are, treat a release as: **cut the GitHub release →
then bump each channel by hand using the steps above.**
