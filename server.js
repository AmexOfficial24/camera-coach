// Serves the files in public/. There's no backend: all camera analysis happens in
// the browser, so video never leaves the user's computer.
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");

const PORT = Number(process.env.PORT) || 3001;
const PUBLIC_DIR = path.join(__dirname, "public");
const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

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

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  } catch (error) {
    notFound(response);
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

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Camera Coach running at http://localhost:${PORT}`);
});
