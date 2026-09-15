# Pairing and Plex Worker

The Worker creates a short-lived Cloudflare Stream Live Input and coordinates a one-time six-digit pairing code. Session state is isolated in Durable Objects.

## Configure later

From this directory:

```bash
npm install
npx wrangler secret put CLOUDFLARE_ACCOUNT_ID
npx wrangler secret put CLOUDFLARE_API_TOKEN
npx wrangler secret put PLEX_TOKEN
npx wrangler secret put PLEX_SITE_PASSWORD
npm run deploy
```

The API token needs permission to create Cloudflare Stream Live Inputs for the account. Never commit either value.

The Worker also exposes a fixed, read-only mirror of the GitHub Pages frontend at `/site/`. It proxies only the explicitly allowlisted Code-edge static files, accepts only `GET` and `HEAD`, and cannot be used as an open proxy for arbitrary URLs. Responses include `X-Code-Edge-Static-Proxy: github-pages` and are excluded from search indexing.

`PLEX_TOKEN` is the long-lived Plex account token and `PLEX_SITE_PASSWORD` protects the Media tab. Both must be Cloudflare Worker secrets, never plaintext variables or repository files. After a correct password, the browser receives only a random opaque session identifier. The Worker keeps Plex API access behind that 30-day server-side session and reads the Plex token directly from its secret on every request. Locking Media deletes the session immediately.

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
- `GET /site/`: fixed static proxy for the Code-edge GitHub Pages frontend.
- `POST /v1/plex/login`: verifies the website password with per-IP rate limiting and creates a 30-day session.
- `/v1/plex/servers`, `/libraries`, `/library/:id/items`, `/item/:id`, and `/children/:id`: sanitized library metadata.
- `/v1/plex/image` and `/v1/plex/stream/:id`: authenticated artwork and Direct Play/transcoded media proxying.

Sessions expire after five minutes. Live inputs are created with recording disabled.
