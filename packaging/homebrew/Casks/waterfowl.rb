cask "waterfowl" do
  version "0.2.2"
  sha256 "aa502740a45d18deeb0e3fbe2aaf7981872515ccf724e4b9419d37483ec54c71"

  url "https://github.com/fosslife/waterfowl/releases/download/Waterfowl-v#{version}/waterfowl_#{version}_aarch64.dmg",
      verified: "github.com/fosslife/waterfowl/"
  name "Waterfowl"
  desc "Desktop PostgreSQL database manager"
  homepage "https://github.com/fosslife/waterfowl"

  livecheck do
    url :url
    strategy :github_latest
    regex(/^Waterfowl[._-]v?(\d+(?:\.\d+)+)$/i)
  end

  # The app ships Tauri's own updater (allowed on macOS — installs to /Applications,
  # no root-owned files to corrupt), so let it self-update instead of `brew upgrade`.
  auto_updates true

  # aarch64-only today (CI builds Apple Silicon; Intel is commented out in release.yml).
  # arm64 macOS starts at Big Sur, so that's the implicit floor.
  depends_on arch: :arm64
  depends_on macos: ">= :big_sur"

  app "waterfowl.app"

  zap trash: [
    "~/Library/Application Support/com.fosslife.waterfowl",
    "~/Library/Caches/com.fosslife.waterfowl",
    "~/Library/Preferences/com.fosslife.waterfowl.plist",
    "~/Library/Saved Application State/com.fosslife.waterfowl.savedState",
    "~/Library/WebKit/com.fosslife.waterfowl",
  ]
end
