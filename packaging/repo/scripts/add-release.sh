#!/usr/bin/env bash
# Download a released app's .deb + .rpm assets from its GitHub release into the
# published tree. App-agnostic: works for waterfowl and every other Fosslife app,
# since it just grabs *.deb / *.rpm from the named release.
#
# Usage:  add-release.sh <owner/repo> <release-tag>
#   e.g.  add-release.sh fosslife/waterfowl Waterfowl-v0.2.2
#
# Requires: gh (authenticated via GH_TOKEN in CI).
# Env: REPO_DIR (default: ./public)
set -euo pipefail

APP_REPO="${1:?usage: add-release.sh <owner/repo> <release-tag>}"
TAG="${2:?usage: add-release.sh <owner/repo> <release-tag>}"
REPO_DIR="${REPO_DIR:-public}"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo ">> downloading $APP_REPO @ $TAG (*.deb, *.rpm)"
gh release download "$TAG" --repo "$APP_REPO" \
   --pattern '*.deb' --pattern '*.rpm' --dir "$tmp" --clobber

mkdir -p "$REPO_DIR/deb/pool" "$REPO_DIR/rpm"
shopt -s nullglob
for f in "$tmp"/*.deb; do echo "  + deb $(basename "$f")"; cp -f "$f" "$REPO_DIR/deb/pool/"; done
for f in "$tmp"/*.rpm; do echo "  + rpm $(basename "$f")"; cp -f "$f" "$REPO_DIR/rpm/";      done
echo ">> ingest complete."
