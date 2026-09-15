"use strict";

const STORAGE_KEY = "iphone-screen-playback-url";
const LEGACY_STORAGE_KEY = "iphone-screen-whep-url";
const RETRY_DELAY = 5000;
const PAIR_POLL_DELAY = 1500;
const PAIRING_API = String(window.IPHONE_REMOTE_API || "").replace(/\/$/, "");

const elements = {
  status: document.querySelector("#status"),
  statusText: document.querySelector("#statusText"),
  video: document.querySelector("#screenVideo"),
  frame: document.querySelector("#streamFrame"),
  stage: document.querySelector("#stage"),
  emptyState: document.querySelector("#emptyState"),
  emptyTitle: document.querySelector("#emptyTitle"),
  emptyMessage: document.querySelector("#emptyMessage"),
  emptyAction: document.querySelector("#emptyAction"),
  streamMessage: document.querySelector("#streamMessage"),
  playbackUrl: document.querySelector("#playbackUrl"),
  saveButton: document.querySelector("#saveButton"),
  forgetButton: document.querySelector("#forgetButton"),
  pasteButton: document.querySelector("#pasteButton"),
  reconnectButton: document.querySelector("#reconnectButton"),
  muteButton: document.querySelector("#muteButton"),
  fitButton: document.querySelector("#fitButton"),
  fullscreenButton: document.querySelector("#fullscreenButton"),
  liveBadge: document.querySelector("#liveBadge"),
  pairButton: document.querySelector("#pairButton"),
  cancelPairButton: document.querySelector("#cancelPairButton"),
  pairingCode: document.querySelector("#pairingCode"),
  pairingDigits: document.querySelector("#pairingDigits"),
  pairingTimer: document.querySelector("#pairingTimer"),
  pairingCopy: document.querySelector("#pairingCopy"),
  modeTabs: [...document.querySelectorAll("[data-mode]")],
  modePages: [...document.querySelectorAll("[data-page]")],
  desktopPreview: document.querySelector("#desktopPreview"),
  desktopPreviewEmpty: document.querySelector("#desktopPreviewEmpty"),
  desktopLiveBadge: document.querySelector("#desktopLiveBadge"),
  desktopShareCode: document.querySelector("#desktopShareCode"),
  desktopShareDigits: document.querySelector("#desktopShareDigits"),
  desktopShareState: document.querySelector("#desktopShareState"),
  startDesktopButton: document.querySelector("#startDesktopButton"),
  stopDesktopButton: document.querySelector("#stopDesktopButton"),
  desktopJoinCode: document.querySelector("#desktopJoinCode"),
  desktopJoinCopy: document.querySelector("#desktopJoinCopy"),
  joinDesktopButton: document.querySelector("#joinDesktopButton"),
  leaveDesktopButton: document.querySelector("#leaveDesktopButton"),
  desktopWatchVideo: document.querySelector("#desktopWatchVideo"),
  desktopWatchEmpty: document.querySelector("#desktopWatchEmpty"),
  desktopWatchBadge: document.querySelector("#desktopWatchBadge"),
  desktopWatchStage: document.querySelector("#desktopWatchStage"),
  desktopMuteButton: document.querySelector("#desktopMuteButton"),
  desktopFullscreenButton: document.querySelector("#desktopFullscreenButton"),
  toast: document.querySelector("#toast")
};

let peer = null;
let sessionUrl = "";
let retryTimer = null;
let stoppedByUser = false;
let connectionAttempt = 0;
let toastTimer = null;
let playbackMode = "none";
let pairingToken = "";
let pairingExpiresAt = 0;
let pairingTimer = null;
let pairingPollTimer = null;
let activeMode = "watch-iphone";
let desktopHostPeer = null;
let desktopViewerPeer = null;
let desktopCapture = null;
let desktopHostToken = "";
let desktopViewerToken = "";
let desktopAnswerTimer = null;

