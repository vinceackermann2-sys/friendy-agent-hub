#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Explicit workflow run only. Credentials stay in an ephemeral runner keychain.
: "${APPLE_DISTRIBUTION_P12_BASE64:?App signing certificate is required}"
: "${APPLE_DISTRIBUTION_PASSWORD:?App signing password is required}"
: "${APPLE_MAC_PROFILE_BASE64:?Mac Catalyst App Store profile is required}"
: "${APPLE_MAC_INSTALLER_P12_BASE64:?Mac Installer Distribution certificate is required}"
: "${APPLE_MAC_INSTALLER_PASSWORD:?Installer signing password is required}"
: "${RUNNER_TEMP:?Run on the macOS build runner}"
: "${BELNA_BUILD_NUMBER:?Unique build number is required}"
SDK=$(xcrun --sdk macosx --show-sdk-version)
test "${SDK%%.*}" -ge 26
SIGNING_DIR=$(mktemp -d "$RUNNER_TEMP/belna-mac-signing.XXXXXX")
KEYCHAIN="$SIGNING_DIR/build.keychain-db"
KEYCHAIN_PASSWORD=$(uuidgen)
PROFILE_FILE=''
cleanup() {
  security delete-keychain "$KEYCHAIN" >/dev/null 2>&1 || true
  [[ -z "$PROFILE_FILE" ]] || rm -f "$PROFILE_FILE"
  rm -rf "$SIGNING_DIR"
}
trap cleanup EXIT
printf '%s' "$APPLE_DISTRIBUTION_P12_BASE64" | base64 --decode > "$SIGNING_DIR/app.p12"
printf '%s' "$APPLE_MAC_INSTALLER_P12_BASE64" | base64 --decode > "$SIGNING_DIR/installer.p12"
printf '%s' "$APPLE_MAC_PROFILE_BASE64" | base64 --decode > "$SIGNING_DIR/app.provisionprofile"
security cms -D -i "$SIGNING_DIR/app.provisionprofile" > "$SIGNING_DIR/profile.plist"
PROFILE_UUID=$(python3 - "$SIGNING_DIR/profile.plist" <<'PY'
import datetime, plistlib, sys
with open(sys.argv[1], 'rb') as file:
    profile = plistlib.load(file)
entitlements = profile['Entitlements']
assert profile['TeamIdentifier'] == ['6XD78664VT'], 'Wrong profile team'
identifier = entitlements.get('com.apple.application-identifier', entitlements.get('application-identifier'))
assert identifier == '6XD78664VT.se.belna.app', 'Wrong app identifier'
assert 'OSX' in profile['Platform'], 'Mac profile required'
assert profile['ExpirationDate'] > datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None), 'Profile expired'
assert 'Default' in entitlements.get('com.apple.developer.applesignin', []), 'Apple sign-in missing'
assert not entitlements.get('get-task-allow', entitlements.get('com.apple.security.get-task-allow', False)), 'Distribution profile required'
assert not profile.get('ProvisionedDevices') and not profile.get('ProvisionsAllDevices'), 'Mac App Store profile required'
print(profile['UUID'])
PY
)
PROFILE_DIRECTORY="$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"
mkdir -p "$PROFILE_DIRECTORY"
PROFILE_FILE="$PROFILE_DIRECTORY/$PROFILE_UUID.provisionprofile"
cp "$SIGNING_DIR/app.provisionprofile" "$PROFILE_FILE"
security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
security set-keychain-settings -lut 21600 "$KEYCHAIN"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
security import "$SIGNING_DIR/app.p12" -P "$APPLE_DISTRIBUTION_PASSWORD" -A -t cert -f pkcs12 -k "$KEYCHAIN" >/dev/null
security import "$SIGNING_DIR/installer.p12" -P "$APPLE_MAC_INSTALLER_PASSWORD" -A -t cert -f pkcs12 -k "$KEYCHAIN" >/dev/null
security list-keychains -d user -s "$KEYCHAIN"
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN" >/dev/null
security find-certificate -c '3rd Party Mac Developer Installer' -p "$KEYCHAIN" > "$SIGNING_DIR/installer.pem"
INSTALLER_SHA=$(openssl x509 -in "$SIGNING_DIR/installer.pem" -noout -fingerprint -sha1 | cut -d= -f2 | tr -d ':')
[[ "$INSTALLER_SHA" =~ ^[A-Fa-f0-9]{40}$ ]] || exit 1
xcodegen generate
xcodebuild -project Belna.xcodeproj -scheme Belna -configuration Release \
  -destination 'generic/platform=macOS,variant=Mac Catalyst' -archivePath build/BelnaMac.xcarchive \
  DEVELOPMENT_TEAM=6XD78664VT CODE_SIGN_STYLE=Manual \
  CODE_SIGN_IDENTITY='Apple Distribution' PROVISIONING_PROFILE_SPECIFIER="$PROFILE_UUID" \
  CURRENT_PROJECT_VERSION="$BELNA_BUILD_NUMBER" archive
