"use strict";

const STORAGE_KEY = "iphone-screen-playback-url";
const LEGACY_STORAGE_KEY = "iphone-screen-whep-url";
const RETRY_DELAY = 5000;
const PAIRING_API = String(window.IPHONE_REMOTE_API || "").replace(/\/$/, "");
const RTC_CONFIGURATION = {
  iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
  iceCandidatePoolSize: 4
};
const DESKTOP_CONNECT_TIMEOUT = 15000;

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
  iphoneJoinCode: document.querySelector("#iphoneJoinCode"),
  iphoneJoinCopy: document.querySelector("#iphoneJoinCopy"),
  joinIphoneButton: document.querySelector("#joinIphoneButton"),
  leaveIphoneButton: document.querySelector("#leaveIphoneButton"),
  iphoneHostPanel: document.querySelector("#iphoneHostPanel"),
  createIphoneButton: document.querySelector("#createIphoneButton"),
  iphoneHostResult: document.querySelector("#iphoneHostResult"),
  iphoneShareDigits: document.querySelector("#iphoneShareDigits"),
  copyStreamChampServerButton: document.querySelector("#copyStreamChampServerButton"),
  copyStreamChampKeyButton: document.querySelector("#copyStreamChampKeyButton"),
  copyIphoneAccessButton: document.querySelector("#copyIphoneAccessButton"),
  endIphoneSessionButton: document.querySelector("#endIphoneSessionButton"),
  modeTabs: [...document.querySelectorAll("[data-mode]")],
  modePages: [...document.querySelectorAll("[data-page]")],
  desktopPreview: document.querySelector("#desktopPreview"),
  desktopPreviewEmpty: document.querySelector("#desktopPreviewEmpty"),
  desktopLiveBadge: document.querySelector("#desktopLiveBadge"),
  desktopShareCode: document.querySelector("#desktopShareCode"),
  desktopShareDigits: document.querySelector("#desktopShareDigits"),
  desktopShareState: document.querySelector("#desktopShareState"),
  copyDesktopAccess: document.querySelector("#copyDesktopAccess"),
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
let activeMode = "watch-iphone";
let desktopHostPeer = null;
let desktopViewerPeer = null;
let desktopCapture = null;
let desktopHostToken = "";
let desktopViewerToken = "";
let desktopConnectTimer = null;
let desktopSessionCode = "";
let desktopPublishSessionUrl = "";
let iphonePublisherToken = "";
let iphonePublishUrl = "";
let iphoneRtmpsUrl = "";
let iphoneRtmpsStreamKey = "";
let iphoneSessionCode = "";
let iphoneViewerToken = "";

async function createIphoneHostSession() {
  const password = "";

  await endIphoneHostSession(false);
  elements.createIphoneButton.disabled = true;
  elements.createIphoneButton.textContent = "Creating…";
  setStatus("connecting", "Creating private stream…");
  try {
    const session = await apiRequest("/v1/iphone/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password })
    });
    if (!/^\d{6}$/.test(session.code) || !session.publisherToken || !/^rtmps:\/\//.test(session.rtmpsURL || "") || !session.rtmpsStreamKey) {
      throw new Error("The stream server returned invalid session details.");
    }
    iphonePublisherToken = session.publisherToken;
    iphonePublishUrl = session.whipPublishURL;
    iphoneRtmpsUrl = session.rtmpsURL;
    iphoneRtmpsStreamKey = session.rtmpsStreamKey;
    iphoneSessionCode = session.code;
    elements.iphoneShareDigits.textContent = `${session.code.slice(0, 3)} ${session.code.slice(3)}`;
    elements.iphoneHostResult.classList.remove("hidden");
    elements.createIphoneButton.classList.add("hidden");
    setStatus("waiting", "Ready for StreamChamp");
    showToast("Private stream created");
  } catch (error) {
    setStatus("error", "Could not create stream");
    showToast(error.message || "Could not create the stream");
  } finally {
    elements.createIphoneButton.disabled = false;
    elements.createIphoneButton.textContent = "Create private stream";
  }
}

