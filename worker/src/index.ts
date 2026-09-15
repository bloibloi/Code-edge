import { DurableObject } from "cloudflare:workers";

export interface Env {
  PAIRING_SESSION: DurableObjectNamespace<PairingSession>;
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_API_TOKEN: string;
  ALLOWED_ORIGIN: string;
}

type StoredSession = {
  kind?: "iphone" | "iphone-host" | "desktop";
  secret: string;
  expiresAt: number;
  state: "reserved" | "waiting" | "claimed";
  whipPublishURL?: string;
  whepPlaybackURL?: string;
  viewerSecret?: string;
  viewerSecrets?: string[];
  offer?: string;
  answer?: string;
  passwordSalt?: string;
  passwordHash?: string;
  failedAttempts?: number;
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
const IPHONE_SESSION_TTL_MS = 15 * 60 * 1000;
const MAX_IPHONE_VIEWERS = 5;

export class PairingSession extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const body = request.method === "POST" ? await request.json<Record<string, string>>() : {};
    const current = await this.ctx.storage.get<StoredSession>("session");
    const expired = !current || current.expiresAt <= Date.now();

    if (url.pathname === "/reserve" && request.method === "POST") {
      if (!expired) return json({ error: "Code already in use" }, 409);
      const session: StoredSession = {
        kind: "iphone",
        secret: body.secret,
        expiresAt: Number(body.expiresAt),
        state: "reserved"
      };
      await this.ctx.storage.put("session", session);
      return json({ ok: true });
    }

    if (url.pathname === "/configure" && request.method === "POST") {
      if (expired || current.kind === "desktop" || current.secret !== body.secret || current.state !== "reserved") {
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
      if (expired || current.kind === "desktop" || current.state !== "waiting" || !current.whipPublishURL) {
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
      if (expired || current.kind === "desktop" || current.secret !== body.secret) {
        return json({ error: "Pairing session expired." }, 404);
      }
      return json({
        paired: current.state === "claimed",
        playbackURL: current.state === "claimed" ? current.whepPlaybackURL : undefined,
        expiresAt: new Date(current.expiresAt).toISOString()
      });
    }

    if (url.pathname === "/iphone/reserve" && request.method === "POST") {
      if (!expired) return json({ error: "Code already in use" }, 409);
      await this.ctx.storage.put<StoredSession>("session", {
        kind: "iphone-host",
        secret: body.secret,
        expiresAt: Number(body.expiresAt),
        state: "reserved",
        passwordSalt: body.passwordSalt,
        passwordHash: body.passwordHash,
        failedAttempts: 0
      });
      return json({ ok: true });
    }

    if (url.pathname === "/iphone/configure" && request.method === "POST") {
      if (expired || current.kind !== "iphone-host" || current.secret !== body.secret || current.state !== "reserved") {
        return json({ error: "iPhone session reservation expired." }, 409);
      }
      current.whipPublishURL = body.whipPublishURL;
      current.whepPlaybackURL = body.whepPlaybackURL;
      current.state = "waiting";
      await this.ctx.storage.put("session", current);
      return json({ ok: true });
    }

    if (url.pathname === "/iphone/join" && request.method === "POST") {
      const genericError = "The code or password is incorrect, expired, or already used.";
      const viewers = current?.viewerSecrets || (current?.viewerSecret ? [current.viewerSecret] : []);
      if (expired || current.kind !== "iphone-host" || !["waiting", "claimed"].includes(current.state) ||
          !current.whepPlaybackURL || viewers.length >= MAX_IPHONE_VIEWERS || (current.failedAttempts || 0) >= 8) {
        return json({ error: genericError }, 404);
      }
      const candidateHash = await hashPassword(body.password || "", current.passwordSalt || "");
      if (!secureEqual(candidateHash, current.passwordHash || "")) {
        current.failedAttempts = (current.failedAttempts || 0) + 1;
        await this.ctx.storage.put("session", current);
        return json({ error: genericError }, 404);
      }
      current.viewerSecrets = [...viewers, body.viewerSecret];
      delete current.viewerSecret;
      current.state = "claimed";
      await this.ctx.storage.put("session", current);
      return json({ expiresAt: new Date(current.expiresAt).toISOString(), viewerCount: current.viewerSecrets.length });
    }

    if (url.pathname === "/iphone/play" && request.method === "POST") {
      const viewers = current?.viewerSecrets || (current?.viewerSecret ? [current.viewerSecret] : []);
      if (expired || current.kind !== "iphone-host" || current.state !== "claimed" ||
          !viewers.includes(body.viewerSecret) || !current.whepPlaybackURL) {
        return json({ error: "This private viewing session is not authorized." }, 403);
      }
      return json({ playbackURL: current.whepPlaybackURL });
    }

    if (url.pathname === "/iphone/status" && request.method === "POST") {
      if (expired || current.kind !== "iphone-host" || current.secret !== body.secret) {
        return json({ error: "iPhone stream session expired." }, 404);
      }
      return json({
        joined: current.state === "claimed",
        viewerCount: current.viewerSecrets?.length || (current.viewerSecret ? 1 : 0),
        expiresAt: new Date(current.expiresAt).toISOString()
      });
    }

    if (url.pathname === "/iphone/release" && request.method === "POST") {
      if (current?.kind === "iphone-host" && current.secret === body.secret) await this.ctx.storage.delete("session");
      return json({ ok: true });
    }

    if (url.pathname === "/desktop/reserve" && request.method === "POST") {
      if (!expired) return json({ error: "Code already in use" }, 409);
      await this.ctx.storage.put<StoredSession>("session", {
        kind: "desktop",
        secret: body.secret,
        expiresAt: Number(body.expiresAt),
        state: "waiting",
        passwordSalt: body.passwordSalt,
        passwordHash: body.passwordHash,
        failedAttempts: 0
      });
      return json({ ok: true });
    }

    if (url.pathname === "/desktop/offer" && request.method === "POST") {
      if (expired || current.kind !== "desktop" || current.secret !== body.secret || !body.sdp) {
        return json({ error: "Desktop session expired." }, 404);
      }
      current.offer = body.sdp;
      await this.ctx.storage.put("session", current);
      return json({ ok: true });
    }

    if (url.pathname === "/desktop/join" && request.method === "POST") {
      const genericError = "The code or password is incorrect, expired, or already used.";
      if (expired || current.kind !== "desktop" || !current.offer || current.state === "claimed" || (current.failedAttempts || 0) >= 8) {
        return json({ error: genericError }, 404);
      }
      const candidateHash = await hashPassword(body.password || "", current.passwordSalt || "");
      if (!secureEqual(candidateHash, current.passwordHash || "")) {
        current.failedAttempts = (current.failedAttempts || 0) + 1;
        await this.ctx.storage.put("session", current);
        return json({ error: genericError }, 404);
      }
      current.viewerSecret = body.viewerSecret;
      current.state = "claimed";
      await this.ctx.storage.put("session", current);
      return json({ offer: current.offer, expiresAt: new Date(current.expiresAt).toISOString() });
    }

    if (url.pathname === "/desktop/answer" && request.method === "POST") {
      if (expired || current.kind !== "desktop" || current.viewerSecret !== body.viewerSecret || !body.sdp) {
        return json({ error: "Desktop session expired." }, 404);
      }
      current.answer = body.sdp;
      await this.ctx.storage.put("session", current);
      return json({ ok: true });
    }

    if (url.pathname === "/desktop/status" && request.method === "POST") {
      if (expired || current.kind !== "desktop" || current.secret !== body.secret) {
        return json({ error: "Desktop session expired." }, 404);
      }
      return json({ joined: current.state === "claimed", answer: current.answer });
    }

    if (url.pathname === "/desktop/release" && request.method === "POST") {
      if (current?.kind === "desktop" && current.secret === body.secret) await this.ctx.storage.delete("session");
      return json({ ok: true });
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
      } else if (url.pathname === "/v1/iphone/create" && request.method === "POST") {
        response = await createIPhoneSession(request, env);
      } else if (url.pathname === "/v1/iphone/join" && request.method === "POST") {
        response = await joinIPhoneSession(request, env);
      } else if (url.pathname === "/v1/iphone/play" && request.method === "POST") {
        response = await playIPhoneSession(request, env);
      } else if (url.pathname === "/v1/iphone/status" && request.method === "GET") {
        response = await iPhoneStatus(url, env);
      } else if (url.pathname === "/v1/iphone/release" && request.method === "POST") {
        response = await releaseIPhoneSession(request, env);
      } else if (url.pathname === "/v1/desktop/create" && request.method === "POST") {
        response = await createDesktopSession(request, env);
      } else if (url.pathname === "/v1/desktop/offer" && request.method === "POST") {
        response = await setDesktopOffer(request, env);
      } else if (url.pathname === "/v1/desktop/join" && request.method === "POST") {
        response = await joinDesktopSession(request, env);
      } else if (url.pathname === "/v1/desktop/answer" && request.method === "POST") {
        response = await setDesktopAnswer(request, env);
      } else if (url.pathname === "/v1/desktop/status" && request.method === "GET") {
        response = await desktopStatus(url, env);
      } else if (url.pathname === "/v1/desktop/release" && request.method === "POST") {
        response = await releaseDesktopSession(request, env);
      } else if (url.pathname === "/health") {
        response = json({
          ok: true,
          streamConfigured: Boolean(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN),
          pairingStorageConfigured: Boolean(env.PAIRING_SESSION)
        });
      } else {
        response = json({ error: "Not found" }, 404);
      }
      const headers = new Headers(response.headers);
      Object.entries(cors).forEach(([key, value]) => headers.set(key, value));
      headers.set("Cache-Control", "no-store");
      return new Response(response.body, { status: response.status, headers });
    } catch (error) {
      console.error(error);
      const message = error instanceof PublicError
        ? error.message
        : "The pairing service could not complete the request.";
      const response = json({ error: message }, error instanceof PublicError ? 502 : 500);
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

async function createIPhoneSession(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ password?: string }>();
  const password = body.password || "";
  if (password.length < 10 || password.length > 128) {
    return json({ error: "Use a password between 10 and 128 characters." }, 400);
  }
  const secret = randomToken();
  const passwordSalt = randomToken();
  const passwordHash = await hashPassword(password, passwordSalt);
  const expiresAt = Date.now() + IPHONE_SESSION_TTL_MS;
  let code = "";
  let stub: DurableObjectStub<PairingSession> | undefined;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    code = randomCode();
    stub = env.PAIRING_SESSION.getByName(code);
    const reserved = await stub.fetch("https://session/iphone/reserve", {
      method: "POST",
      body: JSON.stringify({ secret, expiresAt, passwordSalt, passwordHash })
    });
    if (reserved.ok) break;
    stub = undefined;
  }
  if (!stub) return json({ error: "Could not allocate an iPhone join code. Try again." }, 503);

  try {
    const liveInput = await createCloudflareLiveInput(env, code);
    const configured = await stub.fetch("https://session/iphone/configure", {
      method: "POST",
      body: JSON.stringify({ secret, ...liveInput })
    });
    if (!configured.ok) throw new Error("iPhone session reservation expired during setup");
    return json({
      code,
      publisherToken: `${code}.${secret}`,
      whipPublishURL: liveInput.whipPublishURL,
      expiresAt: new Date(expiresAt).toISOString()
    });
  } catch (error) {
    await stub.fetch("https://session/iphone/release", {
      method: "POST",
      body: JSON.stringify({ secret })
    });
    throw error;
  }
}

async function joinIPhoneSession(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ code?: string; password?: string }>();
  const code = (body.code || "").replace(/\D/g, "");
  if (!/^\d{6}$/.test(code)) return json({ error: "Enter the six-digit iPhone code." }, 400);
  if (!body.password || body.password.length < 10 || body.password.length > 128) {
    return json({ error: "Enter the iPhone session password." }, 400);
  }
  const viewerSecret = randomToken();
  const response = await env.PAIRING_SESSION.getByName(code).fetch("https://session/iphone/join", {
    method: "POST",
    body: JSON.stringify({ viewerSecret, password: body.password })
  });
  const payload = await response.json<Record<string, unknown>>();
  if (!response.ok) return json(payload, response.status);
  return json({ ...payload, viewerToken: `${code}.${viewerSecret}` });
}

