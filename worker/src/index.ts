import { DurableObject } from "cloudflare:workers";

export interface Env {
  PAIRING_SESSION: DurableObjectNamespace<PairingSession>;
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_API_TOKEN: string;
  ALLOWED_ORIGIN: string;
}

type StoredSession = {
  secret: string;
  expiresAt: number;
  state: "reserved" | "waiting" | "claimed";
  whipPublishURL?: string;
  whepPlaybackURL?: string;
};

type LiveInputResponse = {
  success: boolean;
  errors?: Array<{ message?: string }>;
  result?: {
    webRTC?: { url?: string };
    webRTCPlayback?: { url?: string };
  };
};

const SESSION_TTL_MS = 5 * 60 * 1000;

export class PairingSession extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const body = request.method === "POST" ? await request.json<Record<string, string>>() : {};
    const current = await this.ctx.storage.get<StoredSession>("session");
    const expired = !current || current.expiresAt <= Date.now();

    if (url.pathname === "/reserve" && request.method === "POST") {
      if (!expired) return json({ error: "Code already in use" }, 409);
      const session: StoredSession = {
        secret: body.secret,
        expiresAt: Number(body.expiresAt),
        state: "reserved"
      };
      await this.ctx.storage.put("session", session);
      return json({ ok: true });
    }

    if (url.pathname === "/configure" && request.method === "POST") {
      if (expired || current.secret !== body.secret || current.state !== "reserved") {
        return json({ error: "Reservation expired" }, 409);
      }
      current.whipPublishURL = body.whipPublishURL;
      current.whepPlaybackURL = body.whepPlaybackURL;
      current.state = "waiting";
      await this.ctx.storage.put("session", current);
      return json({ ok: true });
    }

    if (url.pathname === "/release" && request.method === "POST") {
      if (current?.secret === body.secret) await this.ctx.storage.delete("session");
      return json({ ok: true });
    }

    if (url.pathname === "/join" && request.method === "POST") {
      if (expired || current.state !== "waiting" || !current.whipPublishURL) {
        return json({ error: "That code is invalid, expired, or already used." }, 404);
      }
      current.state = "claimed";
      await this.ctx.storage.put("session", current);
      return json({
        whipPublishURL: current.whipPublishURL,
        sessionToken: body.code + "." + current.secret,
        expiresAt: new Date(current.expiresAt).toISOString()
      });
    }

    if (url.pathname === "/status" && request.method === "POST") {
      if (expired || current.secret !== body.secret) {
        return json({ error: "Pairing session expired." }, 404);
      }
      return json({
        paired: current.state === "claimed",
        playbackURL: current.state === "claimed" ? current.whepPlaybackURL : undefined,
        expiresAt: new Date(current.expiresAt).toISOString()
      });
    }

    return json({ error: "Not found" }, 404);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    try {
      let response: Response;
      if (url.pathname === "/v1/pair/create" && request.method === "POST") {
        response = await createPairing(env);
      } else if (url.pathname === "/v1/pair/join" && request.method === "POST") {
        response = await joinPairing(request, env);
      } else if (url.pathname === "/v1/pair/status" && request.method === "GET") {
        response = await pairingStatus(url, env);
      } else if (url.pathname === "/health") {
        response = json({ ok: true });
      } else {
        response = json({ error: "Not found" }, 404);
      }
      const headers = new Headers(response.headers);
      Object.entries(cors).forEach(([key, value]) => headers.set(key, value));
      headers.set("Cache-Control", "no-store");
      return new Response(response.body, { status: response.status, headers });
    } catch (error) {
      console.error(error);
      const response = json({ error: "The pairing service could not complete the request." }, 500);
      const headers = new Headers(response.headers);
      Object.entries(cors).forEach(([key, value]) => headers.set(key, value));
      return new Response(response.body, { status: response.status, headers });
    }
  }
} satisfies ExportedHandler<Env>;

async function createPairing(env: Env): Promise<Response> {
  const secret = randomToken();
  const expiresAt = Date.now() + SESSION_TTL_MS;
  let code = "";
  let stub: DurableObjectStub<PairingSession> | undefined;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    code = randomCode();
    stub = env.PAIRING_SESSION.getByName(code);
    const reserved = await stub.fetch("https://session/reserve", {
      method: "POST",
      body: JSON.stringify({ secret, expiresAt })
    });
    if (reserved.ok) break;
    stub = undefined;
  }
  if (!stub) return json({ error: "Could not allocate a pairing code. Try again." }, 503);

  try {
    const liveInput = await createCloudflareLiveInput(env, code);
    const configured = await stub.fetch("https://session/configure", {
      method: "POST",
      body: JSON.stringify({
        secret,
        whipPublishURL: liveInput.whipPublishURL,
        whepPlaybackURL: liveInput.whepPlaybackURL
      })
    });
    if (!configured.ok) throw new Error("Pairing reservation expired during setup");
    return json({ code, sessionToken: code + "." + secret, expiresAt: new Date(expiresAt).toISOString() });
  } catch (error) {
    await stub.fetch("https://session/release", {
      method: "POST",
      body: JSON.stringify({ secret })
    });
    throw error;
  }
}

async function joinPairing(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ code?: string }>();
  const code = (body.code || "").replace(/\D/g, "");
  if (!/^\d{6}$/.test(code)) return json({ error: "Enter the six-digit code." }, 400);
  return env.PAIRING_SESSION.getByName(code).fetch("https://session/join", {
    method: "POST",
    body: JSON.stringify({ code })
  });
}

async function pairingStatus(url: URL, env: Env): Promise<Response> {
  const token = url.searchParams.get("token") || "";
  const [code, secret] = token.split(".", 2);
  if (!/^\d{6}$/.test(code) || !secret) return json({ error: "Invalid session token." }, 400);
  return env.PAIRING_SESSION.getByName(code).fetch("https://session/status", {
    method: "POST",
    body: JSON.stringify({ secret })
  });
}

async function createCloudflareLiveInput(env: Env, code: string) {
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) {
    throw new Error("Cloudflare credentials are not configured");
  }
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/stream/live_inputs`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        enabled: true,
        meta: { name: `iPhone Remote ${code}` },
        preferLowLatency: true,
        recording: { mode: "off", hideLiveViewerCount: true, requireSignedURLs: false, timeoutSeconds: 0 }
      })
    }
  );
  const payload = await response.json<LiveInputResponse>();
  const whipPublishURL = payload.result?.webRTC?.url;
  const whepPlaybackURL = payload.result?.webRTCPlayback?.url;
  if (!response.ok || !payload.success || !whipPublishURL || !whepPlaybackURL) {
    throw new Error(payload.errors?.[0]?.message || `Cloudflare Live Input failed (${response.status})`);
  }
  return { whipPublishURL, whepPlaybackURL };
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("Origin") || "";
  const allowed = origin === env.ALLOWED_ORIGIN || origin === "http://localhost:8080";
  return {
    "Access-Control-Allow-Origin": allowed ? origin : env.ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin"
  };
}

function randomCode(): string {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return String(values[0] % 1_000_000).padStart(6, "0");
}

function randomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}
