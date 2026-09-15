"use strict";

(() => {
  const API = String(window.IPHONE_REMOTE_API || "").replace(/\/$/, "");
  const SESSION_KEY = "remote-screen-plex-session";
  const el = Object.fromEntries([
    "plexConnect", "plexConnectButton", "plexLoginForm", "plexLoginMessage", "plexPassword", "plexApp", "plexAccountName", "plexSignOut", "plexServer",
    "plexLibrary", "plexTitle", "plexOpenTitle", "plexMessage", "plexDetails", "plexDetailsClose",
    "plexDetailsPoster", "plexDetailsType", "plexDetailsTitle", "plexDetailsMeta", "plexDetailsSummary",
    "plexEpisodeControls", "plexSeason", "plexEpisode", "plexPlayButton", "plexPlayerWrap", "plexPlayer",
    "plexPlaybackNote"
  ].map((id) => [id, document.getElementById(id)]));
  if (!el.plexConnect) return;

  let session = localStorage.getItem(SESSION_KEY) || "";
  let selectedItem = null;
  let seasons = [];
  let hlsPlayer = null;
  let hlsManifestUrl = "";

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
    el.plexConnectButton.disabled = true;
    el.plexConnectButton.textContent = "Unlocking…";
    el.plexLoginMessage.style.color = "";
    try {
      const auth = await request("/v1/plex/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: el.plexPassword.value })
      });
      session = auth.session;
      localStorage.setItem(SESSION_KEY, session);
      el.plexPassword.value = "";
      await showApp(auth);
    } catch (error) {
      resetConnect(error.message);
    }
  }

  function resetConnect(error = "") {
    el.plexConnect.classList.remove("hidden");
    el.plexApp.classList.add("hidden");
    el.plexSignOut.classList.add("hidden");
    el.plexConnectButton.disabled = false;
    el.plexConnectButton.textContent = "Unlock Media";
    if (error) {
      el.plexLoginMessage.textContent = error;
      el.plexLoginMessage.style.color = "var(--red)";
    } else {
      el.plexLoginMessage.textContent = "Enter the website password. Your Plex token stays securely inside the Cloudflare Worker and is never sent to this browser.";
      el.plexLoginMessage.style.color = "";
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
    el.plexLibrary.disabled = true;
    el.plexTitle.disabled = true;
    el.plexOpenTitle.disabled = true;
    el.plexTitle.replaceChildren(option("", "Choose a library first"));
    try {
      const data = await request("/v1/plex/libraries");
      el.plexLibrary.replaceChildren(...data.libraries.map((library) => option(library.key, `${library.title} · ${library.type === "show" ? "TV Shows" : "Movies"}`)));
      if (!data.libraries.length) return message("No movie or TV libraries were found.", true);
      el.plexLibrary.disabled = false;
      await loadItems();
    } catch (error) {
      el.plexLibrary.replaceChildren(option("", "Libraries unavailable"));
      message(error.message, true);
    }
  }

  async function loadItems() {
    const key = el.plexLibrary.value;
    if (!key) return;
    message("Loading title names…");
    selectedItem = null;
    el.plexTitle.disabled = true;
    el.plexOpenTitle.disabled = true;
    el.plexTitle.replaceChildren(option("", "Loading titles…"));
    try {
      const data = await request(`/v1/plex/library/${encodeURIComponent(key)}/items`);
      const items = data.items || [];
      el.plexTitle.replaceChildren(option("", "Choose a title…"), ...items.map((item) => option(item.ratingKey, [item.title, item.year].filter(Boolean).join(" · "))));
      el.plexTitle.disabled = items.length === 0;
      message(items.length ? `${items.length} title names ready. Full details and media load only after you choose one.` : "No titles were found in this library.", items.length === 0);
    } catch (error) {
      el.plexTitle.replaceChildren(option("", "Titles unavailable"));
      message(error.message, true);
    }
  }

  async function openDetails(ratingKey) {
    try {
      const data = await request(`/v1/plex/item/${encodeURIComponent(ratingKey)}`);
      selectedItem = data.item;
      el.plexDetailsType.textContent = selectedItem.type === "show" ? "TV SHOW" : "MOVIE";
      el.plexDetailsTitle.textContent = selectedItem.title;
      el.plexDetailsMeta.textContent = detailMeta(selectedItem);
      el.plexDetailsSummary.textContent = selectedItem.summary || "No summary is available.";
      const poster = posterUrl(selectedItem.thumb);
      if (poster) el.plexDetailsPoster.src = poster;
      else el.plexDetailsPoster.removeAttribute("src");
      el.plexDetailsPoster.hidden = !poster;
      el.plexDetailsPoster.alt = poster ? `${selectedItem.title} poster` : "";
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
      destroyHlsPlayer();
      let hlsReady = false;
      if (playback.mode === "hls" && window.Hls?.isSupported()) {
        el.plexPlaybackNote.textContent = "Plex is preparing a browser-compatible stream. This can take up to 90 seconds for a large file.";
        el.plexPlayerWrap.classList.remove("hidden");
        const controller = new AbortController();
        const preparationTimeout = setTimeout(() => controller.abort(), 90000);
        let manifestResponse;
        try { manifestResponse = await fetch(playback.url, { signal: controller.signal }); }
        catch (error) {
          if (error.name === "AbortError") throw new Error("Plex did not return the stream within 90 seconds. Check the Plex Dashboard to confirm the server started transcoding.");
          throw error;
        } finally { clearTimeout(preparationTimeout); }
        if (!manifestResponse.ok) {
          const failureText = await manifestResponse.text();
          let failure = {};
          try { failure = JSON.parse(failureText); } catch { failure = { error: failureText }; }
          throw new Error(failure.error || `Plex transcoder returned HTTP ${manifestResponse.status}.`);
        }
        const manifest = await manifestResponse.text();
        if (!manifest.startsWith("#EXTM3U")) throw new Error("Plex returned an invalid HLS playlist.");
        hlsManifestUrl = URL.createObjectURL(new Blob([manifest], { type: "application/vnd.apple.mpegurl" }));
        hlsPlayer = new window.Hls({ enableWorker: true, lowLatencyMode: false, maxBufferLength: 45 });
        const ready = new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("The HLS player could not parse Plex’s playlist.")), 15000);
          hlsPlayer.once(window.Hls.Events.MANIFEST_PARSED, () => { hlsReady = true; clearTimeout(timeout); resolve(); });
          hlsPlayer.on(window.Hls.Events.ERROR, (_event, data) => {
            if (!data.fatal) return;
            if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
              hlsPlayer.recoverMediaError();
              return;
            }
            const status = data.response?.code ? ` HTTP ${data.response.code}` : "";
            const detail = `Plex HLS ${data.details || data.type || "playback error"}.${status}`;
            if (!hlsReady) { clearTimeout(timeout); reject(new Error(detail)); }
            else el.plexPlaybackNote.textContent = detail;
          });
        });
        hlsPlayer.loadSource(hlsManifestUrl);
        hlsPlayer.attachMedia(el.plexPlayer);
        await ready;
      } else if (playback.mode === "hls" && el.plexPlayer.canPlayType("application/vnd.apple.mpegurl")) {
        el.plexPlayer.src = playback.url;
        el.plexPlayer.load();
      } else if (playback.mode === "hls") {
        throw new Error("This browser cannot play Plex HLS video. Open Code-edge in current Chrome or Safari.");
      } else {
        el.plexPlayer.src = playback.url;
        el.plexPlayer.load();
      }
      el.plexPlaybackNote.textContent = playback.note;
      el.plexPlayerWrap.classList.remove("hidden");
      el.plexPlayer.muted = true;
      el.plexPlaybackNote.textContent = `${playback.note} Starting playback muted…`;
      el.plexPlayerWrap.scrollIntoView({ behavior: "smooth", block: "nearest" });
      await startPreparedVideo();
      el.plexPlaybackNote.textContent = `${playback.note} Playing muted—use the player’s volume control for sound.`;
    } catch (error) { el.plexPlaybackNote.textContent = error.message; el.plexPlayerWrap.classList.remove("hidden"); }
    finally { el.plexPlayButton.disabled = false; el.plexPlayButton.textContent = selectedItem?.type === "show" ? "Play episode" : "Play"; }
  }

  async function startPreparedVideo() {
    let timer;
    try {
      await Promise.race([
        el.plexPlayer.play(),
        new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Plex loaded the playlist, but no video segments arrived within 45 seconds.")), 45000); })
      ]);
    } finally { clearTimeout(timer); }
  }

  function destroyHlsPlayer() {
    if (hlsPlayer) { hlsPlayer.destroy(); hlsPlayer = null; }
    if (hlsManifestUrl) { URL.revokeObjectURL(hlsManifestUrl); hlsManifestUrl = ""; }
    el.plexPlayer.pause();
    el.plexPlayer.removeAttribute("src");
    el.plexPlayer.load();
  }

  function option(value, label) { const node = document.createElement("option"); node.value = value; node.textContent = label; return node; }
  function detailMeta(item) {
    const values = [item.year];
    if (item.media?.width && item.media?.height) values.push(`${item.media.width}×${item.media.height}`);
    if (item.media?.container) values.push(String(item.media.container).toUpperCase());
    if (item.media?.videoCodec) values.push(String(item.media.videoCodec).toUpperCase());
    return values.filter(Boolean).join(" · ");
  }

  el.plexLoginForm.addEventListener("submit", (event) => { event.preventDefault(); connect(); });
  el.plexServer.addEventListener("change", async () => {
    el.plexServer.disabled = true;
    try {
      await request("/v1/plex/server", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ serverId: el.plexServer.value }) });
      await loadLibraries();
    } catch (error) { message(error.message, true); }
    finally { el.plexServer.disabled = false; }
  });
  el.plexLibrary.addEventListener("change", loadItems);
  el.plexTitle.addEventListener("change", () => { el.plexOpenTitle.disabled = !el.plexTitle.value; });
  el.plexOpenTitle.addEventListener("click", () => { if (el.plexTitle.value) openDetails(el.plexTitle.value); });
  el.plexSeason.addEventListener("change", loadEpisodes);
  el.plexPlayButton.addEventListener("click", play);
  el.plexDetailsClose.addEventListener("click", () => el.plexDetails.close());
  el.plexDetails.addEventListener("close", destroyHlsPlayer);
  el.plexDetails.addEventListener("click", (event) => { if (event.target === el.plexDetails) el.plexDetails.close(); });
  el.plexSignOut.addEventListener("click", async () => { try { await request("/v1/plex/logout", { method: "POST" }); } catch {} session = ""; localStorage.removeItem(SESSION_KEY); el.plexTitle.replaceChildren(option("", "Choose a library first")); resetConnect(); });
  restore();
})();
