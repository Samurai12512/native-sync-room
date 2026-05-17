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
const roleStat = document.querySelector("#roleStat");
const streamStat = document.querySelector("#streamStat");
const peerStat = document.querySelector("#peerStat");
const qualityStat = document.querySelector("#qualityStat");

const peers = new Map();
let role = null;
let roomId = null;
let localStream = null;

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
    emptyState.classList.add("hidden");
    streamStat.textContent = "Live";
    setStatus("Live", "live");
  };

  peer.onconnectionstatechange = () => {
    qualityStat.textContent = peer.connectionState;
    if (["failed", "disconnected", "closed"].includes(peer.connectionState)) {
      peers.delete(peerId);
      updatePeerStats();
    }
  };

  peers.set(peerId, peer);
  updatePeerStats();
  return peer;
}

async function beginHostShare() {
  if (localStream) return;

  localStream = await navigator.mediaDevices.getDisplayMedia({
    video: {
      frameRate: { ideal: 60, max: 60 },
      width: { ideal: 1920 },
      height: { ideal: 1080 }
    },
    audio: true
  });

  hostPreview.srcObject = localStream;
  emptyState.classList.add("hidden");
  streamStat.textContent = "Live";
  setStatus("Sharing", "live");
  shareScreenButton.disabled = true;

  localStream.getVideoTracks()[0]?.addEventListener("ended", stopHostShare);

  for (const [viewerId, peer] of peers) {
    localStream.getTracks().forEach((track) => peer.addTrack(track, localStream));
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    socket.emit("webrtc-offer", { viewerId, description: peer.localDescription });
  }
}

function stopHostShare() {
  if (!localStream) return;
  localStream.getTracks().forEach((track) => track.stop());
  localStream = null;
  hostPreview.srcObject = null;
  streamStat.textContent = "Offline";
  shareScreenButton.disabled = false;
  setStatus("Stopped", "neutral");
}

async function createOfferForViewer(viewerId) {
  const peer = makePeerConnection(viewerId);
  if (!localStream) return;

  localStream.getTracks().forEach((track) => peer.addTrack(track, localStream));
  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  socket.emit("webrtc-offer", { viewerId, description: peer.localDescription });
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
  peers.get(viewerId)?.close();
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
