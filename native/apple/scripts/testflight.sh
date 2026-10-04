#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Called only by an explicit signed workflow run. Never print credentials.
: "${APPLE_DISTRIBUTION_P12_BASE64:?Signing certificate is required}"
: "${APPLE_DISTRIBUTION_PASSWORD:?Signing certificate password is required}"
: "${APPLE_IOS_PROFILE_BASE64:?App Store provisioning profile is required}"
: "${RUNNER_TEMP:?Run on the macOS build runner}"
: "${BELNA_BUILD_NUMBER:?Unique build number is required}"
SDK=$(xcrun --sdk iphoneos --show-sdk-version)
test "${SDK%%.*}" -ge 26
SIGNING_DIR=$(mktemp -d "$RUNNER_TEMP/belna-signing.XXXXXX")
KEYCHAIN="$SIGNING_DIR/build.keychain-db"
KEYCHAIN_PASSWORD=$(uuidgen)
PROFILE_FILE=''
cleanup() {
  security delete-keychain "$KEYCHAIN" >/dev/null 2>&1 || true
  [[ -z "$PROFILE_FILE" ]] || rm -f "$PROFILE_FILE"
  rm -rf "$SIGNING_DIR"
  rm -rf private_keys
}
trap cleanup EXIT
printf '%s' "$APPLE_DISTRIBUTION_P12_BASE64" | base64 --decode > "$SIGNING_DIR/distribution.p12"
printf '%s' "$APPLE_IOS_PROFILE_BASE64" | base64 --decode > "$SIGNING_DIR/app.mobileprovision"
security cms -D -i "$SIGNING_DIR/app.mobileprovision" > "$SIGNING_DIR/profile.plist"
PROFILE_UUID=$(python3 - "$SIGNING_DIR/profile.plist" <<'PY'
import datetime, plistlib, sys
with open(sys.argv[1], 'rb') as file:
    profile = plistlib.load(file)
assert profile['TeamIdentifier'] == ['6XD78664VT'], 'Provisioning profile belongs to another team'
assert profile['Entitlements']['application-identifier'] == '6XD78664VT.se.belna.app', 'Wrong app identifier'
assert profile['ExpirationDate'] > datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None), 'Profile expired'
assert profile['Entitlements'].get('com.apple.developer.healthkit') is True, 'HealthKit missing'
assert 'Default' in profile['Entitlements'].get('com.apple.developer.applesignin', []), 'Apple sign-in missing'
assert not profile.get('ProvisionedDevices') and not profile.get('ProvisionsAllDevices'), 'App Store profile required'
print(profile['UUID'])
PY
)
PROFILE_DIRECTORY="$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"
mkdir -p "$PROFILE_DIRECTORY"
PROFILE_FILE="$PROFILE_DIRECTORY/$PROFILE_UUID.mobileprovision"
cp "$SIGNING_DIR/app.mobileprovision" "$PROFILE_FILE"
security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
security set-keychain-settings -lut 21600 "$KEYCHAIN"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
security import "$SIGNING_DIR/distribution.p12" -P "$APPLE_DISTRIBUTION_PASSWORD" -A -t cert -f pkcs12 -k "$KEYCHAIN" >/dev/null
security list-keychains -d user -s "$KEYCHAIN"
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN" >/dev/null
xcodegen generate
xcodebuild -project Belna.xcodeproj -scheme Belna -configuration Release \
  -destination 'generic/platform=iOS' -archivePath build/Belna.xcarchive \
  DEVELOPMENT_TEAM=6XD78664VT CODE_SIGN_STYLE=Manual \
  CODE_SIGN_IDENTITY='Apple Distribution' PROVISIONING_PROFILE_SPECIFIER="$PROFILE_UUID" \
  CURRENT_PROJECT_VERSION="$BELNA_BUILD_NUMBER" archive
python3 - "$PROFILE_UUID" "$SIGNING_DIR/export.plist" <<'PY'
import plistlib, sys
with open(sys.argv[2], 'wb') as file:
    plistlib.dump({'method':'app-store-connect','destination':'export','teamID':'6XD78664VT',
        'signingStyle':'manual','signingCertificate':'Apple Distribution',
        'provisioningProfiles':{'se.belna.app':sys.argv[1]},
        'manageAppVersionAndBuildNumber':False}, file)
PY
xcodebuild -exportArchive -archivePath build/Belna.xcarchive \
  -exportOptionsPlist "$SIGNING_DIR/export.plist" -exportPath build/export
if [[ "${BELNA_UPLOAD_TESTFLIGHT:-false}" == true ]]; then
  : "${APPLE_ASC_KEY_ID:?App Store Connect upload key ID is required}"
  : "${APPLE_ASC_ISSUER_ID:?App Store Connect issuer ID is required}"
  : "${APPLE_ASC_PRIVATE_KEY_BASE64:?App Store Connect upload key is required}"
  [[ "$APPLE_ASC_KEY_ID" =~ ^[A-Z0-9]{10}$ ]] || exit 1
  mkdir -m 700 private_keys
  printf '%s' "$APPLE_ASC_PRIVATE_KEY_BASE64" | base64 --decode > "private_keys/AuthKey_$APPLE_ASC_KEY_ID.p8"
  chmod 600 "private_keys/AuthKey_$APPLE_ASC_KEY_ID.p8"
  xcrun altool --upload-app --type ios --file build/export/Belna.ipa \
    --apiKey "$APPLE_ASC_KEY_ID" --apiIssuer "$APPLE_ASC_ISSUER_ID"
fi
