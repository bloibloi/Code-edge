"use strict";

const $ = (selector) => document.querySelector(selector);

const elements = {
  status: $("#connectionStatus"),
  statusText: $("#connectionStatusText"),
  video: $("#remoteVideo"),
  emptyState: $("#emptyState"),
  stage: $("#deviceStage"),
  surface: $("#controlSurface"),
  controlButton: $("#controlButton"),
  controlHint: $("#controlHint"),
  controlBadge: $("#controlBadge"),
  muteButton: $("#muteButton"),
  fullscreenButton: $("#fullscreenButton"),
  createOfferButton: $("#createOfferButton"),
  localSdp: $("#localSdp"),
  remoteSdp: $("#remoteSdp"),
  copyOfferButton: $("#copyOfferButton"),
  pasteAnswerButton: $("#pasteAnswerButton"),
  applyAnswerButton: $("#applyAnswerButton"),
  disconnectButton: $("#disconnectButton"),
  stepChip: $("#stepChip"),
  eventLog: $("#eventLog"),
  logEmpty: $("#logEmpty"),
  clearLogButton: $("#clearLogButton"),
  toast: $("#toast")
};

const rtcConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

let peer = null;
let controlChannel = null;
let controlsEnabled = false;
let pointerFrame = null;
let queuedPointerEvent = null;
let toastTimer = null;

function setStatus(state, text) {
  elements.status.dataset.state = state;
  elements.statusText.textContent = text;
}

function addLog(message, kind = "info") {
  document.querySelector("#logEmpty")?.remove();

  const row = document.createElement("div");
  row.className = "log-row";
  row.dataset.kind = kind;

  const time = document.createElement("span");
  time.className = "log-time";
  time.textContent = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  const content = document.createElement("span");
  content.className = "log-message";
  content.textContent = message;

  row.append(time, content);
  elements.eventLog.append(row);

  while (elements.eventLog.childElementCount > 80) {
    elements.eventLog.firstElementChild.remove();
  }
  elements.eventLog.scrollTop = elements.eventLog.scrollHeight;
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  toastTimer = window.setTimeout(() => elements.toast.classList.remove("visible"), 1800);
}

function waitForIceGatheringComplete(connection, timeoutMs = 12000) {
  if (connection.iceGatheringState === "complete") return Promise.resolve();

  return new Promise((resolve) => {
    const timeout = window.setTimeout(done, timeoutMs);

    function done() {
      window.clearTimeout(timeout);
      connection.removeEventListener("icegatheringstatechange", checkState);
      resolve();
    }

    function checkState() {
      if (connection.iceGatheringState === "complete") done();
    }

    connection.addEventListener("icegatheringstatechange", checkState);
  });
}

function wireDataChannel(channel) {
  controlChannel = channel;

  channel.addEventListener("open", () => {
    addLog("Control data channel opened", "success");
    elements.controlButton.disabled = false;
    elements.controlHint.textContent = "Enable control, then click the phone view to use the keyboard.";
    refreshConnectionState();
  });

  channel.addEventListener("close", () => {
    addLog("Control data channel closed");
    disableControls();
    elements.controlButton.disabled = true;
    refreshConnectionState();
  });

  channel.addEventListener("error", () => {
    addLog("Control data channel error", "error");
  });

  channel.addEventListener("message", (event) => {
    let label = "Message received from iPhone bridge";
    try {
      const message = JSON.parse(event.data);
      if (message.type) label = `Received: ${message.type}`;
    } catch {
      // Leave non-JSON bridge messages summarized.
    }
    addLog(label);
  });
}

function createPeer() {
  const connection = new RTCPeerConnection(rtcConfiguration);

  connection.addTransceiver("video", { direction: "recvonly" });
  connection.addTransceiver("audio", { direction: "recvonly" });
  wireDataChannel(connection.createDataChannel("control", {
    ordered: true
  }));

  connection.addEventListener("track", (event) => {
    const [stream] = event.streams;
    if (stream) {
      elements.video.srcObject = stream;
    } else {
      const fallbackStream = elements.video.srcObject || new MediaStream();
      fallbackStream.addTrack(event.track);
      elements.video.srcObject = fallbackStream;
    }
    elements.emptyState.classList.add("hidden");
    addLog(`Remote ${event.track.kind} track received`, "success");
  });

  connection.addEventListener("connectionstatechange", refreshConnectionState);
  connection.addEventListener("iceconnectionstatechange", refreshConnectionState);

  connection.addEventListener("datachannel", (event) => {
    if (event.channel.label === "control" && event.channel !== controlChannel) {
      wireDataChannel(event.channel);
    }
  });

  return connection;
}