function setMode(mode, updateHash = true) {
  if (!elements.modePages.some((page) => page.dataset.page === mode)) mode = "watch-iphone";
  activeMode = mode;
  elements.modeTabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.mode === mode));
  elements.modePages.forEach((page) => {
    const selected = page.dataset.page === mode;
    page.classList.toggle("active", selected);
    page.classList.toggle("hidden", !selected);
  });
  if (updateHash && location.hash !== `#${mode}`) history.replaceState(null, "", `#${mode}`);
  if (mode === "stream-desktop") setStatus(desktopCapture ? "live" : "idle", desktopCapture ? "Sharing desktop" : "Ready to share");
  else if (mode === "watch-desktop") setStatus(desktopViewerPeer?.connectionState === "connected" ? "live" : "idle", desktopViewerPeer ? "Connecting desktop" : "Enter a code");
  else if (peer?.connectionState === "connected") setStatus("live", "Live");
  else setStatus(getSavedUrl() ? "waiting" : "idle", getSavedUrl() ? "Waiting for iPhone" : "Ready");
}

function setStatus(state, text) {
  elements.status.dataset.state = state;
  elements.statusText.textContent = text;
}

function setEmpty(title, message, actionText = "Reconnect") {
  elements.emptyTitle.textContent = title;
  elements.emptyMessage.textContent = message;
  elements.emptyAction.textContent = actionText;
  elements.emptyState.classList.remove("hidden");
  elements.liveBadge.classList.remove("visible");
}

function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  toastTimer = setTimeout(() => elements.toast.classList.remove("visible"), 1800);
}

function stopPairing(reset = true) {
  clearInterval(pairingTimer);
  clearTimeout(pairingPollTimer);
  pairingTimer = null;
  pairingPollTimer = null;
  pairingToken = "";
  pairingExpiresAt = 0;
  elements.pairButton.disabled = false;
  elements.pairButton.textContent = "Generate pairing code";
  elements.cancelPairButton.classList.add("hidden");
  if (reset) {
    elements.pairingCode.classList.add("hidden");
    elements.pairingCopy.textContent = "Generate a private code, enter it in the iPhone Remote app, then start the broadcast.";
  }
}

function updatePairingCountdown() {
  const seconds = Math.max(0, Math.ceil((pairingExpiresAt - Date.now()) / 1000));
  const minutes = Math.floor(seconds / 60);
  elements.pairingTimer.textContent = `Expires in ${minutes}:${String(seconds % 60).padStart(2, "0")}`;
  if (seconds === 0) {
    stopPairing(false);
    elements.pairingTimer.textContent = "Code expired";
    elements.pairingCopy.textContent = "Generate a new code to try again.";
  }
}

