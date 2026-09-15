# iPhone Remote

A private, view-only iPhone screen viewer designed for a Chromebook. The iPhone publishes its screen from StreamChamp to LiveKit over RTMPS, and viewers receive it over WebRTC.

Live website: https://bloibloi.github.io/Code-edge/

## User flow

1. Open the website on the iPhone and expand **Stream this iPhone with StreamChamp**.
2. Create a private session and copy its RTMPS server and stream key into a StreamChamp Custom RTMP destination.
3. Start StreamChamp's iOS Screen Broadcast.
4. On the Chromebook, enter the temporary six-digit code.

The website is view-only. A Bluetooth mouse or keyboard can be paired directly with the iPhone for control.

## Architecture

```text
StreamChamp + iOS Screen Broadcast
    └── secure RTMPS publish
          └── LiveKit Ingress
                └── private WebRTC room
                      └── Chromebook website

GitHub Pages ── six-digit code ── Cloudflare pairing Worker
                                      └── creates short-lived LiveKit ingress
```

The LiveKit API secret never enters the GitHub Pages site. It remains a Worker secret. The private RTMPS stream key is returned only to the device that creates the session, while viewers receive restricted subscribe-only room tokens after supplying the temporary code.

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
- iPhone and relayed desktop sessions expire after fifteen minutes and admit up to five code-authorized viewers.
- Passwords are temporarily disabled. Anyone with the code can attempt to join, so codes must be shared carefully.
- Viewer tokens permit subscribing only; they cannot publish media to the room.
- Recording is not enabled. LiveKit ingresses are deleted when a host ends a session or when its fifteen-minute alarm expires.
- DRM-protected content may be blank or blocked. This project does not bypass iOS capture or DRM restrictions.

## Local website preview

```bash
python3 -m http.server 8080
```

Cloudflare Workers Builds can deploy directly from the repository root using `npm run check` and `npx wrangler deploy`. The equivalent standalone Worker project remains in `worker/`.
