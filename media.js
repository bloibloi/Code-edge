"use strict";

(() => {
  const API = String(window.IPHONE_REMOTE_API || "").replace(/\/$/, "");
  const SESSION_KEY = "remote-screen-plex-session";
  const el = Object.fromEntries([
    "plexConnect", "plexConnectButton", "plexApp", "plexAccountName", "plexSignOut", "plexServer",
    "plexLibrary", "plexTitle", "plexOpenTitle", "plexMessage", "plexDetails", "plexDetailsClose",
    "plexDetailsPoster", "plexDetailsType", "plexDetailsTitle", "plexDetailsMeta", "plexDetailsSummary",
    "plexEpisodeControls", "plexSeason", "plexEpisode", "plexPlayButton", "plexPlayerWrap", "plexPlayer",
    "plexPlaybackNote"
  ].map((id) => [id, document.getElementById(id)]));
  if (!el.plexConnect) return;

  let session = localStorage.getItem(SESSION_KEY) || "";
  let selectedItem = null;
  let seasons = [];
  let authTimer = null;

  async function request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (session) headers.set("Authorization", `Bearer ${session}`);
    const response = await fetch(`${API}${path}`, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }

  function message(text, error = false) {
    el.plexMessage.textContent = text;
    el.plexMessage.style.color = error ? "var(--red)" : "";
  }

  function posterUrl(path) {
    return path ? `${API}/v1/plex/image?path=${encodeURIComponent(path)}&session=${encodeURIComponent(session)}` : "";
  }

  async function connect() {
    const popup = window.open("about:blank", "plex-auth", "popup,width=700,height=760");
    el.plexConnectButton.disabled = true;
    el.plexConnectButton.textContent = "Opening Plex…";
    try {
      const auth = await request("/v1/plex/auth/start", { method: "POST" });
      session = auth.session;
      localStorage.setItem(SESSION_KEY, session);
      if (popup) popup.location.href = auth.authUrl;
      else window.open(auth.authUrl, "_blank", "noopener");
      el.plexConnectButton.textContent = "Waiting for Plex…";
      let attempts = 0;
      clearInterval(authTimer);
      authTimer = setInterval(async () => {
        attempts += 1;
        try {
          const status = await request("/v1/plex/auth/status");
          if (status.authenticated) {
            clearInterval(authTimer);
            if (popup && !popup.closed) popup.close();
            await showApp(status);
          } else if (attempts >= 120) {
            clearInterval(authTimer);
            throw new Error("Plex sign-in timed out. Try again.");
          }
        } catch (error) {
          clearInterval(authTimer);
          resetConnect(error.message);
        }
      }, 1500);
    } catch (error) {
      if (popup && !popup.closed) popup.close();
      resetConnect(error.message);
    }
  }

  function resetConnect(error = "") {
    el.plexConnect.classList.remove("hidden");
    el.plexApp.classList.add("hidden");
    el.plexSignOut.classList.add("hidden");
    el.plexConnectButton.disabled = false;
    el.plexConnectButton.textContent = error ? "Try Plex sign-in again" : "Sign in with Plex";
    if (error) {
      const paragraph = el.plexConnect.querySelector("p:last-child");
      paragraph.textContent = error;
      paragraph.style.color = "var(--red)";
    }
  }

  async function restore() {
    if (!session) return;
    try { await showApp(await request("/v1/plex/servers")); }
    catch { session = ""; localStorage.removeItem(SESSION_KEY); resetConnect(); }
  }

  async function showApp(status) {
    el.plexConnect.classList.add("hidden");
    el.plexApp.classList.remove("hidden");
    el.plexSignOut.classList.remove("hidden");
    el.plexAccountName.textContent = status.username || "Plex connected";
    el.plexServer.replaceChildren(...(status.servers || []).map((server) => option(server.id, server.name)));
    if (status.selectedServerId) el.plexServer.value = status.selectedServerId;
    if (!status.servers?.length) {
      message("No securely reachable Plex Media Server was found. Enable Plex Remote Access and secure connections.", true);
      return;
    }
    await loadLibraries();
  }

  async function loadLibraries() {
    message("Loading libraries…");
    try {
      const data = await request("/v1/plex/libraries");
      el.plexLibrary.replaceChildren(...data.libraries.map((library) => option(library.key, `${library.title} · ${library.type === "show" ? "TV Shows" : "Movies"}`)));
      if (!data.libraries.length) return message("No movie or TV libraries were found.", true);
      await loadItems();
    } catch (error) { message(error.message, true); }
  }

  async function loadItems() {
    const key = el.plexLibrary.value;
    if (!key) return;
    message("Loading title names…");
    el.plexTitle.disabled = true;
    el.plexOpenTitle.disabled = true;
    el.plexTitle.replaceChildren(option("", "Loading titles…"));
    try {
      const data = await request(`/v1/plex/library/${encodeURIComponent(key)}/items`);
      const items = data.items || [];
      el.plexTitle.replaceChildren(option("", "Choose a title…"), ...items.map((item) => option(item.ratingKey, [item.title, item.year].filter(Boolean).join(" · "))));
      el.plexTitle.disabled = items.length === 0;
      message(items.length ? `${items.length} title names ready. Full details and media load only after you choose one.` : "No titles were found in this library.", items.length === 0);
    } catch (error) { message(error.message, true); }
  }

  async function openDetails(ratingKey) {
    try {
      const data = await request(`/v1/plex/item/${encodeURIComponent(ratingKey)}`);
      selectedItem = data.item;
      el.plexDetailsType.textContent = selectedItem.type === "show" ? "TV SHOW" : "MOVIE";
      el.plexDetailsTitle.textContent = selectedItem.title;
      el.plexDetailsMeta.textContent = detailMeta(selectedItem);
      el.plexDetailsSummary.textContent = selectedItem.summary || "No summary is available.";
      el.plexDetailsPoster.src = posterUrl(selectedItem.thumb);
      el.plexDetailsPoster.alt = selectedItem.thumb ? `${selectedItem.title} poster` : "";
      el.plexPlayer.pause(); el.plexPlayer.removeAttribute("src"); el.plexPlayer.load();
      el.plexPlayerWrap.classList.add("hidden");
      el.plexEpisodeControls.classList.toggle("hidden", selectedItem.type !== "show");
      el.plexPlayButton.disabled = false;
      el.plexPlayButton.textContent = selectedItem.type === "show" ? "Play episode" : "Play";
      el.plexDetails.showModal();
      if (selectedItem.type === "show") await loadSeasons(selectedItem.ratingKey);
    } catch (error) { message(error.message, true); }
  }

  async function loadSeasons(showKey) {
    const data = await request(`/v1/plex/children/${encodeURIComponent(showKey)}`);
    seasons = (data.items || []).filter((item) => item.type === "season");
    el.plexSeason.replaceChildren(...seasons.map((season) => option(season.ratingKey, season.title)));
    await loadEpisodes();
  }

  async function loadEpisodes() {
    if (!el.plexSeason.value) return;
    const data = await request(`/v1/plex/children/${encodeURIComponent(el.plexSeason.value)}`);
    const episodes = (data.items || []).filter((item) => item.type === "episode");
    el.plexEpisode.replaceChildren(...episodes.map((episode) => option(episode.ratingKey, `${episode.index || "–"}. ${episode.title}`)));
  }

  async function play() {
    const ratingKey = selectedItem?.type === "show" ? el.plexEpisode.value : selectedItem?.ratingKey;
    if (!ratingKey) return;
    el.plexPlayButton.disabled = true; el.plexPlayButton.textContent = "Preparing…";
    try {
      const playback = await request(`/v1/plex/playback/${encodeURIComponent(ratingKey)}`);
      el.plexPlayer.src = playback.url;
      el.plexPlaybackNote.textContent = playback.note;
      el.plexPlayerWrap.classList.remove("hidden");
      await el.plexPlayer.play();
      el.plexPlayerWrap.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (error) { el.plexPlaybackNote.textContent = error.message; el.plexPlayerWrap.classList.remove("hidden"); }
    finally { el.plexPlayButton.disabled = false; el.plexPlayButton.textContent = selectedItem?.type === "show" ? "Play episode" : "Play"; }
  }

  function option(value, label) { const node = document.createElement("option"); node.value = value; node.textContent = label; return node; }
  function detailMeta(item) {
    const values = [item.year];
    if (item.media?.width && item.media?.height) values.push(`${item.media.width}×${item.media.height}`);
    if (item.media?.container) values.push(String(item.media.container).toUpperCase());
    if (item.media?.videoCodec) values.push(String(item.media.videoCodec).toUpperCase());
    return values.filter(Boolean).join(" · ");
  }

  el.plexConnectButton.addEventListener("click", connect);
  el.plexServer.addEventListener("change", async () => { await request("/v1/plex/server", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ serverId: el.plexServer.value }) }); await loadLibraries(); });
  el.plexLibrary.addEventListener("change", loadItems);
  el.plexTitle.addEventListener("change", () => { el.plexOpenTitle.disabled = !el.plexTitle.value; });
  el.plexOpenTitle.addEventListener("click", () => { if (el.plexTitle.value) openDetails(el.plexTitle.value); });
  el.plexSeason.addEventListener("change", loadEpisodes);
  el.plexPlayButton.addEventListener("click", play);
  el.plexDetailsClose.addEventListener("click", () => el.plexDetails.close());
  el.plexDetails.addEventListener("close", () => { el.plexPlayer.pause(); el.plexPlayer.removeAttribute("src"); el.plexPlayer.load(); });
  el.plexDetails.addEventListener("click", (event) => { if (event.target === el.plexDetails) el.plexDetails.close(); });
  el.plexSignOut.addEventListener("click", async () => { try { await request("/v1/plex/logout", { method: "POST" }); } catch {} session = ""; localStorage.removeItem(SESSION_KEY); el.plexTitle.replaceChildren(option("", "Choose a library first")); resetConnect(); });
  restore();
})();