async function generatePairingCode() {
  if (!PAIRING_API) {
    showToast("Pairing server is not configured yet");
    return;
  }
  stopPairing();
  elements.pairButton.disabled = true;
  elements.pairButton.textContent = "Creating secure session…";
  try {
    const response = await fetch(`${PAIRING_API}/v1/pair/create`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not create a pairing code");
    pairingToken = data.sessionToken;
    pairingExpiresAt = Date.parse(data.expiresAt);
    elements.pairingDigits.textContent = `${data.code.slice(0, 3)} ${data.code.slice(3)}`;
    elements.pairingCode.classList.remove("hidden");
    elements.cancelPairButton.classList.remove("hidden");
    elements.pairButton.textContent = "Waiting for iPhone…";
    elements.pairingCopy.textContent = "Enter this code in the iPhone Remote app.";
    updatePairingCountdown();
    pairingTimer = setInterval(updatePairingCountdown, 1000);
    pollPairingStatus();
  } catch (error) {
    stopPairing();
    showToast(error.message || "Pairing service unavailable");
  }
}

async function pollPairingStatus() {
  if (!pairingToken || Date.now() >= pairingExpiresAt) return;
  try {
    const response = await fetch(`${PAIRING_API}/v1/pair/status?token=${encodeURIComponent(pairingToken)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Pairing expired");
    if (data.paired && classifyUrl(data.playbackURL) === "whep") {
      localStorage.setItem(STORAGE_KEY, data.playbackURL);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      elements.playbackUrl.value = data.playbackURL;
      elements.forgetButton.classList.remove("hidden");
      stopPairing(false);
      elements.pairingTimer.textContent = "iPhone connected";
      elements.pairingCopy.textContent = "Paired. Start the broadcast on your iPhone.";
      showToast("iPhone paired");
      await connectPlayback();
      return;
    }
  } catch (error) {
    stopPairing(false);
    elements.pairingTimer.textContent = "Pairing ended";
    elements.pairingCopy.textContent = error.message || "Generate a new code to try again.";
    return;
  }
  pairingPollTimer = setTimeout(pollPairingStatus, PAIR_POLL_DELAY);
}

function getSavedUrl() {
  return localStorage.getItem(STORAGE_KEY)?.trim()
    || localStorage.getItem(LEGACY_STORAGE_KEY)?.trim()
    || "";
}

function classifyUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !/\.cloudflarestream\.com$/i.test(url.hostname)) return "invalid";
    if (/\/webrtc\/play\/?$/i.test(url.pathname)) return "whep";
    if (/\/iframe\/?$/i.test(url.pathname)) return "iframe";
    return "invalid";
  } catch {
    return "invalid";
  }
}

function waitForIceGathering(pc, timeoutMs = 3000) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(done, timeoutMs);
    function done() {
      clearTimeout(timeout);
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    }
    function check() {
      if (pc.iceGatheringState === "complete") done();
    }
    pc.addEventListener("icegatheringstatechange", check);
  });
}

async function apiRequest(path, options = {}) {
  if (!PAIRING_API) throw new Error("The connection server is not configured.");
  const response = await fetch(`${PAIRING_API}${path}`, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Connection server returned ${response.status}`);
  return data;
}

async function startDesktopShare() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    showToast("Screen sharing is not supported in this browser");
    return;
  }
  await stopDesktopHost(false);
  elements.startDesktopButton.disabled = true;
  elements.startDesktopButton.textContent = "Choose a screen…";
  try {
    const capture = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 30, max: 30 } },
      audio: true
    });
    desktopCapture = capture;
    elements.desktopPreview.srcObject = capture;
    elements.desktopPreviewEmpty.classList.add("hidden");
    elements.desktopLiveBadge.classList.add("visible");
    elements.stopDesktopButton.classList.remove("hidden");
    if (activeMode === "stream-desktop") setStatus("connecting", "Creating code…");

    const session = await apiRequest("/v1/desktop/create", { method: "POST" });
    desktopHostToken = session.hostToken;
    elements.desktopShareDigits.textContent = `${session.code.slice(0, 3)} ${session.code.slice(3)}`;
    elements.desktopShareCode.classList.remove("hidden");
    elements.desktopShareState.textContent = "Waiting for a viewer";

    const pc = new RTCPeerConnection();
    desktopHostPeer = pc;
    capture.getTracks().forEach((track) => {
      const sender = pc.addTrack(track, capture);
      if (track.kind === "video") {
        const parameters = sender.getParameters();
        if (parameters.encodings?.length) {
          parameters.encodings[0].maxBitrate = 5_000_000;
          sender.setParameters(parameters).catch(() => {});
        }
      }
    });
    capture.getVideoTracks()[0]?.addEventListener("ended", () => stopDesktopHost());
    pc.onconnectionstatechange = () => {
      if (pc !== desktopHostPeer) return;
      if (pc.connectionState === "connected") {
        elements.desktopShareState.textContent = "Viewer connected";
        if (activeMode === "stream-desktop") setStatus("live", "Sharing desktop");
      } else if (["failed", "disconnected"].includes(pc.connectionState)) {
        elements.desktopShareState.textContent = "Viewer disconnected";
        if (activeMode === "stream-desktop") setStatus("error", "Connection lost");
      }
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGathering(pc, 5000);
    await apiRequest("/v1/desktop/offer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: desktopHostToken, sdp: JSON.stringify(pc.localDescription) })
    });
    if (activeMode === "stream-desktop") setStatus("waiting", "Waiting for viewer");
    pollDesktopAnswer();
  } catch (error) {
    await stopDesktopHost(false);
    if (error?.name !== "NotAllowedError") showToast(error.message || "Could not start desktop sharing");
    if (activeMode === "stream-desktop") setStatus("error", error?.name === "NotAllowedError" ? "Sharing cancelled" : "Could not share");
  } finally {
    elements.startDesktopButton.disabled = false;
    elements.startDesktopButton.textContent = "Choose screen to share";
  }
}

