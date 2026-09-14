"use strict";

const STORAGE_KEY = "iphone-screen-whep-url";
const RETRY_DELAY = 5000;

const elements = {
  status: document.querySelector("#status"),
  statusText: document.querySelector("#statusText"),
  video: document.querySelector("#screenVideo"),
  stage: document.querySelector("#stage"),
  phone: document.querySelector("#phone"),
  emptyState: document.querySelector("#emptyState"),
  emptyTitle: document.querySelector("#emptyTitle"),
  emptyMessage: document.querySelector("#emptyMessage"),
  emptyAction: document.querySelector("#emptyAction"),
  streamMessage: document.querySelector("#streamMessage"),
  whepUrl: document.querySelector("#whepUrl"),
  saveButton: document.querySelector("#saveButton"),
  forgetButton: document.querySelector("#forgetButton"),
  pasteButton: document.querySelector("#pasteButton"),
  reconnectButton: document.querySelector("#reconnectButton"),
  muteButton: document.querySelector("#muteButton"),
  fitButton: document.querySelector("#fitButton"),
  fullscreenButton: document.querySelector("#fullscreenButton"),
  liveBadge: document.querySelector("#liveBadge"),
  toast: document.querySelector("#toast")
};

let peer = null;
let sessionUrl = "";
let retryTimer = null;
let stoppedByUser = false;
let connectionAttempt = 0;
let toastTimer = null;

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

function getSavedUrl() {
  return localStorage.getItem(STORAGE_KEY)?.trim() || "";
}

function isValidWhepUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && /\/webrtc\/play\/?$/i.test(url.pathname);
  } catch {
    return false;
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

  if (sendDelete && oldSessionUrl) {
    try {
      await fetch(oldSessionUrl, { method: "DELETE", keepalive: true });
    } catch {
      // Closing the local peer is sufficient if session deletion cannot complete.
    }
  }
}

function scheduleRetry(message = "Waiting for the iPhone broadcast…") {
  if (stoppedByUser || !getSavedUrl()) return;
  clearTimeout(retryTimer);
  setStatus("waiting", "Waiting for iPhone");
  elements.streamMessage.textContent = message;
  setEmpty("Waiting for your iPhone", "Start the broadcast in Larix Screencaster. This page will reconnect automatically.", "Try now");
  retryTimer = setTimeout(() => connectPlayback(true), RETRY_DELAY);
}

async function connectPlayback(isRetry = false) {
  const whepUrl = getSavedUrl();

  if (!whepUrl) {
    setStatus("idle", "Not configured");
    elements.streamMessage.textContent = "Waiting for setup";
    elements.reconnectButton.disabled = true;
    setEmpty("Connect your stream", "Add your WHEP playback URL to begin.", "Set up stream");
    return;
  }

  stoppedByUser = false;
  clearTimeout(retryTimer);
  await closeSession();

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
      if (!incomingStream.getTracks().some((track) => track.id === event.track.id)) {
        incomingStream.addTrack(event.track);
      }
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
      if (pc === peer && pc.iceConnectionState === "failed") {
        scheduleRetry("Network connection failed — retrying automatically");
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGathering(pc);

    if (attempt !== connectionAttempt) return;

    const response = await fetch(whepUrl, {
      method: "POST",
      headers: { "Content-Type": "application/sdp" },
      body: pc.localDescription.sdp
    });

    if (!response.ok) {
      throw new Error(`WHEP returned ${response.status}`);
    }

    const answer = await response.text();
    const location = response.headers.get("Location");
    sessionUrl = location ? new URL(location, whepUrl).toString() : "";
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
  const value = elements.whepUrl.value.trim();

  if (!isValidWhepUrl(value)) {
    showToast("Paste a valid Cloudflare WHEP playback URL");
    elements.whepUrl.focus();
    return;
  }

  localStorage.setItem(STORAGE_KEY, value);
  elements.forgetButton.classList.remove("hidden");
  showToast("Stream saved");
  await connectPlayback();
}

elements.saveButton.addEventListener("click", saveAndConnect);
elements.whepUrl.addEventListener("keydown", (event) => {
  if (event.key === "Enter") saveAndConnect();
});

elements.pasteButton.addEventListener("click", async () => {
  try {
    elements.whepUrl.value = await navigator.clipboard.readText();
    showToast("Pasted");
  } catch {
    elements.whepUrl.focus();
    showToast("Paste the URL manually");
  }
});

elements.reconnectButton.addEventListener("click", () => connectPlayback());
elements.emptyAction.addEventListener("click", () => {
  if (getSavedUrl()) {
    connectPlayback();
  } else {
    elements.whepUrl.scrollIntoView({ behavior: "smooth", block: "center" });
    elements.whepUrl.focus();
  }
});

elements.forgetButton.addEventListener("click", async () => {
  stoppedByUser = true;
  connectionAttempt += 1;
  localStorage.removeItem(STORAGE_KEY);
  elements.whepUrl.value = "";
  elements.forgetButton.classList.add("hidden");
  await closeSession();
  setStatus("idle", "Not configured");
  elements.streamMessage.textContent = "Waiting for setup";
  elements.reconnectButton.disabled = true;
  setEmpty("Connect your stream", "Add your WHEP playback URL to begin.", "Set up stream");
  showToast("Saved stream removed");
});

elements.muteButton.addEventListener("click", () => {
  elements.video.muted = !elements.video.muted;
  updateMuteButton();
  if (!elements.video.muted) elements.video.play().catch(() => {});
  showToast(elements.video.muted ? "Audio muted" : "Audio on");
});

elements.fitButton.addEventListener("click", () => {
  const filling = elements.video.classList.toggle("fill");
  elements.fitButton.setAttribute("aria-pressed", String(filling));
  elements.fitButton.setAttribute("aria-label", filling ? "Fit entire screen" : "Fill screen");
  showToast(filling ? "Screen filled" : "Entire screen visible");
});

elements.fullscreenButton.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await elements.stage.requestFullscreen();
    }
  } catch {
    showToast("Fullscreen is unavailable");
  }
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && getSavedUrl() && peer?.connectionState !== "connected") {
    connectPlayback(true);
  }
});

window.addEventListener("beforeunload", () => {
  stoppedByUser = true;
  closeSession();
});

const savedUrl = getSavedUrl();
if (savedUrl) {
  elements.whepUrl.value = savedUrl;
  elements.forgetButton.classList.remove("hidden");
  connectPlayback();
} else {
  connectPlayback();
}
