const socket = io();

const startPanel = document.querySelector("#startPanel");
const roomPanel = document.querySelector("#roomPanel");
const hostButton = document.querySelector("#hostButton");
const joinButton = document.querySelector("#joinButton");
const roomInput = document.querySelector("#roomInput");
const roomLabel = document.querySelector("#roomLabel");
const connectionStatus = document.querySelector("#connectionStatus");
const viewerCount = document.querySelector("#viewerCount");
const viewerVideo = document.querySelector("#viewerVideo");
const hostPreview = document.querySelector("#hostPreview");
const emptyState = document.querySelector("#emptyState");
const shareLink = document.querySelector("#shareLink");
const copyButton = document.querySelector("#copyButton");
const shareScreenButton = document.querySelector("#shareScreenButton");
const stopButton = document.querySelector("#stopButton");
const playButton = document.querySelector("#playButton");
const fullscreenButton = document.querySelector("#fullscreenButton");
const roleStat = document.querySelector("#roleStat");
const streamStat = document.querySelector("#streamStat");
const peerStat = document.querySelector("#peerStat");
const qualityStat = document.querySelector("#qualityStat");
const latencyStat = document.querySelector("#latencyStat");
const bitrateStat = document.querySelector("#bitrateStat");

const peers = new Map();
const peerHealth = new Map();
let role = null;
let roomId = null;
let localStream = null;
let monitorTimer = null;

const bitrateLadder = [
  { label: "Stable", maxBitrate: 2_800_000, maxFramerate: 30, scaleResolutionDownBy: 1.5 },
  { label: "Smooth", maxBitrate: 4_500_000, maxFramerate: 45, scaleResolutionDownBy: 1.25 },
  { label: "HD", maxBitrate: 6_500_000, maxFramerate: 45, scaleResolutionDownBy: 1 },
  { label: "HD+", maxBitrate: 8_500_000, maxFramerate: 45, scaleResolutionDownBy: 1 }
];
const defaultBitrateLevel = 2;
const highQualityAudioBitrate = 320_000;

const rtcConfig = {
  iceServers: window.NATIVE_SYNC_CONFIG?.iceServers || [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:global.stun.twilio.com:3478" }
  ],
  bundlePolicy: "max-bundle",
  rtcpMuxPolicy: "require"
};

function setStatus(text, mode = "neutral") {
  connectionStatus.textContent = text;
  connectionStatus.className = `pill ${mode}`;
}

function setRoomView(nextRole, nextRoomId) {
  role = nextRole;
  roomId = nextRoomId;
  startPanel.classList.add("hidden");
  roomPanel.classList.remove("hidden");
  shareLink.value = `${window.location.origin}/room/${roomId}`;
  roomLabel.textContent = `Room ${roomId}`;
  roleStat.textContent = role === "host" ? "Host" : "Viewer";
  shareScreenButton.hidden = role !== "host";
  stopButton.hidden = role !== "host";
  hostPreview.style.display = role === "host" ? "block" : "none";
  viewerVideo.style.display = role === "viewer" ? "block" : "none";
  updatePeerStats();
}

function updatePeerStats() {
  const count = peers.size;
  peerStat.textContent = String(count);
  viewerCount.textContent = `${count} ${count === 1 ? "viewer" : "viewers"}`;

  const health = [...peerHealth.values()];
  if (!health.length) {
    latencyStat.textContent = "-";
    bitrateStat.textContent = "Auto";
    return;
  }

  const highestRtt = Math.max(...health.map((item) => item.rtt || 0));
  const lowestLevel = Math.min(...health.map((item) => item.level));
  latencyStat.textContent = highestRtt ? `${Math.round(highestRtt * 1000)}ms` : "-";
  bitrateStat.textContent = bitrateLadder[lowestLevel]?.label || "Auto";
}

function parseRoom(value) {
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    return parts.at(-1) || value.trim();
  } catch {
    return value.trim().replace(/^#/, "");
  }
}

async function copyShareLink() {
  await navigator.clipboard.writeText(shareLink.value);
  copyButton.textContent = "Copied";
  setTimeout(() => {
    copyButton.textContent = "Copy";
  }, 1200);
}

function getVideoSender(peer) {
  return peer.getSenders().find((sender) => sender.track?.kind === "video");
}