async function endIphoneHostSession(notifyServer = true) {
  const token = iphonePublisherToken;
  iphonePublisherToken = "";
  iphonePublishUrl = "";
  iphoneRtmpsUrl = "";
  iphoneRtmpsStreamKey = "";
  iphoneSessionCode = "";
  elements.iphoneHostResult.classList.add("hidden");
  elements.createIphoneButton.classList.remove("hidden");
  if (notifyServer && token) {
    try {
      await apiRequest("/v1/iphone/release", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token })
      });
    } catch { /* The session expires automatically. */ }
  }
}

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
  else if (mode === "media") setStatus("idle", "Media library");
  else if (mode === "history") setStatus("idle", "History site");
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

async function joinIphoneStream() {
  const code = elements.iphoneJoinCode.value.replace(/\D/g, "");
  const password = "";
  if (code.length !== 6) {
    showToast("Enter the six-digit iPhone code");
    elements.iphoneJoinCode.focus();
    return;
  }

  elements.joinIphoneButton.disabled = true;
  elements.joinIphoneButton.textContent = "Connecting…";
  elements.iphoneJoinCopy.textContent = "Checking the temporary code…";
  setStatus("connecting", "Joining iPhone…");
  try {
    const session = await apiRequest("/v1/iphone/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, password })
    });
    if (!session.viewerToken) throw new Error("The stream server returned invalid access details.");
    iphoneViewerToken = session.viewerToken;
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    elements.playbackUrl.value = "";
    elements.leaveIphoneButton.classList.remove("hidden");
    elements.forgetButton.classList.remove("hidden");
    elements.iphoneJoinCopy.textContent = "Access approved. Start the broadcast on the iPhone if it is not already live.";
    showToast("Private iPhone session joined");
    await connectPlayback();
  } catch (error) {
    elements.iphoneJoinCopy.textContent = error.message || "The code is incorrect or expired.";
    setStatus("error", "Could not join");
  } finally {
    elements.joinIphoneButton.disabled = false;
    elements.joinIphoneButton.textContent = "Watch iPhone";
  }
}

async function leaveIphoneStream() {
  stoppedByUser = true;
  connectionAttempt += 1;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(LEGACY_STORAGE_KEY);
  iphoneViewerToken = "";
  elements.playbackUrl.value = "";
  elements.forgetButton.classList.add("hidden");
  elements.leaveIphoneButton.classList.add("hidden");
  await closeSession();
  playbackMode = "none";
  setStatus("idle", "Enter a code");
  elements.streamMessage.textContent = "Waiting for setup";
  elements.reconnectButton.disabled = true;
  elements.iphoneJoinCopy.textContent = "Create the stream on the iPhone, then enter its temporary code here.";
  setEmpty("Enter your iPhone code", "Use the temporary code created on the iPhone.", "Enter code");
}

async function startDesktopShare() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    showToast("Screen sharing is not supported in this browser");
    return;
  }
  const password = "";
  await stopDesktopHost(true);
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

    const session = await apiRequest("/v1/iphone/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password })
    });
    desktopHostToken = session.publisherToken;
    desktopSessionCode = session.code;
    elements.desktopShareDigits.textContent = `${session.code.slice(0, 3)} ${session.code.slice(3)}`;
    elements.desktopShareCode.classList.remove("hidden");
    elements.copyDesktopAccess.classList.remove("hidden");
    elements.desktopShareState.textContent = "Connecting secure relay…";

    const pc = new RTCPeerConnection(RTC_CONFIGURATION);
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
        clearTimeout(desktopConnectTimer);
        desktopConnectTimer = null;
        elements.desktopShareState.textContent = "Live · waiting for viewers";
        if (activeMode === "stream-desktop") setStatus("live", "Desktop live");
      } else if (["failed", "disconnected"].includes(pc.connectionState)) {
        elements.desktopShareState.textContent = "Relay connection lost";
        if (activeMode === "stream-desktop") setStatus("error", "Connection lost");
      }
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGathering(pc, 5000);
    const publishResponse = await fetch(session.whipPublishURL, {
      method: "POST",
      headers: { "Content-Type": "application/sdp" },
      body: pc.localDescription.sdp
    });
    if (!publishResponse.ok) throw new Error(`Desktop relay returned ${publishResponse.status}`);
    const publishAnswer = await publishResponse.text();
    const publishLocation = publishResponse.headers.get("Location");
    desktopPublishSessionUrl = publishLocation ? new URL(publishLocation, session.whipPublishURL).toString() : "";
    await pc.setRemoteDescription({ type: "answer", sdp: publishAnswer });
    elements.desktopShareState.textContent = "Live · up to five viewers can join";
    if (activeMode === "stream-desktop") setStatus("live", "Desktop live");
  } catch (error) {
    await stopDesktopHost(true);
    if (error?.name !== "NotAllowedError") showToast(error.message || "Could not start desktop sharing");
    if (activeMode === "stream-desktop") setStatus("error", error?.name === "NotAllowedError" ? "Sharing cancelled" : "Could not share");
  } finally {
    elements.startDesktopButton.disabled = false;
    elements.startDesktopButton.textContent = "Choose screen to share";
  }
}

