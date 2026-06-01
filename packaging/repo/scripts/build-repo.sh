#!/usr/bin/env bash
# Regenerate + GPG-sign apt and dnf repository metadata for the Fosslife packages repo.
#
# Operates on a published tree ($REPO_DIR) that already contains:
#   $REPO_DIR/deb/pool/*.deb     (apt package pool — flat repo)
#   $REPO_DIR/rpm/*.rpm          (dnf packages)
# add-release.sh drops new packages there; this script (re)builds the signed indexes
# over *everything* currently present, so old versions stay listed.
#
# Requires (CI installs these): dpkg-dev, apt-utils, createrepo-c, rpm, gnupg,
# and a signing key already imported into the gpg keyring.
#
# Env:
#   REPO_DIR        root of the published tree            (default: ./public)
#   GPG_KEY_ID      signing key fingerprint (or uid)      (default: the Fosslife Packages key)
#   GPG_PASSPHRASE  passphrase for the key (loopback)     (required)
set -euo pipefail

REPO_DIR="${REPO_DIR:-public}"
# Fingerprint of "Fosslife Packages <zetabytes.pp@gmail.com>" — unambiguous vs a name substring.
GPG_KEY_ID="${GPG_KEY_ID:-A336A8D1D686BFCF46FFFF7B30EF7740D6BC79A7}"
: "${GPG_PASSPHRASE:?GPG_PASSPHRASE required}"

gpg_sign() { # gpg_sign <gpg-args...>
  gpg --batch --yes --pinentry-mode loopback \
      --passphrase "$GPG_PASSPHRASE" \
      --local-user "$GPG_KEY_ID" "$@"
}

# ---------- APT (flat repo under deb/) ----------
# Consumed by:  deb [signed-by=/usr/share/keyrings/fosslife.gpg] https://…/packages/deb ./
build_apt() {
  local d="$REPO_DIR/deb"
  if [ ! -d "$d/pool" ]; then echo ">> apt: no $d/pool, skipping"; return; fi
  echo ">> apt: indexing $(ls -1 "$d"/pool/*.deb 2>/dev/null | wc -l) package(s)"
  (
    cd "$d"
    dpkg-scanpackages --multiversion pool /dev/null > Packages
    gzip -9c Packages > Packages.gz
    apt-ftparchive \
      -o APT::FTPArchive::Release::Origin=Fosslife \
      -o APT::FTPArchive::Release::Label=Fosslife \
      -o APT::FTPArchive::Release::Suite=stable \
      -o APT::FTPArchive::Release::Codename=stable \
      -o APT::FTPArchive::Release::Architectures=amd64 \
      -o APT::FTPArchive::Release::Components=main \
      release . > Release
    rm -f InRelease Release.gpg
    gpg_sign --clearsign -o InRelease Release   # inline-signed (preferred by modern apt)
    gpg_sign -abs       -o Release.gpg Release   # detached (compat)
  )
}

# ---------- DNF (under rpm/) ----------
# Consumed by a .repo with gpgcheck=1 + repo_gpgcheck=1, so we sign BOTH the rpms
# (rpm --addsign) and the repo metadata (detached sig of repomd.xml).
build_dnf() {
  local d="$REPO_DIR/rpm"
  shopt -s nullglob
  local rpms=("$d"/*.rpm)
  if [ "${#rpms[@]}" -eq 0 ]; then echo ">> dnf: no rpms, skipping"; return; fi
  echo ">> dnf: signing ${#rpms[@]} rpm(s)"
  cat > "$HOME/.rpmmacros" <<EOF
%_signature gpg
%_gpg_name ${GPG_KEY_ID}
%__gpg_sign_cmd %{__gpg} gpg --batch --yes --no-armor --pinentry-mode loopback --passphrase "${GPG_PASSPHRASE}" -u "%{_gpg_name}" -sbo %{__signature_filename} %{__plaintext_filename}
EOF
  rpm --addsign "${rpms[@]}"

  echo ">> dnf: createrepo_c"
  createrepo_c --update "$d"
  rm -f "$d/repodata/repomd.xml.asc"
  gpg_sign --detach-sign --armor "$d/repodata/repomd.xml"
}

build_apt
build_dnf
echo ">> done."
