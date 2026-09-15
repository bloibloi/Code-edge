import { DurableObject } from "cloudflare:workers";

export interface Env {
  PAIRING_SESSION: DurableObjectNamespace<PairingSession>;
  PLEX_SESSION: DurableObjectNamespace<PlexSession>;
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_API_TOKEN: string;
  ALLOWED_ORIGIN: string;
}

type PlexServer = { id: string; name: string; uris: string[]; uri?: string; accessToken?: string };
type PlexState = {
  pinId: number;
  pinCode: string;
  expiresAt: number;
  plexToken?: string;
  username?: string;
  servers?: PlexServer[];
  selectedServerId?: string;
};

const PLEX_PRODUCT = "Remote Screen";
const PLEX_CLIENT_ID = "remote-screen-bloibloi-github-pages";
const PLEX_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export class PlexSession extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const state = await this.ctx.storage.get<PlexState>("plex");
    if (url.pathname === "/store" && request.method === "POST") {
      await this.ctx.storage.put("plex", await request.json<PlexState>());
      return json({ ok: true });
    }
    if (url.pathname === "/read") {
      if (!state || state.expiresAt <= Date.now()) {
        if (state) await this.ctx.storage.delete("plex");
        return json({ error: "Plex session expired." }, 401);
      }
      return json(state);
    }
    if (url.pathname === "/update" && request.method === "POST") {
      if (!state || state.expiresAt <= Date.now()) return json({ error: "Plex session expired." }, 401);
      await this.ctx.storage.put("plex", { ...state, ...await request.json<Partial<PlexState>>() });
      return json({ ok: true });
    }
    if (url.pathname === "/delete" && request.method === "POST") {
      await this.ctx.storage.delete("plex");
      return json({ ok: true });
    }
    return json({ error: "Not found" }, 404);
  }
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
    rtmps?: { url?: string; streamKey?: string };
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
      const genericError = "The code is incorrect, expired, or has reached its viewer limit.";
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
      } else if (url.pathname === "/v1/plex/auth/start" && request.method === "POST") {
        response = await startPlexAuth(env);
      } else if (url.pathname === "/v1/plex/auth/status" && request.method === "GET") {
        response = await plexAuthStatus(request, env);
      } else if (url.pathname === "/v1/plex/logout" && request.method === "POST") {
        response = await plexLogout(request, env);
      } else if (url.pathname === "/v1/plex/servers" && request.method === "GET") {
        response = await plexServers(request, env);
      } else if (url.pathname === "/v1/plex/server" && request.method === "POST") {
        response = await selectPlexServer(request, env);
      } else if (url.pathname === "/v1/plex/libraries" && request.method === "GET") {
        response = await plexLibraries(request, env);
      } else if (/^\/v1\/plex\/library\/\d+\/items$/.test(url.pathname) && request.method === "GET") {
        response = await plexLibraryItems(request, env, url.pathname.split("/")[4]);
      } else if (/^\/v1\/plex\/item\/\d+$/.test(url.pathname) && request.method === "GET") {
        response = await plexItem(request, env, url.pathname.split("/")[4]);
      } else if (/^\/v1\/plex\/children\/\d+$/.test(url.pathname) && request.method === "GET") {
        response = await plexChildren(request, env, url.pathname.split("/")[4]);
      } else if (url.pathname === "/v1/plex/image" && request.method === "GET") {
        response = await plexImage(request, env, url.searchParams.get("path") || "");
      } else if (/^\/v1\/plex\/playback\/\d+$/.test(url.pathname) && request.method === "GET") {
        response = await plexPlaybackInfo(request, env, url.pathname.split("/")[4]);
      } else if (/^\/v1\/plex\/stream\/\d+$/.test(url.pathname) && ["GET", "HEAD"].includes(request.method)) {
        response = await plexStream(request, env, url.pathname.split("/")[4]);
      } else if (url.pathname === "/health") {
        response = json({
          ok: true,
          streamConfigured: Boolean(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN),
          pairingStorageConfigured: Boolean(env.PAIRING_SESSION),
          plexStorageConfigured: Boolean(env.PLEX_SESSION)
        });
      } else {
        response = json({ error: "Not found" }, 404);
      }
      const headers = new Headers(response.headers);
      Object.entries(cors).forEach(([key, value]) => headers.set(key, value));
      if (!url.pathname.startsWith("/v1/plex/stream/") && url.pathname !== "/v1/plex/image") headers.set("Cache-Control", "no-store");
      return new Response(response.body, { status: response.status, headers });
    } catch (error) {
      console.error(error);
      const message = error instanceof PublicError || error instanceof HttpError
        ? error.message
        : "The pairing service could not complete the request.";
      const response = json({ error: message }, error instanceof HttpError ? error.status : error instanceof PublicError ? 502 : 500);
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
  if (password.length > 128) {
    return json({ error: "The session credential is invalid." }, 400);
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
      rtmpsURL: liveInput.rtmpsURL,
      rtmpsStreamKey: liveInput.rtmpsStreamKey,
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
  if ((body.password || "").length > 128) {
    return json({ error: "The session credential is invalid." }, 400);
  }
  const viewerSecret = randomToken();
  const response = await env.PAIRING_SESSION.getByName(code).fetch("https://session/iphone/join", {
    method: "POST",
    body: JSON.stringify({ viewerSecret, password: body.password || "" })
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

async function startPlexAuth(env: Env): Promise<Response> {
  const response = await fetch("https://plex.tv/api/v2/pins?strong=true", {
    method: "POST",
    headers: plexHeaders()
  });
  const pin = await response.json<{ id?: number; code?: string }>();
  if (!response.ok || !pin.id || !pin.code) throw new PublicError("Plex could not start authorization.");
  const session = randomToken();
  const expiresAt = Date.now() + PLEX_SESSION_TTL_MS;
  await env.PLEX_SESSION.getByName(session).fetch("https://plex/store", {
    method: "POST",
    body: JSON.stringify({ pinId: pin.id, pinCode: pin.code, expiresAt })
  });
  const forwardUrl = `${env.ALLOWED_ORIGIN}/Code-edge/#media`;
  const authUrl = new URL("https://app.plex.tv/auth");
  authUrl.hash = `?${new URLSearchParams({
    clientID: PLEX_CLIENT_ID,
    code: pin.code,
    forwardUrl,
    "context[device][product]": PLEX_PRODUCT
  }).toString()}`;
  return json({ session, authUrl: authUrl.toString(), expiresAt: new Date(expiresAt).toISOString() });
}

async function plexAuthStatus(request: Request, env: Env): Promise<Response> {
  const auth = await readPlexState(request, env, false);
  if (auth.state.plexToken) return json(plexPublicSession(auth.state));
  const response = await fetch(`https://plex.tv/api/v2/pins/${auth.state.pinId}`, { headers: plexHeaders() });
  const pin = await response.json<{ authToken?: string | null }>();
  if (!response.ok) throw new PublicError("Plex authorization could not be checked.");
  if (!pin.authToken) return json({ authenticated: false });

  const [userResponse, resourcesResponse] = await Promise.all([
    fetch("https://plex.tv/api/v2/user", { headers: plexHeaders(pin.authToken) }),
    fetch("https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1", { headers: plexHeaders(pin.authToken) })
  ]);
  const user = await userResponse.json<{ username?: string; email?: string }>();
  const resources = await resourcesResponse.json<Array<Record<string, unknown>>>();
  if (!userResponse.ok || !resourcesResponse.ok) throw new PublicError("Plex account information could not be loaded.");
  const servers = parsePlexServers(resources, pin.authToken);
  const updated: Partial<PlexState> = {
    plexToken: pin.authToken,
    username: user.username || user.email || "Plex account",
    servers,
    selectedServerId: servers[0]?.id
  };
  await auth.stub.fetch("https://plex/update", { method: "POST", body: JSON.stringify(updated) });
  return json(plexPublicSession({ ...auth.state, ...updated }));
}

async function plexLogout(request: Request, env: Env): Promise<Response> {
  const session = bearerToken(request) || new URL(request.url).searchParams.get("session") || "";
  if (session) await env.PLEX_SESSION.getByName(session).fetch("https://plex/delete", { method: "POST" });
  return json({ ok: true });
}

async function plexServers(request: Request, env: Env): Promise<Response> {
  const auth = await readPlexState(request, env);
  const response = await fetch("https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1", { headers: plexHeaders(auth.state.plexToken) });
  if (!response.ok) throw new PublicError("Plex server connections could not be refreshed.");
  const servers = parsePlexServers(await response.json<Array<Record<string, unknown>>>(), auth.state.plexToken || "");
  const selectedServerId = servers.some((server) => server.id === auth.state.selectedServerId) ? auth.state.selectedServerId : servers[0]?.id;
  await auth.stub.fetch("https://plex/update", { method: "POST", body: JSON.stringify({ servers, selectedServerId }) });
  return json(plexPublicSession({ ...auth.state, servers, selectedServerId }));
}

async function selectPlexServer(request: Request, env: Env): Promise<Response> {
  const auth = await readPlexState(request, env);
  const body = await request.json<{ serverId?: string }>();
  if (!auth.state.servers?.some((server) => server.id === body.serverId)) return json({ error: "Plex server not found." }, 404);
  await auth.stub.fetch("https://plex/update", { method: "POST", body: JSON.stringify({ selectedServerId: body.serverId }) });
  return json({ ok: true });
}

async function plexLibraries(request: Request, env: Env): Promise<Response> {
  const auth = await readPlexState(request, env);
  const payload = await plexServerJson(auth.state, "/library/sections");
  const directories = plexArray(payload, "Directory");
  return json({ libraries: directories.filter((item) => ["movie", "show"].includes(String(item.type))).map((item) => ({
    key: String(item.key || ""), title: String(item.title || "Library"), type: String(item.type || "")
  })) });
}

async function plexLibraryItems(request: Request, env: Env, libraryKey: string): Promise<Response> {
  const auth = await readPlexState(request, env);
  const payload = await plexServerJson(auth.state, `/library/sections/${libraryKey}/all?sort=titleSort`);
  return json({ items: plexArray(payload, "Metadata").slice(0, 500).map((item) => normalizePlexItem(item)) });
}

async function plexItem(request: Request, env: Env, ratingKey: string): Promise<Response> {
  const auth = await readPlexState(request, env);
  const payload = await plexServerJson(auth.state, `/library/metadata/${ratingKey}`);
  const item = plexArray(payload, "Metadata")[0];
  if (!item) return json({ error: "Media item not found." }, 404);
  return json({ item: normalizePlexItem(item, true) });
}

async function plexChildren(request: Request, env: Env, ratingKey: string): Promise<Response> {
  const auth = await readPlexState(request, env);
  const payload = await plexServerJson(auth.state, `/library/metadata/${ratingKey}/children`);
  return json({ items: plexArray(payload, "Metadata").map((item) => normalizePlexItem(item, true)) });
}

async function plexImage(request: Request, env: Env, path: string): Promise<Response> {
  const auth = await readPlexState(request, env, true);
  if (!safePlexPath(path)) return json({ error: "Invalid image path." }, 400);
  const upstream = await plexServerFetch(auth.state, path, { headers: { "Accept": "image/*" } });
  if (!upstream.ok) return json({ error: "Artwork unavailable." }, upstream.status);
  const headers = copyMediaHeaders(upstream.headers);
  headers.set("Cache-Control", "private, max-age=3600");
  return new Response(upstream.body, { status: upstream.status, headers });
}

async function plexPlaybackInfo(request: Request, env: Env, ratingKey: string): Promise<Response> {
  const auth = await readPlexState(request, env);
  const item = await plexRawItem(auth.state, ratingKey);
  const media = Array.isArray(item.Media) ? item.Media[0] as Record<string, unknown> : undefined;
  const part = media && Array.isArray(media.Part) ? media.Part[0] as Record<string, unknown> : undefined;
  if (!part?.key) return json({ error: "No playable file was found." }, 404);
  const direct = browserDirectPlay(media || {});
  const session = bearerToken(request) || "";
  return json({
    url: `${new URL(request.url).origin}/v1/plex/stream/${ratingKey}?session=${encodeURIComponent(session)}`,
    mode: direct ? "direct" : "transcode",
    note: direct ? "Direct Play: the browser supports this container and codec." : "Plex is converting this file to H.264/AAC MP4 for browser playback."
  });
}

async function plexStream(request: Request, env: Env, ratingKey: string): Promise<Response> {
  const auth = await readPlexState(request, env, true);
  const item = await plexRawItem(auth.state, ratingKey);
  const media = Array.isArray(item.Media) ? item.Media[0] as Record<string, unknown> : undefined;
  const part = media && Array.isArray(media.Part) ? media.Part[0] as Record<string, unknown> : undefined;
  if (!part?.key) return json({ error: "No playable file was found." }, 404);
  let path = String(part.key);
  if (!browserDirectPlay(media || {})) {
    const params = new URLSearchParams({
      path: `/library/metadata/${ratingKey}`,
      mediaIndex: "0", partIndex: "0", protocol: "http", fastSeek: "1",
      directPlay: "0", directStream: "0", container: "mp4", videoCodec: "h264",
      audioCodec: "aac", maxVideoBitrate: "12000", videoQuality: "100",
      session: `${new URL(request.url).searchParams.get("session") || "plex"}-${ratingKey}`, "X-Plex-Client-Identifier": PLEX_CLIENT_ID
    });
    path = `/video/:/transcode/universal/start.mp4?${params}`;
  }
  const headers: Record<string, string> = {};
  const range = request.headers.get("Range");
  if (range) headers.Range = range;
  const upstream = await plexServerFetch(auth.state, path, { method: request.method, headers });
  const outgoing = copyMediaHeaders(upstream.headers);
  outgoing.set("Cache-Control", "private, no-store");
  return new Response(request.method === "HEAD" ? null : upstream.body, { status: upstream.status, headers: outgoing });
}

async function readPlexState(request: Request, env: Env, allowQuery = false): Promise<{ state: PlexState; stub: DurableObjectStub<PlexSession> }> {
  const session = bearerToken(request) || (allowQuery ? new URL(request.url).searchParams.get("session") : "") || "";
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(session)) throw new HttpError("Connect your Plex account first.", 401);
  const stub = env.PLEX_SESSION.getByName(session);
  const response = await stub.fetch("https://plex/read");
  const state = await response.json<PlexState & { error?: string }>();
  if (!response.ok) throw new HttpError(state.error || "Plex session expired.", response.status);
  if (!state.plexToken && !request.url.includes("/auth/status")) throw new HttpError("Finish signing in with Plex.", 401);
  return { state, stub };
}

function plexPublicSession(state: PlexState) {
  return {
    authenticated: Boolean(state.plexToken),
    username: state.username,
    selectedServerId: state.selectedServerId,
    servers: (state.servers || []).map(({ id, name }) => ({ id, name }))
  };
}

function plexHeaders(token?: string): Record<string, string> {
  return {
    "Accept": "application/json",
    "X-Plex-Product": PLEX_PRODUCT,
    "X-Plex-Version": "1.0",
    "X-Plex-Client-Identifier": PLEX_CLIENT_ID,
    "X-Plex-Platform": "Web",
    "X-Plex-Device": "Cloudflare Worker",
    "X-Plex-Device-Name": PLEX_PRODUCT,
    "X-Plex-Provides": "player",
    ...(token ? { "X-Plex-Token": token } : {})
  };
}

function bearerToken(request: Request): string {
  const match = request.headers.get("Authorization")?.match(/^Bearer ([A-Za-z0-9_-]+)$/);
  return match?.[1] || "";
}

function selectedPlexServer(state: PlexState): PlexServer {
  const server = state.servers?.find((entry) => entry.id === state.selectedServerId) || state.servers?.[0];
  if (!server) throw new HttpError("No securely reachable Plex Media Server was found.", 404);
  return server;
}

async function plexServerFetch(state: PlexState, path: string, init: RequestInit = {}): Promise<Response> {
  if (!safePlexPath(path)) throw new HttpError("Invalid Plex request.", 400);
  const server = selectedPlexServer(state);
  const headers = new Headers(init.headers);
  Object.entries(plexHeaders(server.accessToken || state.plexToken)).forEach(([key, value]) => headers.set(key, value));
  const uris = [...new Set([...(server.uris || []), ...(server.uri ? [server.uri] : [])])];
  let lastResponse: Response | undefined;
  for (const uri of uris) {
    try {
      const response = await fetch(`${uri}${path}`, { ...init, headers, redirect: "follow" });
      lastResponse = response;
      if (![401, 403, 502, 503, 504].includes(response.status)) return response;
    } catch { /* Try the next Plex-provided secure connection. */ }
  }
  if (lastResponse) return lastResponse;
  throw new HttpError("Plex could not reach this server securely. Enable Remote Access in Plex Server settings.", 502);
}

async function plexServerJson(state: PlexState, path: string): Promise<Record<string, unknown>> {
  const response = await plexServerFetch(state, path);
  if (!response.ok) throw new PublicError(`Plex Media Server returned HTTP ${response.status}.`);
  return response.json<Record<string, unknown>>();
}

async function plexRawItem(state: PlexState, ratingKey: string): Promise<Record<string, unknown>> {
  const payload = await plexServerJson(state, `/library/metadata/${ratingKey}`);
  const item = plexArray(payload, "Metadata")[0];
  if (!item) throw new HttpError("Media item not found.", 404);
  return item;
}

function plexArray(payload: Record<string, unknown>, key: string): Array<Record<string, unknown>> {
  const container = payload.MediaContainer as Record<string, unknown> | undefined;
  return container && Array.isArray(container[key]) ? container[key] as Array<Record<string, unknown>> : [];
}

function normalizePlexItem(item: Record<string, unknown>, detailed = false) {
  const media = Array.isArray(item.Media) ? item.Media[0] as Record<string, unknown> : undefined;
  const result: Record<string, unknown> = {
    ratingKey: String(item.ratingKey || ""), type: String(item.type || ""), title: String(item.title || "Untitled"),
    year: Number(item.year) || null, thumb: typeof item.thumb === "string" ? item.thumb : null,
    summary: detailed ? String(item.summary || "") : undefined,
    index: Number(item.index) || null, parentIndex: Number(item.parentIndex) || null,
    parentTitle: String(item.parentTitle || ""), grandparentTitle: String(item.grandparentTitle || ""),
    duration: Number(item.duration) || null
  };
  if (detailed && media) result.media = {
    container: String(media.container || ""), videoCodec: String(media.videoCodec || ""),
    audioCodec: String(media.audioCodec || ""), width: Number(media.width) || null,
    height: Number(media.height) || null, bitrate: Number(media.bitrate) || null
  };
  return result;
}

function browserDirectPlay(media: Record<string, unknown>): boolean {
  const container = String(media.container || "").toLowerCase();
  const video = String(media.videoCodec || "").toLowerCase();
  const audio = String(media.audioCodec || "").toLowerCase();
  return ["mp4", "webm"].includes(container) && ["h264", "av1", "vp8", "vp9"].includes(video) && ["aac", "mp3", "opus", "vorbis", ""].includes(audio);
}

function safePlexPath(path: string): boolean {
  return path.startsWith("/") && !path.includes("://") && !path.includes("\\") && !path.includes("\u0000");
}

function isSecurePlexUri(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

function parsePlexServers(resources: Array<Record<string, unknown>>, accountToken: string): PlexServer[] {
  return resources.filter((resource) => String(resource.provides || "").split(",").includes("server")).flatMap((resource) => {
    const connections = Array.isArray(resource.connections) ? resource.connections as Array<Record<string, unknown>> : [];
    const secure = connections.filter((entry) => isSecurePlexUri(entry.uri)).sort((left, right) => connectionRank(left) - connectionRank(right));
    if (!secure.length) return [];
    return [{
      id: String(resource.clientIdentifier || ""),
      name: String(resource.name || "Plex Server"),
      uris: secure.map((entry) => String(entry.uri).replace(/\/$/, "")),
      accessToken: String(resource.accessToken || accountToken)
    }];
  }).filter((server) => server.id);
}

function connectionRank(connection: Record<string, unknown>): number {
  if (!connection.local && !connection.relay) return 0;
  if (connection.relay) return 1;
  return 2;
}

function copyMediaHeaders(source: Headers): Headers {
  const output = new Headers();
  ["Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified"].forEach((name) => {
    const value = source.get(name); if (value) output.set(name, value);
  });
  return output;
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
  const rtmpsURL = payload.result?.rtmps?.url;
  const rtmpsStreamKey = payload.result?.rtmps?.streamKey;
  if (!response.ok || !payload.success || !whipPublishURL || !whepPlaybackURL || !rtmpsURL || !rtmpsStreamKey) {
    throw new PublicError(
      `Cloudflare Stream rejected the Live Input request: ${payload.errors?.[0]?.message || `HTTP ${response.status}`}`
    );
  }
  return { whipPublishURL, whepPlaybackURL, rtmpsURL, rtmpsStreamKey };
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("Origin") || "";
  const allowed = origin === env.ALLOWED_ORIGIN || origin === "http://localhost:8080";
  return {
    "Access-Control-Allow-Origin": allowed ? origin : env.ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Range",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges",
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
class HttpError extends Error { constructor(message: string, public status: number) { super(message); } }