async function pollDesktopAnswer() {
  clearTimeout(desktopAnswerTimer);
  if (!desktopHostToken || !desktopHostPeer || desktopHostPeer.remoteDescription) return;
  try {
    const data = await apiRequest(`/v1/desktop/status?token=${encodeURIComponent(desktopHostToken)}`);
    if (data.answer) {
      await desktopHostPeer.setRemoteDescription(JSON.parse(data.answer));
      elements.desktopShareState.textContent = "Connecting viewer…";
      return;
    }
  } catch (error) {
    elements.desktopShareState.textContent = error.message || "Session expired";
    return;
  }
  desktopAnswerTimer = setTimeout(pollDesktopAnswer, 1000);
}

async function stopDesktopHost(notifyServer = true) {
  clearTimeout(desktopAnswerTimer);
  desktopAnswerTimer = null;
  const token = desktopHostToken;
  desktopHostToken = "";
  if (desktopHostPeer) desktopHostPeer.close();
  desktopHostPeer = null;
  const capture = desktopCapture;
  desktopCapture = null;
  capture?.getTracks().forEach((track) => track.stop());
  elements.desktopPreview.srcObject = null;
  elements.desktopPreviewEmpty.classList.remove("hidden");
  elements.desktopLiveBadge.classList.remove("visible");
  elements.desktopShareCode.classList.add("hidden");
  elements.stopDesktopButton.classList.add("hidden");
  if (activeMode === "stream-desktop") setStatus("idle", "Ready to share");
  if (notifyServer && token) {
    fetch(`${PAIRING_API}/v1/desktop/release`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
      keepalive: true
    }).catch(() => {});
  }
}

async function joinDesktopShare() {
  const code = elements.desktopJoinCode.value.replace(/\D/g, "");
  if (code.length !== 6) {
    showToast("Enter the six-digit desktop code");
    elements.desktopJoinCode.focus();
    return;
  }
  leaveDesktopShare();
  elements.joinDesktopButton.disabled = true;
  elements.joinDesktopButton.textContent = "Connecting…";
  elements.desktopJoinCopy.textContent = "Finding the shared desktop…";
  if (activeMode === "watch-desktop") setStatus("connecting", "Connecting…");
  try {
    const session = await apiRequest("/v1/desktop/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code })
    });
    desktopViewerToken = session.viewerToken;
    const pc = new RTCPeerConnection();
    desktopViewerPeer = pc;
    const incoming = new MediaStream();
    elements.desktopWatchVideo.srcObject = incoming;
    pc.ontrack = (event) => {
      if (!incoming.getTracks().some((track) => track.id === event.track.id)) incoming.addTrack(event.track);
    };
    pc.onconnectionstatechange = () => {
      if (pc !== desktopViewerPeer) return;
      if (pc.connectionState === "connected") {
        elements.desktopWatchEmpty.classList.add("hidden");
        elements.desktopWatchBadge.classList.add("visible");
        elements.desktopJoinCopy.textContent = "Connected to the shared desktop.";
        elements.leaveDesktopButton.classList.remove("hidden");
        if (activeMode === "watch-desktop") setStatus("live", "Desktop live");
        elements.desktopWatchVideo.play().catch(() => {});
      } else if (["failed", "disconnected"].includes(pc.connectionState)) {
        elements.desktopJoinCopy.textContent = "The desktop connection ended.";
        if (activeMode === "watch-desktop") setStatus("error", "Connection ended");
      }
    };
    await pc.setRemoteDescription(JSON.parse(session.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitForIceGathering(pc, 5000);
    await apiRequest("/v1/desktop/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: desktopViewerToken, sdp: JSON.stringify(pc.localDescription) })
    });
    elements.desktopJoinCopy.textContent = "Connecting directly to the desktop…";
    elements.leaveDesktopButton.classList.remove("hidden");
  } catch (error) {
    leaveDesktopShare(false);
    elements.desktopJoinCopy.textContent = error.message || "Could not connect to that desktop.";
    if (activeMode === "watch-desktop") setStatus("error", "Could not connect");
  } finally {
    elements.joinDesktopButton.disabled = false;
    elements.joinDesktopButton.textContent = "Watch desktop";
  }
}