function getAudioSender(peer) {
  return peer.getSenders().find((sender) => sender.track?.kind === "audio");
}

async function applyBitrate(peer, level) {
  const sender = getVideoSender(peer);
  if (!sender) return;

  const quality = bitrateLadder[level];
  const params = sender.getParameters();
  params.degradationPreference = "balanced";
  params.encodings = params.encodings?.length ? params.encodings : [{}];
  params.encodings[0].maxBitrate = quality.maxBitrate;
  params.encodings[0].maxFramerate = quality.maxFramerate;
  params.encodings[0].scaleResolutionDownBy = quality.scaleResolutionDownBy;
  await sender.setParameters(params);
}

async function applyAudioQuality(peer) {
  const sender = getAudioSender(peer);
  if (!sender) return;

  const params = sender.getParameters();
  params.encodings = params.encodings?.length ? params.encodings : [{}];
  params.encodings[0].maxBitrate = highQualityAudioBitrate;
  await sender.setParameters(params);
}

function preferHighQualityOpus(description) {
  if (!description?.sdp) return description;

  const lines = description.sdp.split("\r\n");
  const opusRtpmap = lines.find((line) => /^a=rtpmap:\d+ opus\/48000\/2$/i.test(line));
  if (!opusRtpmap) return description;

  const opusPayload = opusRtpmap.match(/^a=rtpmap:(\d+)/)?.[1];
  if (!opusPayload) return description;

  const fmtpPrefix = `a=fmtp:${opusPayload}`;
  const opusSettings = [
    "stereo=1",
    "sprop-stereo=1",
    "maxaveragebitrate=510000",
    "useinbandfec=1",
    "usedtx=0",
    "cbr=0"
  ];

  const nextLines = lines.map((line) => {
    if (!line.startsWith(fmtpPrefix)) return line;

    const [prefix, values = ""] = line.split(" ");
    const existing = new Map(
      values
        .split(";")
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => {
          const [key, value = ""] = item.split("=");
          return [key, value];
        })
    );

    opusSettings.forEach((setting) => {
      const [key, value] = setting.split("=");
      existing.set(key, value);
    });

    return `${prefix} ${[...existing].map(([key, value]) => `${key}=${value}`).join(";")}`;
  });

  if (!nextLines.some((line) => line.startsWith(fmtpPrefix))) {
    const rtpmapIndex = nextLines.indexOf(opusRtpmap);
    nextLines.splice(rtpmapIndex + 1, 0, `${fmtpPrefix} ${opusSettings.join(";")}`);
  }

  return {
    type: description.type,
    sdp: nextLines.join("\r\n")
  };
}

async function createHighQualityOffer(peer) {
  const offer = await peer.createOffer();
  return preferHighQualityOpus(offer);
}

async function createHighQualityAnswer(peer) {
  const answer = await peer.createAnswer();
  return preferHighQualityOpus(answer);
}

async function addLocalTracks(peer) {
  if (!localStream) return;

  for (const track of localStream.getTracks()) {
    const sender = peer.getSenders().find((item) => item.track?.kind === track.kind);
    if (!sender) {
      peer.addTrack(track, localStream);
    } else if (sender.track?.readyState === "ended") {
      await sender.replaceTrack(track);
    }
  }

  await applyBitrate(peer, peerHealth.get(peer)?.level ?? defaultBitrateLevel);
  await applyAudioQuality(peer);
}

