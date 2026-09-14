# iPhone Remote

A low-latency, view-only iPhone screen viewer designed for a Chromebook. The iPhone publishes its ReplayKit screen capture to Cloudflare Stream over WHIP/WebRTC, and the browser receives it over WHEP/WebRTC.

Live website: https://bloibloi.github.io/Code-edge/

## User flow

1. Open the website on the Chromebook and select **Generate pairing code**.
2. Enter the six-digit code in the iPhone Remote app.
3. Tap **Start Broadcast** and confirm **iPhone Remote** in Apple's broadcast sheet.
4. The Chromebook connects automatically.

The website is view-only. A Bluetooth mouse or keyboard can be paired directly with the iPhone for control.

## Architecture

```text
iPhone Remote app + ReplayKit extension
    └── WHIP/WebRTC publish
          └── Cloudflare Stream Live Input
                └── WHEP/WebRTC playback
                      └── Chromebook website

GitHub Pages ── six-digit code ── Cloudflare pairing Worker
                                      └── creates short-lived Live Input
```

The Cloudflare API token and private WHIP publishing URL never enter the GitHub Pages site. The API token is a Worker secret. A publishing URL is released only to the iPhone that claims a valid one-time code.

## Project layout

- Root HTML, CSS, and JavaScript: GitHub Pages viewer
- `worker/`: pairing API and Cloudflare Live Input creation
- `ios/`: SwiftUI app and ReplayKit Broadcast Upload Extension
- `.github/workflows/`: Pages deployment and unsigned iOS compile check

## Build status

The full source is present. Until the Worker URL and Apple signing values are supplied, the website's manual playback URL fallback remains usable and the iOS project is source/CI ready rather than installable.

See [worker/README.md](worker/README.md) and [ios/README.md](ios/README.md) for the two configuration points.

## Privacy

- Apple always requires confirmation before broadcasting.
- Everything visible on the iPhone, including notifications, may appear in the stream. Enable Focus first.
- Pairing codes expire after five minutes and can be claimed once.
- Cloudflare recording is disabled for sessions created by the Worker.
- DRM-protected content may be blank or blocked. This project does not bypass iOS capture or DRM restrictions.

## Local website preview

```bash
python3 -m http.server 8080
```
