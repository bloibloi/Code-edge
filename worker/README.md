# Pairing and Plex Worker

The Worker creates a short-lived Cloudflare Stream Live Input and coordinates a one-time six-digit pairing code. Session state is isolated in Durable Objects.

## Configure later

From this directory:

```bash
npm install
npx wrangler secret put CLOUDFLARE_ACCOUNT_ID
npx wrangler secret put CLOUDFLARE_API_TOKEN
npm run deploy
```

The API token needs permission to create Cloudflare Stream Live Inputs for the account. Never commit either value.

Plex does not require another manually copied token or password. The Worker starts Plex's PIN authorization flow, stores the resulting account token inside a per-browser Durable Object session, and proxies all Plex requests. The browser retains only an opaque session identifier. Signing out deletes the server-side session; otherwise it expires after 30 days.

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
- `POST /v1/plex/auth/start` and `GET /v1/plex/auth/status`: Plex-hosted sign-in.
- `/v1/plex/servers`, `/libraries`, `/library/:id/items`, `/item/:id`, and `/children/:id`: sanitized library metadata.
- `/v1/plex/image` and `/v1/plex/stream/:id`: authenticated artwork and Direct Play/transcoded media proxying.

Sessions expire after five minutes. Live inputs are created with recording disabled.
