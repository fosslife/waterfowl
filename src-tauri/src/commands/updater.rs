//! Updater gate.
//!
//! The bundled Tauri updater must only self-update *directly downloaded*
//! builds. Package-manager installs (AUR, apt, dnf, winget, choco, Homebrew,
//! Flatpak, Snap) own their files and track versions themselves — letting the
//! app self-update over them either errors or corrupts package-tracked files.
//!
//! The "am I packaged?" signal comes from the install *environment*, not a
//! compile-time flag: the channels that hurt most reuse the identical prebuilt
//! artifact (AUR `-bin` repackages the CI `.deb`, winget/choco run the stock
//! NSIS `.exe`, Homebrew Cask installs the stock `.dmg`), so they never
//! recompile and a build flag could never reach them.

/// Whether the in-app updater is allowed to run for this install.
#[tauri::command]
pub fn updater_allowed() -> bool {
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