async function stopDesktopHost(notifyServer = true) {
  clearTimeout(desktopConnectTimer);
  desktopConnectTimer = null;
  const token = desktopHostToken;
  const publishSession = desktopPublishSessionUrl;
  desktopHostToken = "";
  desktopPublishSessionUrl = "";
  desktopSessionCode = "";
  if (desktopHostPeer) desktopHostPeer.close();
  desktopHostPeer = null;
  const capture = desktopCapture;
  desktopCapture = null;
  capture?.getTracks().forEach((track) => track.stop());
  elements.desktopPreview.srcObject = null;
  elements.desktopPreviewEmpty.classList.remove("hidden");
  elements.desktopLiveBadge.classList.remove("visible");
  elements.desktopShareCode.classList.add("hidden");
  elements.copyDesktopAccess.classList.add("hidden");
  elements.stopDesktopButton.classList.add("hidden");
  if (activeMode === "stream-desktop") setStatus("idle", "Ready to share");
  if (notifyServer && token) {
    if (publishSession) fetch(publishSession, { method: "DELETE", keepalive: true }).catch(() => {});
    fetch(`${PAIRING_API}/v1/iphone/release`, {
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
  const password = "";
  leaveDesktopShare();
  elements.joinDesktopButton.disabled = true;
  elements.joinDesktopButton.textContent = "Connecting…";
  elements.desktopJoinCopy.textContent = "Finding the shared desktop…";
  if (activeMode === "watch-desktop") setStatus("connecting", "Connecting…");
  try {
    const session = await apiRequest("/v1/iphone/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, password })
    });
    desktopViewerToken = session.viewerToken;
    const pc = new RTCPeerConnection(RTC_CONFIGURATION);
    desktopViewerPeer = pc;
    const incoming = new MediaStream();
    elements.desktopWatchVideo.srcObject = incoming;
    pc.ontrack = (event) => {
      if (!incoming.getTracks().some((track) => track.id === event.track.id)) incoming.addTrack(event.track);
    };
    pc.onconnectionstatechange = () => {
      if (pc !== desktopViewerPeer) return;
      if (pc.connectionState === "connected") {
        clearTimeout(desktopConnectTimer);
        desktopConnectTimer = null;
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
    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGathering(pc, 5000);
    const playback = await apiRequest("/v1/iphone/play", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: desktopViewerToken, sdp: pc.localDescription.sdp })
    });
    if (!playback.answer) throw new Error("The desktop relay returned no video answer.");
    await pc.setRemoteDescription({ type: "answer", sdp: playback.answer });
    elements.desktopJoinCopy.textContent = "Connecting through the secure relay…";
    elements.leaveDesktopButton.classList.remove("hidden");
    clearTimeout(desktopConnectTimer);
    desktopConnectTimer = setTimeout(() => {
      if (pc === desktopViewerPeer && pc.connectionState !== "connected") {
        elements.desktopJoinCopy.textContent = "The secure relay did not connect. Stop sharing and create a new desktop code.";
        if (activeMode === "watch-desktop") setStatus("error", "Relay connection failed");
        pc.close();
      }
    }, DESKTOP_CONNECT_TIMEOUT);
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
  clearTimeout(desktopConnectTimer);
  desktopConnectTimer = null;
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
  if (stoppedByUser || (!iphoneViewerToken && classifyUrl(getSavedUrl()) !== "whep")) return;
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
  const privateSession = Boolean(iphoneViewerToken);
  const mode = privateSession ? "private" : classifyUrl(playbackUrl);
  if ((!privateSession && !playbackUrl) || mode === "invalid") {
    setStatus("idle", "Enter a code");
    elements.streamMessage.textContent = "Waiting for setup";
    elements.reconnectButton.disabled = true;
    setEmpty("Enter your iPhone code", "Use the temporary code created on the iPhone.", "Enter code");
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
    let answer;
    if (privateSession) {
      const result = await apiRequest("/v1/iphone/play", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: iphoneViewerToken, sdp: pc.localDescription.sdp })
      });
      answer = result.answer;
      sessionUrl = "";
    } else {
      const response = await fetch(playbackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/sdp" },
        body: pc.localDescription.sdp
      });
      if (!response.ok) throw new Error(`WHEP returned ${response.status}`);
      answer = await response.text();
      const location = response.headers.get("Location");
      sessionUrl = location ? new URL(location, playbackUrl).toString() : "";
    }
    if (!answer) throw new Error("The private playback server returned no answer.");
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
elements.copyDesktopAccess.addEventListener("click", async () => {
  if (!desktopSessionCode) return;
  try {
    await navigator.clipboard.writeText(`Code: ${desktopSessionCode}`);
    showToast("Code copied");
  } catch {
    showToast("Copy the code manually");
  }
});
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
elements.joinIphoneButton.addEventListener("click", joinIphoneStream);
elements.leaveIphoneButton.addEventListener("click", leaveIphoneStream);
elements.createIphoneButton.addEventListener("click", createIphoneHostSession);
elements.copyStreamChampServerButton.addEventListener("click", async () => {
  if (!iphoneRtmpsUrl) return;
  await navigator.clipboard.writeText(iphoneRtmpsUrl);
  showToast("Server URL copied");
});
elements.copyStreamChampKeyButton.addEventListener("click", async () => {
  if (!iphoneRtmpsStreamKey) return;
  await navigator.clipboard.writeText(iphoneRtmpsStreamKey);
  showToast("Private stream key copied — do not share it");
});
elements.copyIphoneAccessButton.addEventListener("click", async () => {
  if (!iphoneSessionCode) return;
  await navigator.clipboard.writeText(`Remote Screen\nCode: ${iphoneSessionCode}`);
  showToast("Code copied");
});
elements.endIphoneSessionButton.addEventListener("click", async () => {
  await endIphoneHostSession();
  setStatus("idle", "Session ended");
  showToast("Private session ended");
});
elements.iphoneJoinCode.addEventListener("input", () => {
  const digits = elements.iphoneJoinCode.value.replace(/\D/g, "").slice(0, 6);
  elements.iphoneJoinCode.value = digits.length > 3 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits;
});
elements.iphoneJoinCode.addEventListener("keydown", (event) => {
  if (event.key === "Enter") joinIphoneStream();
});
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
    elements.joinIphoneButton.scrollIntoView({ behavior: "smooth", block: "center" });
    elements.iphoneJoinCode.focus();
  }
});
elements.forgetButton.addEventListener("click", async () => {
  await leaveIphoneStream();
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
  if (!document.hidden && (iphoneViewerToken || getSavedUrl()) && playbackMode === "whep" && peer?.connectionState !== "connected") connectPlayback(true);
});
window.addEventListener("beforeunload", () => {
  stoppedByUser = true;
  stopDesktopHost();
  leaveDesktopShare(false);
  closeSession();
});

if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) elements.iphoneHostPanel.open = true;

const savedUrl = getSavedUrl();
if (savedUrl) {
  elements.playbackUrl.value = savedUrl;
  elements.forgetButton.classList.remove("hidden");
  elements.leaveIphoneButton.classList.remove("hidden");
}
setMode(location.hash.slice(1) || "watch-iphone", false);
connectPlayback();