function startHostMonitoring() {
  if (monitorTimer || role !== "host") return;

  monitorTimer = setInterval(async () => {
    for (const [peerId, peer] of peers) {
      if (peer.connectionState === "closed") continue;

      const health = peerHealth.get(peer) || {
        level: defaultBitrateLevel,
        rtt: 0,
        lastChange: 0,
        badSamples: 0,
        goodSamples: 0,
        lastDroppedFrames: 0,
        lastFreezeCount: 0
      };
      const stats = await peer.getStats();
      let rtt = 0;
      let limitation = "none";
      let framesPerSecond = 0;
      let droppedFrames = 0;
      let freezeCount = 0;

      stats.forEach((report) => {
        if (report.type === "candidate-pair" && report.state === "succeeded" && report.currentRoundTripTime) {
          rtt = report.currentRoundTripTime;
        }
        if (report.type === "outbound-rtp" && report.kind === "video") {
          limitation = report.qualityLimitationReason || "none";
          framesPerSecond = report.framesPerSecond || 0;
          droppedFrames = report.framesDropped || 0;
          freezeCount = report.freezeCount || 0;
        }
      });

      const now = Date.now();
      const canChange = now - health.lastChange > 7000;
      let nextLevel = health.level;
      const droppedDelta = Math.max(0, droppedFrames - (health.lastDroppedFrames || 0));
      const freezeDelta = Math.max(0, freezeCount - (health.lastFreezeCount || 0));
      const isBad = rtt > 0.55 || limitation === "bandwidth" || limitation === "cpu" || droppedDelta > 12 || freezeDelta > 0 || (framesPerSecond > 0 && framesPerSecond < 24);
      const isGood = rtt > 0 && rtt < 0.22 && limitation === "none" && droppedDelta < 3 && freezeDelta === 0 && framesPerSecond >= 30;

      health.badSamples = isBad ? health.badSamples + 1 : 0;
      health.goodSamples = isGood ? health.goodSamples + 1 : 0;
      health.lastDroppedFrames = droppedFrames;
      health.lastFreezeCount = freezeCount;

      if (canChange && health.badSamples >= 2) {
        nextLevel = Math.max(0, health.level - 1);
      } else if (canChange && health.goodSamples >= 4) {
        nextLevel = Math.min(bitrateLadder.length - 1, health.level + 1);
      }

      health.rtt = rtt;
      if (nextLevel !== health.level) {
        health.level = nextLevel;
        health.lastChange = now;
        health.badSamples = 0;
        health.goodSamples = 0;
        await applyBitrate(peer, nextLevel);
      }

      peerHealth.set(peer, health);
    }

    updatePeerStats();
  }, 3000);
}

function stopHostMonitoring() {
  if (!monitorTimer) return;
  clearInterval(monitorTimer);
  monitorTimer = null;
}

function makePeerConnection(peerId) {
  const existingPeer = peers.get(peerId);
  if (existingPeer && existingPeer.connectionState !== "closed") {
    return existingPeer;
  }

  const peer = new RTCPeerConnection(rtcConfig);

  peer.onicecandidate = ({ candidate }) => {
    if (candidate) {
      socket.emit("ice-candidate", { targetId: peerId, candidate });
    }
  };

  peer.ontrack = ({ streams }) => {
    viewerVideo.srcObject = streams[0];
    viewerVideo.preload = "auto";
    viewerVideo.disablePictureInPicture = true;
    viewerVideo.play().catch(() => {
      playButton.classList.remove("hidden");
    });
    emptyState.classList.add("hidden");
    streamStat.textContent = "Live";
    setStatus("Live", "live");
  };

  peer.onconnectionstatechange = () => {
    qualityStat.textContent = peer.connectionState;
    if (["failed", "disconnected", "closed"].includes(peer.connectionState)) {
      peers.delete(peerId);
      peerHealth.delete(peer);
      updatePeerStats();
    }
  };

  peers.set(peerId, peer);
  peerHealth.set(peer, {
    level: defaultBitrateLevel,
    rtt: 0,
    lastChange: 0,
    badSamples: 0,
    goodSamples: 0,
    lastDroppedFrames: 0,
    lastFreezeCount: 0
  });
  updatePeerStats();
  return peer;
}

async function beginHostShare() {
  if (localStream) return;

  const displayOptions = {
    video: {
      frameRate: { ideal: 45, max: 45 },
      width: { ideal: 1920 },
      height: { ideal: 1080 }
    },
    audio: {
      channelCount: { ideal: 2 },
      sampleRate: { ideal: 48000 },
      sampleSize: { ideal: 16 },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      suppressLocalAudioPlayback: false
    }
  };

  try {
    localStream = await navigator.mediaDevices.getDisplayMedia(displayOptions);
  } catch (error) {
    if (error.name !== "OverconstrainedError" && error.name !== "TypeError") throw error;
    localStream = await navigator.mediaDevices.getDisplayMedia({
      ...displayOptions,
      audio: true
    });
  }

  localStream.getVideoTracks().forEach((track) => {
    track.contentHint = "motion";
  });

  hostPreview.srcObject = localStream;
  emptyState.classList.add("hidden");
  streamStat.textContent = "Live";
  setStatus("Sharing", "live");
  shareScreenButton.disabled = true;

  localStream.getVideoTracks()[0]?.addEventListener("ended", stopHostShare);

  for (const [viewerId, peer] of peers) {
    await addLocalTracks(peer);
    const offer = await createHighQualityOffer(peer);
    await peer.setLocalDescription(offer);
    socket.emit("webrtc-offer", { viewerId, description: peer.localDescription });
  }

  startHostMonitoring();
}

