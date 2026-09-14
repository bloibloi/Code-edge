# iPhone Screen

A view-only website for displaying an iPhone screen on a Chromebook through Cloudflare Stream.

Live site: https://bloibloi.github.io/Code-edge/

## Recommended architecture

```
iPhone screen
  → PRISM Live Studio Screen mode (RTMPS publisher)
  → Cloudflare Stream live input (HLS/DASH enabled)
  → Cloudflare iframe player on this website
```

This fallback is intended for devices where Larix Screencaster's ReplayKit extension does not work. It is more widely compatible but has several seconds of latency. The site also continues to accept a Cloudflare WHEP `/webRTC/play` URL for existing WebRTC setups.

## Configure Cloudflare and PRISM

1. Create a Cloudflare Stream live input with live HLS/DASH playback enabled.
2. Copy the live input's RTMPS server URL and stream key.
3. Install PRISM Live Studio on the iPhone.
4. Add a Custom RTMP destination in PRISM using the Cloudflare server URL and stream key.
5. Select PRISM's Screen mode and start the iOS screen broadcast.
6. Copy the Cloudflare playback URL ending in `/iframe`.
7. Paste the iframe URL into the live website and select **Save and connect**.

Do not paste an RTMPS stream key or WHIP publishing URL into the website. Those are publishing credentials and must remain secret.

## Controls

The website is view-only. Controls remain on the iPhone or on Bluetooth accessories paired directly with the iPhone.

## Privacy and DRM

- Everything visible on the iPhone, including notifications, may appear in the broadcast.
- Use Focus or Do Not Disturb before starting.
- Anyone with an unrestricted playback address may be able to view the stream.
- DRM-protected video may be blank or blocked. This project does not bypass DRM or iOS capture restrictions.

## Development

This is a dependency-free static site. Preview locally with `python3 -m http.server 8080`.

The GitHub Actions workflow deploys the root directory to GitHub Pages after every push to `main`.
