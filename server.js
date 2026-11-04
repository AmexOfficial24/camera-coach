// Serves the files in public/, and shares meeting captions between people using the app.
// Camera and microphone analysis happen in the browser: video and audio never leave the
// user's computer. Only caption text is sent here, and it's kept in memory, not on disk.
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { WebSocketServer, WebSocket } = require("ws");
const { createRooms, roomName } = require("./lib/transcript-rooms.js");

const PORT = Number(process.env.PORT) || 3001;
const PUBLIC_DIR = path.join(__dirname, "public");
const MAX_MESSAGE_BYTES = 16 * 1024;
const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const rooms = createRooms();

function notFound(response) {
  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("Not found");
}

const server = http.createServer(async (request, response) => {
  if (request.method !== "GET") {
    response.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Method not allowed");
    return;
  }

  let url;
  let pathname;
  try {
    url = new URL(request.url, "http://localhost");
    pathname = decodeURIComponent(url.pathname);
  } catch (error) {
    notFound(response);
    return;
  }

  // The transcript so far, for someone joining part-way through a meeting.
  if (pathname === "/api/transcript") {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    response.end(JSON.stringify({ lines: rooms.history(roomName(url.searchParams.get("room"))) }));
    return;
  }

  if (pathname === "/") pathname = "/index.html";

  // Only serve known file types from inside public/.
  const file = path.join(PUBLIC_DIR, path.normalize(pathname));
  const type = CONTENT_TYPES[path.extname(file)];
  if (!file.startsWith(PUBLIC_DIR + path.sep) || !type) {
    notFound(response);
    return;
  }

  try {
    const body = await fs.readFile(file);
    response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
    response.end(body);
  } catch (error) {
    notFound(response);
  }
});

/* ---------- live captions: one room per Webex meeting or space ---------- */

const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url, "http://localhost");
  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }
  sockets.handleUpgrade(request, socket, head, (ws) => {
    ws.room = roomName(url.searchParams.get("room"));
    sockets.emit("connection", ws);
  });
});

function broadcast(room, message) {
  const text = JSON.stringify(message);
  for (const client of sockets.clients) {
    if (client.room === room && client.readyState === WebSocket.OPEN) client.send(text);
  }
}

sockets.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "history", lines: rooms.history(ws.room) }));

  ws.on("message", (data, isBinary) => {
    if (isBinary) return;
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch (error) {
      return;
    }
    if (!message || message.type !== "line") return;
    const line = rooms.addLine(ws.room, message.line, Date.now());
    if (line) broadcast(ws.room, { type: "line", line });
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Camera Coach running at http://localhost:${PORT}`);
});