function leaveDesktopShare(resetCopy = true) {
  desktopViewerToken = "";
  if (desktopViewerPeer) desktopViewerPeer.close();
  desktopViewerPeer = null;
  if (elements.desktopWatchVideo.srcObject) {
    elements.desktopWatchVideo.srcObject.getTracks().forEach((track) => track.stop());
    elements.desktopWatchVideo.srcObject = null;
  }
  elements.desktopWatchEmpty.classList.remove("hidden");
  elements.desktopWatchBadge.classList.remove("visible");
  elements.leaveDesktopButton.classList.add("hidden");
  if (resetCopy) elements.desktopJoinCopy.textContent = "Type the six-digit code displayed on the sharing computer.";
  if (activeMode === "watch-desktop") setStatus("idle", "Enter a code");
}

async function closeSession(sendDelete = true) {
  clearTimeout(retryTimer);
  retryTimer = null;
  const oldSessionUrl = sessionUrl;
  sessionUrl = "";

  if (peer) {
    peer.ontrack = null;
    peer.onconnectionstatechange = null;
    peer.oniceconnectionstatechange = null;
    peer.close();
    peer = null;
  }
  if (elements.video.srcObject) {
    elements.video.srcObject.getTracks().forEach((track) => track.stop());
    elements.video.srcObject = null;
  }
  elements.frame.src = "about:blank";
  elements.frame.classList.add("hidden");
  elements.video.classList.remove("hidden");

  if (sendDelete && oldSessionUrl) {
    try {
      await fetch(oldSessionUrl, { method: "DELETE", keepalive: true });
    } catch {
      // Closing the local peer is sufficient if session deletion cannot complete.
    }
  }
}

function scheduleRetry(message = "Waiting for the iPhone broadcast…") {
  if (stoppedByUser || classifyUrl(getSavedUrl()) !== "whep") return;
  clearTimeout(retryTimer);
  setStatus("waiting", "Waiting for iPhone");
  elements.streamMessage.textContent = message;
  setEmpty("Waiting for your iPhone", "Start the WebRTC broadcast. This page will reconnect automatically.", "Try now");
  retryTimer = setTimeout(() => connectPlayback(true), RETRY_DELAY);
}

function loadIframe(url) {
  playbackMode = "iframe";
  elements.video.classList.add("hidden");
  elements.frame.classList.remove("hidden");
  elements.frame.src = url;
  elements.emptyState.classList.add("hidden");
  elements.liveBadge.classList.remove("visible");
  elements.reconnectButton.disabled = false;
  setStatus("live", "Player ready");
  elements.streamMessage.textContent = "Cloudflare player loaded — start PRISM on the iPhone";
}

