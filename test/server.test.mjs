// Starts the real server and connects to it like three people in two meetings.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const PORT = 3297;
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startServer() {
  const child = spawn(process.execPath, ["server.js"], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) } });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  for (let i = 0; i < 50 && !output.includes("running at"); i++) await wait(100);
  return child;
}

// A client that remembers every message it receives.
async function join(room) {
  const ws = new WebSocket("ws://localhost:" + PORT + "/ws?room=" + encodeURIComponent(room));
  const messages = [];
  ws.on("message", (data) => messages.push(JSON.parse(data)));
  await new Promise((resolve, reject) => { ws.on("open", resolve); ws.on("error", reject); });
  await wait(100);
  return {
    messages,
    lines: () => messages.filter((m) => m.type === "line").map((m) => m.line),
    say: async (line) => { ws.send(JSON.stringify({ type: "line", line })); await wait(150); },
    close: () => ws.close(),
  };
}

test("captions reach everyone in the same meeting, and only them", async (t) => {
  const server = await startServer();
  t.after(() => server.kill());

  const alex = await join("meeting-1");
  const sam = await join("meeting-1");
  const other = await join("meeting-2");

  await alex.say({ id: "alex-1", speaker: "Alex", text: "Morning ev", final: false, ageMs: 800 });
  await alex.say({ id: "alex-1", speaker: "Alex", text: "Morning everyone.", final: true, ageMs: 1500 });
  await sam.say({ id: "sam-1", speaker: "Sam", text: "Hi Alex.", final: true, ageMs: 600 });

  assert.deepEqual(sam.lines().map((l) => l.speaker + ": " + l.text + (l.final ? "" : " …")),
    ["Alex: Morning ev …", "Alex: Morning everyone.", "Sam: Hi Alex."]);
  assert.equal(sam.lines()[0].at, sam.lines()[1].at, "live and final share the start time");
  assert.deepEqual(other.lines(), [], "another meeting hears nothing");

  // Someone joining late gets the finished lines so far, by WebSocket and by plain HTTP.
  const late = await join("meeting-1");
  const history = late.messages.find((m) => m.type === "history").lines;
  assert.deepEqual(history.map((l) => l.speaker + ": " + l.text), ["Alex: Morning everyone.", "Sam: Hi Alex."]);
  const response = await fetch("http://localhost:" + PORT + "/api/transcript?room=meeting-1");
  assert.equal((await response.json()).lines.length, 2);

  // Rubbish is ignored rather than crashing the server.
  await alex.say({ id: "", speaker: "", text: "no id" });
  const page = await fetch("http://localhost:" + PORT + "/");
  assert.equal(page.status, 200, "still serving the app");

  for (const client of [alex, sam, other, late]) client.close();
});
