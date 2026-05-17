require("dotenv").config();

const crypto = require("crypto");
const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3030;
const app = express();
const server = http.createServer(app);
const io = new Server(server);

const rooms = new Map();

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/config.js", (req, res) => {
  const iceServers = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:global.stun.twilio.com:3478" }
  ];

  if (process.env.TURN_URL) {
    iceServers.push({
      urls: process.env.TURN_URL.split(",").map((url) => url.trim()).filter(Boolean),
      username: process.env.TURN_USERNAME || "",
      credential: process.env.TURN_CREDENTIAL || ""
    });
  }

  res.type("application/javascript");
  res.send(`window.NATIVE_SYNC_CONFIG = ${JSON.stringify({ iceServers })};`);
});

app.get("/room/:roomId", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

function makeRoomId() {
  return crypto.randomBytes(4).toString("hex");
}

function publicRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return null;
  return {
    id: roomId,
    hostId: room.hostId,
    viewers: [...room.viewers],
    createdAt: room.createdAt
  };
}

io.on("connection", (socket) => {
  socket.on("create-room", (callback) => {
    const roomId = makeRoomId();
    rooms.set(roomId, {
      hostId: socket.id,
      viewers: new Set(),
      createdAt: Date.now()
    });
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.role = "host";
    callback?.({ roomId });
  });

  socket.on("join-room", ({ roomId }, callback) => {
    const room = rooms.get(roomId);
    if (!room) {
      callback?.({ ok: false, error: "Room not found." });
      return;
    }

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.role = "viewer";
    room.viewers.add(socket.id);

    callback?.({ ok: true, room: publicRoom(roomId) });
    io.to(room.hostId).emit("viewer-joined", { viewerId: socket.id });
    io.to(roomId).emit("room-updated", publicRoom(roomId));
  });

  socket.on("webrtc-offer", ({ viewerId, description }) => {
    io.to(viewerId).emit("webrtc-offer", {
      hostId: socket.id,
      description
    });
  });

  socket.on("webrtc-answer", ({ hostId, description }) => {
    io.to(hostId).emit("webrtc-answer", {
      viewerId: socket.id,
      description
    });
  });

  socket.on("ice-candidate", ({ targetId, candidate }) => {
    io.to(targetId).emit("ice-candidate", {
      fromId: socket.id,
      candidate
    });
  });

  socket.on("host-state", ({ roomId, state }) => {
    const room = rooms.get(roomId);
    if (!room || room.hostId !== socket.id) return;
    socket.to(roomId).emit("host-state", state);
  });

  socket.on("disconnect", () => {
    const { roomId, role } = socket.data;
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (!room) return;

    if (role === "host" && room.hostId === socket.id) {
      socket.to(roomId).emit("host-left");
      rooms.delete(roomId);
      return;
    }

    if (role === "viewer") {
      room.viewers.delete(socket.id);
      io.to(room.hostId).emit("viewer-left", { viewerId: socket.id });
      io.to(roomId).emit("room-updated", publicRoom(roomId));
    }
  });
});

server.listen(PORT, () => {
  console.log(`Native Sync Room running at http://localhost:${PORT}`);
});
