# iPhone Screen

A view-only, ultra-low-latency website for displaying an iPhone's full screen on a Chromebook.

Live site: https://bloibloi.github.io/Code-edge/

## Architecture

```
iPhone screen
  → Larix Screencaster (WHIP publisher)
  → Cloudflare Stream Live WebRTC
  → This website (WHEP viewer)
```

The site intentionally does not capture Chromebook mouse or keyboard input. Controls remain on the iPhone or on accessories paired directly with the iPhone.

## Requirements

- An iPhone with [Larix Screencaster](https://apps.apple.com/) installed
- A Cloudflare account with Stream enabled
- One Cloudflare Stream live input
- The WHIP publish URL from that input
- The WHEP playback URL from that input

Cloudflare's current WebRTC documentation and account requirements are here:

https://developers.cloudflare.com/stream/webrtc-beta/

## One-time Cloudflare setup

1. Sign in to the Cloudflare dashboard.
2. Open **Stream → Live inputs**.
3. Create a live input.
4. Under **Broadcast**, copy the WebRTC/WHIP publish URL.
5. Under **Playback**, copy the WebRTC/WHEP playback URL.
6. Treat the WHIP publish URL as a secret. Anyone who has it may be able to broadcast to the input.

## Configure the iPhone

1. Install and open Larix Screencaster.
2. Add a new connection.
3. Select **WebRTC WHIP**.
4. Paste the Cloudflare WHIP publish URL.
5. Save the connection.
6. Start the screen broadcast from Larix when ready.

## Configure the website

1. Open the live site on the Chromebook.
2. Paste the Cloudflare **WHEP playback URL**.
3. Select **Save and connect**.
4. The URL is stored only in that browser's local storage.
5. The player checks every five seconds when the iPhone is not broadcasting and connects automatically when the broadcast starts.

Cloudflare documents sub-second WebRTC playback latency. Actual performance depends on the iPhone and Chromebook networks.

## Privacy and DRM

- Everything visible on the iPhone, including notifications, may appear in the broadcast.
- Use Focus or Do Not Disturb before starting.
- The WHEP playback URL can allow viewing of the stream unless signed playback restrictions are configured.
- DRM-protected video may be blank or blocked. This project does not bypass DRM or iOS capture restrictions.

## Development

This is a dependency-free static site. Preview locally with:

```sh
python3 -m http.server 8080
```

The included GitHub Actions workflow deploys the root directory to GitHub Pages after every push to `main`.