APP_PATH="$PWD/build/BelnaMac.xcarchive/Products/Applications/Belna.app"
codesign --verify --deep --strict --verbose=2 "$APP_PATH"
codesign -d --entitlements :- "$APP_PATH" > "$SIGNING_DIR/app-entitlements.plist"
python3 - "$APP_PATH/Contents/Info.plist" "$SIGNING_DIR/app-entitlements.plist" <<'PY'
import plistlib, sys
with open(sys.argv[1], 'rb') as file:
    info = plistlib.load(file)
with open(sys.argv[2], 'rb') as file:
    entitlements = plistlib.load(file)
assert info['CFBundleIdentifier'] == 'se.belna.app', 'Wrong archived bundle ID'
assert entitlements.get('com.apple.security.app-sandbox') is True, 'Sandbox missing'
assert 'Default' in entitlements.get('com.apple.developer.applesignin', []), 'Apple sign-in missing'
assert not entitlements.get('com.apple.security.get-task-allow', False), 'Debug signature forbidden'
assert not entitlements.get('com.apple.developer.healthkit', False), 'Mac target must not request iOS HealthKit entitlement'
PY
python3 - "$PROFILE_UUID" "$INSTALLER_SHA" "$SIGNING_DIR/export.plist" <<'PY'
import plistlib, sys
with open(sys.argv[3], 'wb') as file:
    plistlib.dump({'method':'app-store-connect', 'destination':'export', 'teamID':'6XD78664VT',
        'signingStyle':'manual', 'signingCertificate':'Apple Distribution',
        'installerSigningCertificate':sys.argv[2],
        'provisioningProfiles':{'se.belna.app':sys.argv[1]},
        'manageAppVersionAndBuildNumber':False}, file)
PY
xcodebuild -exportArchive -archivePath build/BelnaMac.xcarchive \
  -exportOptionsPlist "$SIGNING_DIR/export.plist" -exportPath build/mac-export
PACKAGES=(build/mac-export/*.pkg)
[[ ${#PACKAGES[@]} == 1 && -f "${PACKAGES[0]}" ]] || exit 1
PACKAGE_PATH="$PWD/${PACKAGES[0]}"
pkgutil --check-signature "$PACKAGE_PATH"
if [[ "${BELNA_UPLOAD_MAC:-false}" == true ]]; then
  : "${APPLE_ASC_KEY_ID:?App Store Connect upload key ID is required}"
  : "${APPLE_ASC_ISSUER_ID:?App Store Connect issuer ID is required}"
  : "${APPLE_ASC_PRIVATE_KEY_BASE64:?App Store Connect upload key is required}"
  [[ "$APPLE_ASC_KEY_ID" =~ ^[A-Z0-9]{10}$ ]] || exit 1
  mkdir -m 700 "$SIGNING_DIR/private_keys"
  printf '%s' "$APPLE_ASC_PRIVATE_KEY_BASE64" | base64 --decode > "$SIGNING_DIR/private_keys/AuthKey_$APPLE_ASC_KEY_ID.p8"
  chmod 600 "$SIGNING_DIR/private_keys/AuthKey_$APPLE_ASC_KEY_ID.p8"
  cd "$SIGNING_DIR"
  xcrun altool --upload-app --type osx --file "$PACKAGE_PATH" \
    --apiKey "$APPLE_ASC_KEY_ID" --apiIssuer "$APPLE_ASC_ISSUER_ID"
fi
