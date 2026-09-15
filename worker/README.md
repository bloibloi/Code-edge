# Pairing Worker

The Worker creates a short-lived LiveKit RTMP ingress and coordinates a six-digit viewing code. Session state is isolated in Durable Objects. Cloudflare Stream remains available for desktop WHIP relay and as a fallback until LiveKit is configured.

## Configure later

From this directory:

```bash
npm install
npx wrangler secret put CLOUDFLARE_ACCOUNT_ID
npx wrangler secret put CLOUDFLARE_API_TOKEN
npx wrangler secret put LIVEKIT_URL
npx wrangler secret put LIVEKIT_API_KEY
npx wrangler secret put LIVEKIT_API_SECRET
npm run deploy
```

Copy the LiveKit URL, API key, and API secret from the LiveKit Cloud project settings. Never commit these values. The Cloudflare token still needs permission to create Stream Live Inputs for desktop relay.

After deployment:

1. Put the Worker origin in root `config.js` as `window.IPHONE_REMOTE_API`.
2. Put the same origin in `ios/project.yml` under `PAIRING_API_URL`.
3. Regenerate the Xcode project.

`ALLOWED_ORIGIN` is already restricted to `https://bloibloi.github.io`. Local development also accepts `http://localhost:8080`.

## Endpoints

- `POST /v1/pair/create`: returns a six-digit code, viewer token, and expiry.
- `POST /v1/pair/join` with `{ "code": "123456" }`: claims the code once and returns the private WHIP URL to the iPhone.
- `GET /v1/pair/status?token=...`: lets the Chromebook wait for the iPhone and returns WHEP playback only after the claim.
- `GET /health`: health check.

iPhone sessions expire after fifteen minutes and admit up to five viewers. LiveKit viewer tokens are subscribe-only, recording is not enabled, and each ingress is deleted when the session ends or expires.
