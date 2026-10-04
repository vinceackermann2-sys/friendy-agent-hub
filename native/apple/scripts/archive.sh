#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -f Config/Developer.xcconfig ]]; then
  echo 'Set Team ID and bundle ID in Config/Developer.xcconfig before signing.' >&2
  exit 1
fi
SDK=$(xcrun --sdk iphoneos --show-sdk-version)
if [[ "${SDK%%.*}" -lt 26 ]]; then echo 'App Store uploads require Xcode 26 / iOS 26 SDK or later.' >&2; exit 1; fi
xcodegen generate
xcodebuild -project Belna.xcodeproj -scheme Belna -configuration Release \
  -destination 'generic/platform=iOS' -archivePath build/Belna.xcarchive \
  -allowProvisioningUpdates archive
echo 'Archive saved in build/Belna.xcarchive. Open Xcode Organizer to validate and upload to TestFlight.'