function refreshConnectionState() {
  if (!peer) {
    setStatus("idle", "Not connected");
    return;
  }

  const state = peer.connectionState;
  const iceState = peer.iceConnectionState;

  if (state === "connected") {
    setStatus("connected", controlChannel?.readyState === "open" ? "Connected" : "Stream connected");
    elements.disconnectButton.classList.remove("hidden");
    return;
  }

  if (state === "failed" || iceState === "failed") {
    setStatus("failed", "Connection failed");
    addLog("Peer connection failed. Create a new offer and try again.", "error");
    disableControls();
    return;
  }

  if (state === "disconnected") {
    setStatus("failed", "Disconnected");
    disableControls();
    return;
  }

  setStatus("connecting", "Pairing…");
}

async function createOffer() {
  disconnect(false);
  setStatus("connecting", "Creating offer…");
  elements.createOfferButton.disabled = true;
  elements.createOfferButton.textContent = "Creating offer…";
  addLog("Creating WebRTC offer");

  try {
    peer = createPeer();
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    await waitForIceGatheringComplete(peer);

    elements.localSdp.value = JSON.stringify(peer.localDescription);
    elements.copyOfferButton.disabled = false;
    elements.applyAnswerButton.disabled = !elements.remoteSdp.value.trim();
    elements.stepChip.textContent = "Step 2 of 2";
    elements.disconnectButton.classList.remove("hidden");
    setStatus("connecting", "Awaiting answer");
    addLog("Offer ready — send it to the iPhone bridge", "success");
  } catch (error) {
    setStatus("failed", "Offer failed");
    addLog(`Offer error: ${error.message}`, "error");
  } finally {
    elements.createOfferButton.disabled = false;
    elements.createOfferButton.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Create new offer';
  }
}

function parseSessionDescription(raw, expectedType) {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("The remote answer is empty.");

  if (trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed);
    if (!parsed.sdp) throw new Error("The JSON answer does not contain SDP.");
    return { type: parsed.type || expectedType, sdp: parsed.sdp };
  }

  return { type: expectedType, sdp: trimmed };
}

async function applyAnswer() {
  if (!peer?.localDescription) {
    showToast("Create an offer first");
    return;
  }

  elements.applyAnswerButton.disabled = true;
  try {
    const answer = parseSessionDescription(elements.remoteSdp.value, "answer");
    await peer.setRemoteDescription(answer);
    setStatus("connecting", "Connecting…");
    addLog("Remote answer applied", "success");
  } catch (error) {
    setStatus("failed", "Invalid answer");
    addLog(`Answer error: ${error.message}`, "error");
  } finally {
    elements.applyAnswerButton.disabled = false;
  }
}

function disconnect(logEvent = true) {
  disableControls();

  if (pointerFrame) cancelAnimationFrame(pointerFrame);
  pointerFrame = null;
  queuedPointerEvent = null;

  if (controlChannel) {
    controlChannel.onopen = null;
    controlChannel.close();
  }
  controlChannel = null;

  if (peer) peer.close();
  peer = null;

  if (elements.video.srcObject) {
    elements.video.srcObject.getTracks().forEach((track) => track.stop());
    elements.video.srcObject = null;
  }

  elements.emptyState.classList.remove("hidden");
  elements.localSdp.value = "";
  elements.copyOfferButton.disabled = true;
  elements.applyAnswerButton.disabled = !elements.remoteSdp.value.trim();
  elements.disconnectButton.classList.add("hidden");
  elements.stepChip.textContent = "Step 1 of 2";
  elements.controlButton.disabled = true;
  elements.controlHint.textContent = "Pair a device to enable mouse and keyboard controls.";
  setStatus("idle", "Not connected");
  if (logEvent) addLog("Disconnected");
}

function canSendControl() {
  return controlsEnabled && controlChannel?.readyState === "open";
}

function sendControl(type, payload) {
  if (!canSendControl()) return false;

  const message = {
    v: 1,
    type,
    ts: Date.now(),
    payload
  };

  try {
    controlChannel.send(JSON.stringify(message));
    if (type !== "pointermove") {
      const detail = type.startsWith("key") ? ` · ${payload.code}` : "";
      addLog(`Sent: ${type}${detail}`, "input");
    }
    return true;
  } catch (error) {
    addLog(`Send failed: ${error.message}`, "error");
    return false;
  }
}

function pointerPayload(event) {
  const rect = elements.surface.getBoundingClientRect();
  return {
    x: Number(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)).toFixed(5)),
    y: Number(Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)).toFixed(5)),
    buttons: event.buttons,
    button: event.button,
    pointerType: event.pointerType || "mouse",
    pressure: Number(event.pressure || 0)
  };
}

