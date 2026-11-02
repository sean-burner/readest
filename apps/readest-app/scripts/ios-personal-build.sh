#!/usr/bin/env bash
# Build Readest for your own iPhone with your own Apple ID (free or paid) and
# install it over USB. See docs/ios-personal-build.md for the setup steps.
#
# The checked-in iOS project is set up for the Readest team's Apple account
# (team J5W48D69VR, bundle id com.bilingify.readest) and capabilities a free
# Apple ID can't sign (Sign in with Apple, iCloud, Associated Domains, CarPlay,
# App Groups). This script switches the project to your team and a bundle id
# of your own, drops those entitlements, builds a development IPA and installs
# it on the connected iPhone. The project files are put back afterwards
# (set KEEP_PATCH=1 to keep the changes, e.g. to open the project in Xcode).
#
# Options (environment variables):
#   APPLE_TEAM_ID  your 10-character team id; found from your "Apple
#                  Development" certificate when not set
#   BUNDLE_ID      default com.<your-mac-username>.readest.dev
#   SKIP_INSTALL=1 only build the IPA
#   KEEP_PATCH=1   leave the project switched to your account
set -euo pipefail

cd "$(dirname "$0")/.."
APP_DIR="$(pwd)"
GEN=src-tauri/gen/apple
PATCHED=(
  src-tauri/tauri.conf.json
  "$GEN/project.yml"
  "$GEN/Readest.xcodeproj/project.pbxproj"
  "$GEN/Readest_iOS/Readest_iOS.entitlements"
  "$GEN/ShareExtension/ShareExtension.entitlements"
  "$GEN/ReadestWidget/ReadestWidget.entitlements"
)

die() {
  echo "ios-personal-build: $*" >&2
  exit 1
}

[ "$(uname)" = "Darwin" ] || die "run this on a Mac"
command -v xcodebuild >/dev/null || die "Xcode is not installed"

if ! git diff --quiet -- "${PATCHED[@]}"; then
  die "these files have local changes; commit or discard them first: ${PATCHED[*]}"
fi

TEAM="${APPLE_TEAM_ID:-}"
if [ -z "$TEAM" ]; then
  TEAM="$(security find-certificate -c "Apple Development" -p 2>/dev/null |
    openssl x509 -noout -subject 2>/dev/null |
    sed -n 's/.*OU *= *\([A-Z0-9]\{10\}\).*/\1/p' | head -1)"
fi
[ -n "$TEAM" ] || die "no team id. Sign in to Xcode with your Apple ID first (Xcode > Settings > Accounts), or set APPLE_TEAM_ID"

USER_PART="$(id -un | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9')"
BUNDLE_ID="${BUNDLE_ID:-com.${USER_PART:-me}.readest.dev}"
echo "Team: $TEAM"
echo "Bundle id: $BUNDLE_ID"

restore() {
  if [ "${KEEP_PATCH:-0}" != "1" ]; then
    git -C "$APP_DIR" checkout -- "${PATCHED[@]}"
    echo "Project files restored."
  else
    echo "Project left switched to team $TEAM (KEEP_PATCH=1). Undo with: git checkout -- ${PATCHED[*]}"
  fi
}
trap restore EXIT

# 1. Team and bundle id.
node -e '
  const fs = require("fs");
  const f = "src-tauri/tauri.conf.json";
  const c = JSON.parse(fs.readFileSync(f, "utf8"));
  c.identifier = process.argv[1];
  c.bundle.iOS.developmentTeam = process.argv[2];
  // The deep-link plugin adds Associated Domains for app links at build time,
  // which a personal team cannot sign. Keep only the custom URL schemes.
  const dl = c.plugins && c.plugins["deep-link"];
  if (dl && Array.isArray(dl.mobile)) dl.mobile = dl.mobile.filter((m) => !m.appLink);
  fs.writeFileSync(f, JSON.stringify(c, null, 2) + "\n");
' "$BUNDLE_ID" "$TEAM"
for f in "$GEN/project.yml" "$GEN/Readest.xcodeproj/project.pbxproj"; do
  sed -i '' -e "s/com\.bilingify\.readest/${BUNDLE_ID}/g" -e "s/J5W48D69VR/${TEAM}/g" "$f"
done

# 2. Entitlements a personal team can't sign. The app runs without them; the
#    home screen widget and the share sheet can't hand data to the app.
for f in "$GEN/Readest_iOS/Readest_iOS.entitlements" \
  "$GEN/ShareExtension/ShareExtension.entitlements" \
  "$GEN/ReadestWidget/ReadestWidget.entitlements"; do
  cat >"$f" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict/>
</plist>
PLIST
done

# 3. Build a development-signed IPA.
pnpm exec dotenv -e .env.tauri -- tauri ios build --export-method debugging

IPA="$(ls -t "$GEN"/build/arm64/*.ipa 2>/dev/null | head -1 || true)"
[ -n "$IPA" ] || die "build finished but no IPA was found in $GEN/build/arm64"
echo "Built $IPA"

# 4. Install on the iPhone connected over USB.
if [ "${SKIP_INSTALL:-0}" = "1" ]; then
  exit 0
fi
command -v ideviceinstaller >/dev/null || die "install libimobiledevice first: brew install libimobiledevice ideviceinstaller"
ideviceinstaller install "$IPA" 2>/dev/null || ideviceinstaller -i "$IPA"
echo "Installed. On the iPhone, open Settings > General > VPN & Device Management and trust your Apple ID the first time."
