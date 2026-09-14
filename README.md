# iPhone Remote

A static GitHub Pages interface for viewing an iPhone WebRTC stream and sending normalized Chromebook mouse, touch, wheel, and keyboard events over a WebRTC data channel.

## What this repository provides

- Responsive remote-viewer interface
- WebRTC video/audio receiver
- Reliable ordered `control` data channel
- Pointer, click, wheel, and keyboard capture
- Live connection status and event log
- Manual copy/paste WebRTC signaling with no signaling server
- GitHub Pages deployment workflow

## Important iPhone limitation

A normal website cannot capture or remotely control the entire iPhone operating system. The phone side still needs a compatible companion app/bridge that:

1. captures the screen with Apple's ReplayKit,
2. publishes the capture as a WebRTC video track,
3. accepts the `control` data channel protocol, and
4. performs only actions iOS permits.

Protected/DRM video may appear blank in captured output. The browser cannot override that protection.

## Local preview

Serve the repository from a local web server (secure context is required for production WebRTC):

```sh
python3 -m http.server 8080
```

Open `http://localhost:8080`.

## Manual pairing flow

1. Open this site on the Chromebook.
2. Select **Create offer**.
3. Copy the Local SDP into the iPhone bridge and apply it there.
4. Copy the bridge's answer SDP into Remote SDP.
5. Select **Apply answer**.
6. Select **Enable control**, then click inside the stream to capture keyboard input.

For trickle-free manual signaling, the site waits for ICE gathering to finish before presenting the offer.

## Control message protocol

Every data-channel message is JSON:

```json
{
  "v": 1,
  "type": "pointermove",
  "ts": 1730000000000,
  "payload": {
    "x": 0.42,
    "y": 0.67,
    "buttons": 1,
    "pointerType": "mouse"
  }
}
```

Coordinates are normalized from 0 to 1 relative to the displayed video. Supported types are `pointermove`, `pointerdown`, `pointerup`, `click`, `wheel`, `keydown`, and `keyup`.

## Deploy

The included GitHub Actions workflow deploys the root directory to GitHub Pages after each push to `main`. In the repository settings, set **Pages → Source** to **GitHub Actions** if it is not selected automatically.