function queuePointerMove(event) {
  if (!canSendControl()) return;
  queuedPointerEvent = pointerPayload(event);
  if (pointerFrame) return;

  pointerFrame = requestAnimationFrame(() => {
    sendControl("pointermove", queuedPointerEvent);
    queuedPointerEvent = null;
    pointerFrame = null;
  });
}

function keyboardPayload(event) {
  return {
    key: event.key.length > 40 ? event.key.slice(0, 40) : event.key,
    code: event.code,
    repeat: event.repeat,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey
  };
}

function enableControls() {
  if (controlChannel?.readyState !== "open") {
    showToast("The control channel is not connected");
    return;
  }
  controlsEnabled = true;
  elements.surface.classList.add("controls-enabled");
  elements.controlButton.querySelector("span").textContent = "Disable control";
  elements.controlHint.textContent = "Controls are live. Press Esc at any time to stop.";
  elements.surface.focus({ preventScroll: true });
  addLog("Input capture enabled", "success");
}

function disableControls() {
  if (!controlsEnabled) return;
  controlsEnabled = false;
  elements.surface.classList.remove("controls-enabled");
  const label = elements.controlButton.querySelector("span");
  if (label) label.textContent = "Enable control";
  elements.controlHint.textContent = controlChannel?.readyState === "open"
    ? "Control paused. Enable it to send input again."
    : "Pair a device to enable mouse and keyboard controls.";
  addLog("Input capture disabled");
}

elements.createOfferButton.addEventListener("click", createOffer);
elements.applyAnswerButton.addEventListener("click", applyAnswer);
elements.disconnectButton.addEventListener("click", () => disconnect(true));

elements.remoteSdp.addEventListener("input", () => {
  elements.applyAnswerButton.disabled = !peer?.localDescription || !elements.remoteSdp.value.trim();
});

elements.copyOfferButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(elements.localSdp.value);
    showToast("Offer copied");
  } catch {
    elements.localSdp.select();
    document.execCommand("copy");
    showToast("Offer copied");
  }
});

elements.pasteAnswerButton.addEventListener("click", async () => {
  try {
    elements.remoteSdp.value = await navigator.clipboard.readText();
    elements.remoteSdp.dispatchEvent(new Event("input"));
    showToast("Answer pasted");
  } catch {
    elements.remoteSdp.focus();
    showToast("Clipboard blocked — paste manually");
  }
});

elements.controlButton.addEventListener("click", () => {
  controlsEnabled ? disableControls() : enableControls();
});

elements.surface.addEventListener("pointermove", queuePointerMove);
elements.surface.addEventListener("pointerdown", (event) => {
  if (!canSendControl()) return;
  elements.surface.setPointerCapture?.(event.pointerId);
  elements.surface.focus({ preventScroll: true });
  event.preventDefault();
  sendControl("pointerdown", pointerPayload(event));
});
elements.surface.addEventListener("pointerup", (event) => {
  if (!canSendControl()) return;
  event.preventDefault();
  sendControl("pointerup", pointerPayload(event));
});
elements.surface.addEventListener("click", (event) => {
  if (!canSendControl()) return;
  event.preventDefault();
  sendControl("click", pointerPayload(event));
});
elements.surface.addEventListener("wheel", (event) => {
  if (!canSendControl()) return;
  event.preventDefault();
  sendControl("wheel", {
    ...pointerPayload(event),
    deltaX: event.deltaX,
    deltaY: event.deltaY,
    deltaMode: event.deltaMode
  });
}, { passive: false });

elements.surface.addEventListener("contextmenu", (event) => {
  if (canSendControl()) event.preventDefault();
});

elements.surface.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    disableControls();
    return;
  }
  if (!canSendControl()) return;
  event.preventDefault();
  sendControl("keydown", keyboardPayload(event));
});
elements.surface.addEventListener("keyup", (event) => {
  if (!canSendControl()) return;
  event.preventDefault();
  sendControl("keyup", keyboardPayload(event));
});

elements.muteButton.addEventListener("click", () => {
  elements.video.muted = !elements.video.muted;
  elements.muteButton.setAttribute("aria-pressed", String(elements.video.muted));
  elements.muteButton.setAttribute("aria-label", elements.video.muted ? "Unmute remote audio" : "Mute remote audio");
  showToast(elements.video.muted ? "Remote audio muted" : "Remote audio on");
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

elements.clearLogButton.addEventListener("click", () => {
  elements.eventLog.replaceChildren();
  const empty = document.createElement("div");
  empty.className = "log-empty";
  empty.id = "logEmpty";
  empty.textContent = "Connection and control events will appear here.";
  elements.eventLog.append(empty);
});

window.addEventListener("beforeunload", () => disconnect(false));
addLog("Interface ready");
