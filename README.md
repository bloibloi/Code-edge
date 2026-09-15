# iPhone Remote

A low-latency, view-only iPhone screen viewer designed for a Chromebook. The iPhone publishes its ReplayKit screen capture to Cloudflare Stream over WHIP/WebRTC, and the browser receives it over WHEP/WebRTC.

Live website: https://bloibloi.github.io/Code-edge/

## User flow

1. Open the website on the iPhone and expand **Stream this iPhone with Moblin**.
2. Create a private session and tap **Open in Moblin**.
3. Use Moblin's screen-capture source and start the iOS Screen Broadcast.
4. On the Chromebook, enter the six-digit code and separate password.

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

The Cloudflare API token never enters the GitHub Pages site. The API token is a Worker secret. The private WHIP publishing URL is returned only to the iPhone that creates the session and is handed to Moblin locally. The raw WHEP playback URL remains inside the Worker; a viewer receives only an unguessable, short-lived token after supplying the correct code and password.

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
- iPhone sessions expire after fifteen minutes and admit up to five password-authorized viewers.
- Passwords are salted and hashed; eight incorrect attempts lock the session.
- Private playback requests are authorized and proxied by the Worker, so the Cloudflare playback URL is not exposed to the viewer.
- Cloudflare recording is disabled for sessions created by the Worker.
- DRM-protected content may be blank or blocked. This project does not bypass iOS capture or DRM restrictions.

## Local website preview

```bash
python3 -m http.server 8080
```

Cloudflare Workers Builds can deploy directly from the repository root using `npm run check` and `npx wrangler deploy`. The equivalent standalone Worker project remains in `worker/`.
