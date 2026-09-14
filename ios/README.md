# iPhone app

The native app is necessary because Safari cannot capture and broadcast the whole iPhone screen. ReplayKit supplies screen frames to a Broadcast Upload Extension, which publishes H.264 video through Cloudflare's WHIP endpoint.

## Generate the project

Install XcodeGen, then run from the repository root:

```bash
xcodegen generate --spec ios/project.yml --project ios
open ios/iPhoneRemote.xcodeproj
```

The WebRTC dependency is resolved through Swift Package Manager from `stasel/WebRTC`.

## Configure later

Before installing on an iPhone:

1. Replace `https://YOUR-WORKER.workers.dev` in `project.yml` with the deployed pairing Worker.
2. Select a signing team for both targets in Xcode.
3. Change the bundle IDs and App Group if the defaults are unavailable, keeping the values synchronized in `project.yml`, `Shared/SharedConfig.swift`, and both entitlements files.
4. Build the `iPhoneRemote` scheme onto the iPhone.

The extension is video-only at 720×1280 and 30 FPS to minimize latency and reduce ReplayKit extension memory pressure.