async function playIPhoneSession(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ token?: string; sdp?: string }>();
  const token = parseToken(body.token);
  if (!token || !body.sdp || body.sdp.length > 100_000) {
    return json({ error: "Invalid private playback request." }, 400);
  }

  const authorized = await env.PAIRING_SESSION.getByName(token.code).fetch("https://session/iphone/play", {
    method: "POST",
    body: JSON.stringify({ viewerSecret: token.secret })
  });
  const authorization = await authorized.json<{ playbackURL?: string; error?: string }>();
  if (!authorized.ok || !authorization.playbackURL) {
    return json({ error: authorization.error || "This private viewing session is not authorized." }, 403);
  }

  const playback = await fetch(authorization.playbackURL, {
    method: "POST",
    headers: { "Content-Type": "application/sdp" },
    body: body.sdp
  });
  if (!playback.ok) {
    return json({ error: playback.status === 404 ? "The iPhone stream has not started yet." : "The private stream could not be opened." }, 502);
  }
  return json({ answer: await playback.text() });
}

async function iPhoneStatus(url: URL, env: Env): Promise<Response> {
  const token = parseToken(url.searchParams.get("token"));
  if (!token) return json({ error: "Invalid iPhone session token." }, 400);
  return env.PAIRING_SESSION.getByName(token.code).fetch("https://session/iphone/status", {
    method: "POST",
    body: JSON.stringify({ secret: token.secret })
  });
}