async function connectPlayback(isRetry = false) {
  const playbackUrl = getSavedUrl();
  const mode = classifyUrl(playbackUrl);
  if (!playbackUrl || mode === "invalid") {
    setStatus("idle", "Not configured");
    elements.streamMessage.textContent = "Waiting for setup";
    elements.reconnectButton.disabled = true;
    setEmpty("Connect your stream", "Add your Cloudflare playback URL to begin.", "Set up stream");
    return;
  }

  stoppedByUser = false;
  clearTimeout(retryTimer);
  await closeSession();
  if (mode === "iframe") {
    loadIframe(playbackUrl);
    return;
  }

  playbackMode = "whep";
  const attempt = ++connectionAttempt;
  setStatus("connecting", isRetry ? "Checking stream…" : "Connecting…");
  elements.streamMessage.textContent = "Negotiating low-latency playback";
  elements.reconnectButton.disabled = true;
  setEmpty("Connecting…", "Looking for the live iPhone broadcast.", "Try again");

  try {
    const pc = new RTCPeerConnection();
    peer = pc;
    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });
    const incomingStream = new MediaStream();
    elements.video.srcObject = incomingStream;
    pc.ontrack = (event) => {
      if (!incomingStream.getTracks().some((track) => track.id === event.track.id)) incomingStream.addTrack(event.track);
    };
    pc.onconnectionstatechange = () => {
      if (pc !== peer) return;
      if (pc.connectionState === "connected") {
        setStatus("live", "Live");
        elements.streamMessage.textContent = "WebRTC stream connected";
        elements.emptyState.classList.add("hidden");
        elements.liveBadge.classList.add("visible");
        elements.reconnectButton.disabled = false;
        elements.forgetButton.classList.remove("hidden");
        elements.video.play().catch(() => {
          elements.video.muted = true;
          updateMuteButton();
          elements.video.play().catch(() => {});
        });
      } else if (["failed", "disconnected"].includes(pc.connectionState)) {
        scheduleRetry("Connection interrupted — retrying automatically");
      }
    };
    pc.oniceconnectionstatechange = () => {
      if (pc === peer && pc.iceConnectionState === "failed") scheduleRetry("Network connection failed — retrying automatically");
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGathering(pc);
    if (attempt !== connectionAttempt) return;
    const response = await fetch(playbackUrl, {
      method: "POST",
      headers: { "Content-Type": "application/sdp" },
      body: pc.localDescription.sdp
    });
    if (!response.ok) throw new Error(`WHEP returned ${response.status}`);
    const answer = await response.text();
    const location = response.headers.get("Location");
    sessionUrl = location ? new URL(location, playbackUrl).toString() : "";
    await pc.setRemoteDescription({ type: "answer", sdp: answer });
    elements.reconnectButton.disabled = false;
  } catch (error) {
    if (attempt !== connectionAttempt) return;
    console.warn("Playback connection failed:", error);
    scheduleRetry("No live stream detected — checking every 5 seconds");
  }
}

function updateMuteButton() {
  const muted = elements.video.muted;
  elements.muteButton.setAttribute("aria-pressed", String(muted));
  elements.muteButton.setAttribute("aria-label", muted ? "Unmute stream" : "Mute stream");
}

async function saveAndConnect() {
  const value = elements.playbackUrl.value.trim();
  if (classifyUrl(value) === "invalid") {
    showToast("Paste a Cloudflare /iframe or /webRTC/play URL");
    elements.playbackUrl.focus();
    return;
  }
  localStorage.setItem(STORAGE_KEY, value);
  localStorage.removeItem(LEGACY_STORAGE_KEY);
  elements.forgetButton.classList.remove("hidden");
  showToast("Stream saved");
  await connectPlayback();
}

