# Flatpak / Flathub — `com.fosslife.waterfowl`

Flatpak manifest for Waterfowl, built by **repackaging the released `.deb`** (the GNOME
runtime already ships the GTK3 + WebKitGTK-4.1 + libsoup3 that the prebuilt Tauri binary
links against, so there's no need to compile from source in the network-less build sandbox).

## Files

| File | Role |
| ---- | ---- |
| `com.fosslife.waterfowl.yaml` | Flatpak manifest (runtime `org.gnome.Platform//47`, deb-extraction module) |
| `com.fosslife.waterfowl.desktop` | Corrected desktop entry (the deb's baked-in one is the Tauri template default) |
| `com.fosslife.waterfowl.metainfo.xml` | AppStream metainfo (Flathub requirement) |

## Verified in Phase 1 (2026-06-01)

- ✅ `desktop-file-validate` — clean.
- ✅ `appstreamcli validate` — clean.
- ✅ Deb-extraction commands run against the real `waterfowl_0.2.2_amd64.deb`
  (sha256 `d075e7a9…0e8757`); `usr/bin/waterfowl` lands correctly.
- ✅ Binary's `NEEDED` libs (`libwebkit2gtk-4.1`, `libjavascriptcoregtk-4.1`,
  `libsoup-3.0`, `libgtk-3`) are all provided by `org.gnome.Platform//47`.

## Phase-2 (user, on a machine with flatpak)

```bash
flatpak install -y flathub org.gnome.Platform//47 org.gnome.Sdk//47
flatpak-builder --user --install --force-clean build-dir com.fosslife.waterfowl.yaml
flatpak run com.fosslife.waterfowl        # launch + connect to a Postgres server
```

Then, to submit to Flathub:

1. Add a **real screenshot** that the metainfo URL resolves to (Flathub validation
   downloads it). Update the `<screenshot>` URL + the `<release>` date in the metainfo.
2. Fork `flathub/flathub`, create a branch named `com.fosslife.waterfowl`, add the
   manifest (+ the two local-source files), open a PR. The Flathub bot builds & reviews.
3. On each new release: bump `url` + `sha256` of the `.deb` source and add a
   `<release>` entry. (Flathub's external-data/update bots can automate this later.)

## Notes

- **Updater guard:** a Flatpak install has no `$APPIMAGE`, so `updater_allowed` already
  returns `false` on Linux — the in-app updater stays off and Flathub owns updates. No
  extra work.
- **Runtime version:** `47` is pinned; bump to the current GNOME runtime as needed
  (any of 46/47/48 ship webkit2gtk-4.1).
- **x86_64 only** today (matches the released `.deb`). aarch64 would need an arm64 `.deb`
  source + an `only-arches` split.
