# Homebrew Cask — `fosslife/homebrew-tap`

macOS Cask for Waterfowl, distributed from a **shared own tap** that can hold a cask for
every Fosslife app. Install:

```bash
brew install --cask fosslife/tap/waterfowl
```

## Files

| File | Role |
| ---- | ---- |
| `Casks/waterfowl.rb` | The cask — points at the released aarch64 `.dmg` + sha256 |

> **Deploy:** create the repo **`fosslife/homebrew-tap`** and copy `Casks/waterfowl.rb`
> into its `Casks/` dir. Future apps = one more file in the same `Casks/` dir. The tap
> name `homebrew-tap` is referenced as `fosslife/tap` (Homebrew strips the `homebrew-`).

## Verified in Phase 1 (2026-06-01)

- ✅ Ruby syntax check (`ruby -c`) — clean.
- ✅ dmg sha256 `aa502740…54c71` computed from the real `waterfowl_0.2.2_aarch64.dmg`.
- ✅ App bundle name `waterfowl.app` confirmed from `waterfowl_aarch64.app.tar.gz`.

## Phase-2 (user, on a Mac)

```bash
brew tap fosslife/tap            # after creating the repo
brew install --cask waterfowl
brew audit --cask --online waterfowl   # Homebrew's linter
brew style waterfowl
```

### ⚠️ The real gate: notarization

The `.dmg` is **not signed/notarized** yet, so on first launch Gatekeeper will block it
("waterfowl is damaged / cannot be opened"). The cask is correct — the *app* needs an
Apple Developer ID signature + notarization for a clean install. This is the
cross-cutting "macOS notarization" prereq, not a cask bug. Until then, users must
right-click → Open or run `xattr -dr com.apple.quarantine /Applications/waterfowl.app`.

## Notes

- **`auto_updates true`** is set: the in-app Tauri updater stays on for macOS (no
  root-owned corruption there), so Homebrew won't fight it on `brew upgrade`. This matches
  the updater strategy in `packaging/DISTRIBUTION.md` (Open decisions §1).
- **Intel (x86_64):** not built today. To support it, enable the Intel CI job, then add a
  second `sha256`/`url` via `on_arm`/`on_intel` blocks and drop `depends_on arch: :arm64`.
- **Version bumps:** `brew bump-cask-pr --version <X.Y.Z> waterfowl` regenerates the
  sha256 from the new release (livecheck detects it).