elements.saveButton.addEventListener("click", saveAndConnect);
elements.modeTabs.forEach((tab) => tab.addEventListener("click", () => setMode(tab.dataset.mode)));
document.querySelectorAll("[data-mode-link]").forEach((link) => link.addEventListener("click", (event) => {
  event.preventDefault();
  setMode(link.dataset.modeLink);
}));
window.addEventListener("hashchange", () => setMode(location.hash.slice(1), false));
elements.startDesktopButton.addEventListener("click", startDesktopShare);
elements.stopDesktopButton.addEventListener("click", () => stopDesktopHost());
elements.joinDesktopButton.addEventListener("click", joinDesktopShare);
elements.leaveDesktopButton.addEventListener("click", () => leaveDesktopShare());
elements.desktopJoinCode.addEventListener("input", () => {
  const digits = elements.desktopJoinCode.value.replace(/\D/g, "").slice(0, 6);
  elements.desktopJoinCode.value = digits.length > 3 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits;
});
elements.desktopJoinCode.addEventListener("keydown", (event) => {
  if (event.key === "Enter") joinDesktopShare();
});
elements.desktopMuteButton.addEventListener("click", () => {
  elements.desktopWatchVideo.muted = !elements.desktopWatchVideo.muted;
  elements.desktopMuteButton.setAttribute("aria-pressed", String(elements.desktopWatchVideo.muted));
  elements.desktopMuteButton.setAttribute("aria-label", elements.desktopWatchVideo.muted ? "Unmute desktop" : "Mute desktop");
  if (!elements.desktopWatchVideo.muted) elements.desktopWatchVideo.play().catch(() => {});
});
elements.desktopFullscreenButton.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await elements.desktopWatchStage.requestFullscreen();
  } catch {
    showToast("Fullscreen is unavailable");
  }
});
elements.pairButton.addEventListener("click", generatePairingCode);
elements.cancelPairButton.addEventListener("click", () => stopPairing());
elements.playbackUrl.addEventListener("keydown", (event) => {
  if (event.key === "Enter") saveAndConnect();
});
elements.pasteButton.addEventListener("click", async () => {
  try {
    elements.playbackUrl.value = await navigator.clipboard.readText();
    showToast("Pasted");
  } catch {
    elements.playbackUrl.focus();
    showToast("Paste the URL manually");
  }
});
elements.reconnectButton.addEventListener("click", () => connectPlayback());
elements.emptyAction.addEventListener("click", () => {
  if (getSavedUrl()) connectPlayback();
  else {
    elements.pairButton.scrollIntoView({ behavior: "smooth", block: "center" });
    if (PAIRING_API) elements.pairButton.focus();
    else elements.playbackUrl.focus();
  }
});
elements.forgetButton.addEventListener("click", async () => {
  stoppedByUser = true;
  connectionAttempt += 1;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(LEGACY_STORAGE_KEY);
  elements.playbackUrl.value = "";
  elements.forgetButton.classList.add("hidden");
  await closeSession();
  playbackMode = "none";
  setStatus("idle", "Not configured");
  elements.streamMessage.textContent = "Waiting for setup";
  elements.reconnectButton.disabled = true;
  setEmpty("Connect your stream", "Add your Cloudflare playback URL to begin.", "Set up stream");
  showToast("Saved stream removed");
});
elements.muteButton.addEventListener("click", () => {
  if (playbackMode === "iframe") {
    showToast("Use the Cloudflare player volume control");
    return;
  }
  elements.video.muted = !elements.video.muted;
  updateMuteButton();
  if (!elements.video.muted) elements.video.play().catch(() => {});
  showToast(elements.video.muted ? "Audio muted" : "Audio on");
});
elements.fitButton.addEventListener("click", () => {
  if (playbackMode === "iframe") {
    showToast("Use the player fullscreen control");
    return;
  }
  const filling = elements.video.classList.toggle("fill");
  elements.fitButton.setAttribute("aria-pressed", String(filling));
  elements.fitButton.setAttribute("aria-label", filling ? "Fit entire screen" : "Fill screen");
  showToast(filling ? "Screen filled" : "Entire screen visible");
});
elements.fullscreenButton.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await elements.stage.requestFullscreen();
  } catch {
    showToast("Fullscreen is unavailable");
  }
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && getSavedUrl() && playbackMode === "whep" && peer?.connectionState !== "connected") connectPlayback(true);
});
window.addEventListener("beforeunload", () => {
  stoppedByUser = true;
  stopDesktopHost();
  leaveDesktopShare(false);
  closeSession();
});

const savedUrl = getSavedUrl();
if (savedUrl) {
  elements.playbackUrl.value = savedUrl;
  elements.forgetButton.classList.remove("hidden");
}
setMode(location.hash.slice(1) || "watch-iphone", false);
connectPlayback();