function stopHostShare() {
  if (!localStream) return;
  localStream.getTracks().forEach((track) => track.stop());
  localStream = null;
  hostPreview.srcObject = null;
  streamStat.textContent = "Offline";
  shareScreenButton.disabled = false;
  setStatus("Stopped", "neutral");
  stopHostMonitoring();
}

async function createOfferForViewer(viewerId) {
  const peer = makePeerConnection(viewerId);
  if (!localStream) return;

  await addLocalTracks(peer);
  const offer = await createHighQualityOffer(peer);
  await peer.setLocalDescription(offer);
  socket.emit("webrtc-offer", { viewerId, description: peer.localDescription });
  startHostMonitoring();
}

hostButton.addEventListener("click", () => {
  socket.emit("create-room", ({ roomId: createdRoomId }) => {
    setRoomView("host", createdRoomId);
    setStatus("Ready", "neutral");
    history.replaceState(null, "", `/room/${createdRoomId}`);
  });
});

joinButton.addEventListener("click", () => {
  const nextRoomId = parseRoom(roomInput.value);
  if (!nextRoomId) return;

  socket.emit("join-room", { roomId: nextRoomId }, (response) => {
    if (!response.ok) {
      setStatus(response.error, "error");
      return;
    }
    setRoomView("viewer", nextRoomId);
    setStatus("Connected", "live");
    history.replaceState(null, "", `/room/${nextRoomId}`);
  });
});

copyButton.addEventListener("click", copyShareLink);
playButton.addEventListener("click", () => {
  viewerVideo.play().then(() => {
    playButton.classList.add("hidden");
  }).catch(() => {
    setStatus("Tap video to play", "neutral");
  });
});
fullscreenButton.addEventListener("click", async () => {
  const target = document.querySelector(".stage");
  if (document.fullscreenElement) {
    await document.exitFullscreen();
    return;
  }
  await target.requestFullscreen();
});
shareScreenButton.addEventListener("click", () => beginHostShare().catch((error) => {
  console.error(error);
  setStatus("Share blocked", "error");
}));
stopButton.addEventListener("click", stopHostShare);

socket.on("viewer-joined", ({ viewerId }) => {
  if (role !== "host") return;
  createOfferForViewer(viewerId).catch((error) => {
    console.error(error);
    setStatus("Peer error", "error");
  });
});

socket.on("viewer-left", ({ viewerId }) => {
  const peer = peers.get(viewerId);
  if (peer) {
    peerHealth.delete(peer);
    peer.close();
  }
  peers.delete(viewerId);
  updatePeerStats();
});

socket.on("room-updated", (room) => {
  if (!room) return;
  const count = role === "host" ? room.viewers.length : 1;
  viewerCount.textContent = `${count} ${count === 1 ? "viewer" : "viewers"}`;
});

socket.on("webrtc-offer", async ({ hostId, description }) => {
  const peer = makePeerConnection(hostId);
  await peer.setRemoteDescription(description);
  const answer = await createHighQualityAnswer(peer);
  await peer.setLocalDescription(answer);
  socket.emit("webrtc-answer", { hostId, description: peer.localDescription });
});

socket.on("webrtc-answer", async ({ viewerId, description }) => {
  const peer = peers.get(viewerId);
  if (!peer) return;
  await peer.setRemoteDescription(description);
});

socket.on("ice-candidate", async ({ fromId, candidate }) => {
  const peer = peers.get(fromId);
  if (!peer) return;
  await peer.addIceCandidate(candidate);
});

socket.on("host-left", () => {
  setStatus("Host left", "error");
  streamStat.textContent = "Offline";
  emptyState.classList.remove("hidden");
});

const pathRoom = window.location.pathname.match(/\/room\/([^/]+)/)?.[1];
if (pathRoom) {
  roomInput.value = pathRoom;
  joinButton.click();
}