async function releaseIPhoneSession(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ token?: string }>();
  const token = parseToken(body.token);
  if (!token) return json({ ok: true });
  return env.PAIRING_SESSION.getByName(token.code).fetch("https://session/iphone/release", {
    method: "POST",
    body: JSON.stringify({ secret: token.secret })
  });
}

async function createDesktopSession(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ password?: string }>();
  const password = body.password || "";
  if (password.length < 8 || password.length > 128) {
    return json({ error: "Use a password between 8 and 128 characters." }, 400);
  }
  const secret = randomToken();
  const passwordSalt = randomToken();
  const passwordHash = await hashPassword(password, passwordSalt);
  const expiresAt = Date.now() + SESSION_TTL_MS;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = randomCode();
    const stub = env.PAIRING_SESSION.getByName(code);
    const reserved = await stub.fetch("https://session/desktop/reserve", {
      method: "POST",
      body: JSON.stringify({ secret, expiresAt, passwordSalt, passwordHash })
    });
    if (reserved.ok) {
      return json({ code, hostToken: `${code}.${secret}`, expiresAt: new Date(expiresAt).toISOString() });
    }
  }
  return json({ error: "Could not allocate a desktop code. Try again." }, 503);
}

async function setDesktopOffer(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ token?: string; sdp?: string }>();
  const token = parseToken(body.token);
  if (!token || !body.sdp) return json({ error: "Invalid desktop offer." }, 400);
  return env.PAIRING_SESSION.getByName(token.code).fetch("https://session/desktop/offer", {
    method: "POST",
    body: JSON.stringify({ secret: token.secret, sdp: body.sdp })
  });
}

