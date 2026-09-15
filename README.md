# iPhone Remote

A private screen-sharing site with an integrated Plex media library. The iPhone publishes its screen from StreamChamp to Cloudflare Stream over RTMPS, and the browser receives it over WHEP/WebRTC.

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
          └── Cloudflare Stream Live Input
                └── WHEP/WebRTC playback
                      └── Chromebook website

GitHub Pages ── six-digit code ── Cloudflare pairing Worker
                                      └── creates short-lived Live Input
```

The Cloudflare API token never enters the GitHub Pages site. The API token is a Worker secret. The private RTMPS stream key is returned only to the device that creates the session. The raw WHEP playback URL remains inside the Worker; a viewer receives only an unguessable, short-lived token after supplying the temporary code.

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
- Private playback requests are authorized and proxied by the Worker, so the Cloudflare playback URL is not exposed to the viewer.
- Cloudflare recording is disabled for sessions created by the Worker.
- DRM-protected content may be blank or blocked. This project does not bypass iOS capture or DRM restrictions.

## Plex Media tab

The **Media** tab signs in through Plex's hosted authorization page. The frontend receives only an opaque Remote Screen session ID. The Plex token, secure server address, library API calls, artwork, and media bytes stay behind the Cloudflare Worker; no Plex credentials belong in this repository or in `config.js`.

The player Direct Plays browser-friendly MP4/WebM files containing H.264, VP8, VP9, or AV1 video with AAC, MP3, Opus, or Vorbis audio. Other containers/codecs—including MKV, MPEG-2, and HEVC in browsers that do not advertise support—use Plex's universal transcode endpoint to produce H.264/AAC MP4. Transcoding requires the Plex Media Server to be online and powerful enough, and some remote-playback features may depend on the Plex account/server configuration. DRM is never bypassed.

## Local website preview

```bash
python3 -m http.server 8080
```

Cloudflare Workers Builds can deploy directly from the repository root using `npm run check` and `npx wrangler deploy`. The equivalent standalone Worker project remains in `worker/`.
