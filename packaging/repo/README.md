# `fosslife/packages` — apt + dnf repository (multi-app)

A single self-hosted, GPG-signed apt **and** dnf repository for all Fosslife desktop
apps, served free from GitHub Pages. Each app's release drops its `.deb`/`.rpm` into a
shared pool; one signing key covers everything.

> **This directory is the kit.** It's staged inside the `waterfowl` repo
> (`packaging/repo/`) during Phase-1 wiring. **Deploy step:** copy these files into the
> root of the real `fosslife/packages` repo's **`main`** branch. Validation + first
> publish are Phase 2 (user-owned) — see `packaging/DISTRIBUTION.md`.

## Layout

```
main branch (this kit):
  scripts/add-release.sh     # download an app release's *.deb/*.rpm into the tree
  scripts/build-repo.sh      # (re)generate + GPG-sign apt & dnf metadata
  .github/workflows/publish.yml
  site/index.html            # install-instructions landing page
  keys/fosslife-packages.asc # <- you commit the PUBLIC key here (see keys/README.md)

gh-pages branch (generated, served by Pages):
  index.html
  fosslife-packages.asc      # public key
  deb/  pool/*.deb  Packages  Packages.gz  Release  InRelease  Release.gpg
  rpm/  *.rpm  repodata/...  repodata/repomd.xml.asc
```

## One-time setup (done / to confirm)

1. ✅ Repo `fosslife/packages` created, MIT licensed.
2. ✅ Signing key generated (`Fosslife Packages`, fpr `A336A8D1D686BFCF46FFFF7B30EF7740D6BC79A7`);
   org Actions secrets `GPG_PRIVATE_KEY` (base64) + `GPG_PASSPHRASE` set.
3. ✅ Public key committed to `keys/fosslife-packages.asc`.
4. ✅ `GPG_KEY_ID` pinned to the key fingerprint in `publish.yml` + `build-repo.sh`.
5. ⬜ Create an empty `gh-pages` branch, then **Settings → Pages → Source = `gh-pages` / root**.

## Publishing a release

**Manual:** Actions → *Publish packages repo* → Run workflow → `app_repo=fosslife/waterfowl`,
`tag=Waterfowl-v0.2.2`. The workflow ingests, signs, and pushes `gh-pages`.

**Auto-trigger from an app repo** (optional, Phase 2): add a job to the app's release
workflow that fires a cross-repo dispatch (needs a PAT with `repo` scope on
`fosslife/packages`, stored as `PACKAGES_DISPATCH_TOKEN`):

```yaml
- name: Notify packages repo
  run: |
    curl -fsSL -X POST \
      -H "Authorization: token ${{ secrets.PACKAGES_DISPATCH_TOKEN }}" \
      -H "Accept: application/vnd.github+json" \
      https://api.github.com/repos/fosslife/packages/dispatches \
      -d '{"event_type":"new-release","client_payload":{"app_repo":"${{ github.repository }}","tag":"${{ github.ref_name }}"}}'
```

## Phase-2 validation checklist (user, on real machines)

- [ ] `rpm --addsign` macro works on the CI runner's rpm version (the `%__gpg_sign_cmd`
      line is the fiddly bit; adjust if signing errors).
- [ ] Debian/Ubuntu box: add key + `.list`, `apt update`, `apt install waterfowl`.
- [ ] Fedora box: add `.repo`, `dnf install waterfowl` (confirm `repo_gpgcheck` +
      per-rpm `gpgcheck` both pass).
- [ ] `WATERFOWL_PACKAGED` story: apt/dnf installs land in `/usr/bin` (no `$APPIMAGE`),
      so the updater guard already disables self-update — nothing extra needed.