async function joinDesktopSession(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ code?: string; password?: string }>();
  const code = (body.code || "").replace(/\D/g, "");
  if (!/^\d{6}$/.test(code)) return json({ error: "Enter the six-digit desktop code." }, 400);
  if (!body.password || body.password.length < 8 || body.password.length > 128) {
    return json({ error: "Enter the session password." }, 400);
  }
  const viewerSecret = randomToken();
  const response = await env.PAIRING_SESSION.getByName(code).fetch("https://session/desktop/join", {
    method: "POST",
    body: JSON.stringify({ viewerSecret, password: body.password })
  });
  const payload = await response.json<Record<string, unknown>>();
  if (!response.ok) return json(payload, response.status);
  return json({ ...payload, viewerToken: `${code}.${viewerSecret}` });
}

async function setDesktopAnswer(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ token?: string; sdp?: string }>();
  const token = parseToken(body.token);
  if (!token || !body.sdp) return json({ error: "Invalid desktop answer." }, 400);
  return env.PAIRING_SESSION.getByName(token.code).fetch("https://session/desktop/answer", {
    method: "POST",
    body: JSON.stringify({ viewerSecret: token.secret, sdp: body.sdp })
  });
}

async function desktopStatus(url: URL, env: Env): Promise<Response> {
  const token = parseToken(url.searchParams.get("token"));
  if (!token) return json({ error: "Invalid desktop session token." }, 400);
  return env.PAIRING_SESSION.getByName(token.code).fetch("https://session/desktop/status", {
    method: "POST",
    body: JSON.stringify({ secret: token.secret })
  });
}

async function releaseDesktopSession(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ token?: string }>();
  const token = parseToken(body.token);
  if (!token) return json({ ok: true });
  return env.PAIRING_SESSION.getByName(token.code).fetch("https://session/desktop/release", {
    method: "POST",
    body: JSON.stringify({ secret: token.secret })
  });
}

function parseToken(value: string | null | undefined): { code: string; secret: string } | null {
  const [code, secret] = (value || "").split(".", 2);
  return /^\d{6}$/.test(code) && Boolean(secret) ? { code, secret } : null;
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`${salt}\u0000${password}`));
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

function secureEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

async function createCloudflareLiveInput(env: Env, code: string) {
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) {
    throw new PublicError("Cloudflare Stream credentials are not configured in Worker secrets.");
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
    throw new PublicError(
      `Cloudflare Stream rejected the Live Input request: ${payload.errors?.[0]?.message || `HTTP ${response.status}`}`
    );
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

class PublicError extends Error {}
