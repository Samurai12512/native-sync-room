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
  { label: "720p", maxBitrate: 1_200_000 },
  { label: "900p", maxBitrate: 2_000_000 },
  { label: "1080p", maxBitrate: 3_200_000 },
  { label: "1080p+", maxBitrate: 5_000_000 }
];

const rtcConfig = {
  iceServers: window.NATIVE_SYNC_CONFIG?.iceServers || [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:global.stun.twilio.com:3478" }
  ]
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

async function applyBitrate(peer, level) {
  const sender = getVideoSender(peer);
  if (!sender) return;

  const params = sender.getParameters();
  params.degradationPreference = "balanced";
  params.encodings = params.encodings?.length ? params.encodings : [{}];
  params.encodings[0].maxBitrate = bitrateLadder[level].maxBitrate;
  params.encodings[0].maxFramerate = 30;
  await sender.setParameters(params);
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

  await applyBitrate(peer, peerHealth.get(peer)?.level || 2);
}

function startHostMonitoring() {
  if (monitorTimer || role !== "host") return;

  monitorTimer = setInterval(async () => {
    for (const [peerId, peer] of peers) {
      if (peer.connectionState === "closed") continue;

      const health = peerHealth.get(peer) || { level: 2, rtt: 0, lastChange: 0 };
      const stats = await peer.getStats();
      let rtt = 0;
      let limitation = "none";

      stats.forEach((report) => {
        if (report.type === "candidate-pair" && report.state === "succeeded" && report.currentRoundTripTime) {
          rtt = report.currentRoundTripTime;
        }
        if (report.type === "outbound-rtp" && report.kind === "video") {
          limitation = report.qualityLimitationReason || "none";
        }
      });

      const now = Date.now();
      const canChange = now - health.lastChange > 6000;
      let nextLevel = health.level;

      if (canChange && (rtt > 0.45 || limitation === "bandwidth" || limitation === "cpu")) {
        nextLevel = Math.max(0, health.level - 1);
      } else if (canChange && rtt > 0 && rtt < 0.18 && limitation === "none") {
        nextLevel = Math.min(bitrateLadder.length - 1, health.level + 1);
      }

      health.rtt = rtt;
      if (nextLevel !== health.level) {
        health.level = nextLevel;
        health.lastChange = now;
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
  peerHealth.set(peer, { level: 2, rtt: 0, lastChange: 0 });
  updatePeerStats();
  return peer;
}

async function beginHostShare() {
  if (localStream) return;

  localStream = await navigator.mediaDevices.getDisplayMedia({
    video: {
      frameRate: { ideal: 30, max: 30 },
      width: { ideal: 1920 },
      height: { ideal: 1080 }
    },
    audio: true
  });

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
    const offer = await peer.createOffer();
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
  const offer = await peer.createOffer();
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
  const answer = await peer.createAnswer();
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
