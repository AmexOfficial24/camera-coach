// The shared transcript: the browser-side model and the server's rooms.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Transcript, cleanText, formatClock, transcriptStart, transcriptToText } from "../public/js/transcript.js";
import rooms from "../lib/transcript-rooms.js";

const { createRooms, roomName } = rooms;

test("lines from different people merge in time order, labelled with who spoke", () => {
  const t = new Transcript();
  t.upsert({ id: "b1", speaker: "Sam", text: "Thanks Alex.", at: 3000, final: true });
  t.upsert({ id: "a1", speaker: "Alex", text: "Morning everyone.", at: 1000, final: true });
  t.upsert({ id: "a2", speaker: "Alex", text: "Let's start", at: 5000, final: false });
  assert.deepEqual(t.lines().map((l) => l.speaker + ": " + l.text), [
    "Alex: Morning everyone.", "Sam: Thanks Alex.", "Alex: Let's start",
  ]);
  assert.equal(t.finalLines().length, 2, "live captions aren't final yet");
});

test("a live caption becomes final, a late live update can't undo it, and an empty final removes it", () => {
  const t = new Transcript();
  t.upsert({ id: "a1", speaker: "Alex", text: "hello ev", at: 1000, final: false });
  t.upsert({ id: "a1", speaker: "Alex", text: "Hello everyone.", at: 1400, final: true });
  t.upsert({ id: "a1", speaker: "Alex", text: "hello every", at: 1200, final: false });
  assert.deepEqual(t.lines(), [{ id: "a1", speaker: "Alex", text: "Hello everyone.", at: 1000, final: true }]);
  t.upsert({ id: "a1", speaker: "Alex", text: "", final: true });
  assert.deepEqual(t.lines(), []);
});

test("back-to-back lines from one person form one turn", () => {
  const t = new Transcript();
  t.upsert({ id: "1", speaker: "Alex", text: "First point.", at: 0, final: true });
  t.upsert({ id: "2", speaker: "Alex", text: "Second point.", at: 4000, final: true });
  t.upsert({ id: "3", speaker: "Sam", text: "Agreed.", at: 9000, final: true });
  t.upsert({ id: "4", speaker: "Alex", text: "Great.", at: 60000, final: true });
  assert.deepEqual(t.turns().map((turn) => turn.speaker + ": " + turn.text), [
    "Alex: First point. Second point.", "Sam: Agreed.", "Alex: Great.",
  ]);
});

test("the text export reads [hh:mm:ss] Name: text", () => {
  assert.equal(formatClock(83000), "00:01:23");
  assert.equal(formatClock(3725000), "01:02:05");
  const text = transcriptToText([
    { speaker: "Alex", text: "Morning.", at: 10000 },
    { speaker: "Sam", text: "Hi Alex.", at: 93000 },
  ], 10000);
  assert.equal(text, "[00:00:00] Alex: Morning.\n[00:01:23] Sam: Hi Alex.");
});

test("joining a meeting late: times count from the first line, not your start", () => {
  const lines = [{ speaker: "Alex", text: "Before you came.", at: 5000 }, { speaker: "Sam", text: "Hi.", at: 65000 }];
  assert.equal(transcriptStart(lines, 60000), 5000);
  assert.equal(transcriptStart(lines, 1000), 1000);
  assert.equal(transcriptStart([], 60000), 60000);
  assert.equal(transcriptToText(lines, 60000), "[00:00:00] Alex: Before you came.\n[00:01:00] Sam: Hi.");
});

test("sound tags and empty output from the speech model are dropped", () => {
  assert.equal(cleanText("  [Music]  "), "");
  assert.equal(cleanText("(inaudible) okay  so "), "okay so");
  assert.equal(cleanText("..."), "");
  assert.equal(cleanText("Hello there."), "Hello there.");
});

test("the server stamps lines with its own clock and keeps the phrase start time", () => {
  const r = createRooms();
  const live = r.addLine("meeting-1", { id: "a1", speaker: "Alex", text: "Morn", ageMs: 1200 }, 10000);
  assert.equal(live.at, 8800, "started 1.2 s before the server heard it");
  const done = r.addLine("meeting-1", { id: "a1", speaker: "Alex", text: "Morning all.", final: true, ageMs: 2500 }, 11000);
  assert.equal(done.at, 8800, "same start time as the live caption");
  assert.deepEqual(r.history("meeting-1"), [done]);
  assert.deepEqual(r.history("meeting-2"), [], "rooms are separate");
});

test("only finished lines are kept, and an empty final line removes one", () => {
  const r = createRooms();
  r.addLine("m", { id: "x", speaker: "Sam", text: "half a sen", final: false }, 1000);
  assert.deepEqual(r.history("m"), []);
  r.addLine("m", { id: "x", speaker: "Sam", text: "Half a sentence.", final: true }, 2000);
  const removal = r.addLine("m", { id: "x", speaker: "Sam", text: "", final: true }, 3000);
  assert.equal(removal.text, "", "the removal is still sent to everyone");
  assert.deepEqual(r.history("m"), []);
});

test("bad lines are rejected and limits are enforced", () => {
  const r = createRooms({ maxLines: 3, maxRooms: 2 });
  assert.equal(r.addLine("m", null, 0), null);
  assert.equal(r.addLine("m", { id: "1", text: "no speaker", final: true }, 0), null);
  assert.equal(r.addLine("m", { id: "1", speaker: "A", text: "", final: false }, 0), null, "empty live caption");
  const long = r.addLine("m", { id: "1", speaker: "A".repeat(200), text: "x".repeat(900), final: true }, 0);
  assert.equal(long.speaker.length, 80);
  assert.equal(long.text.length, 500);
  for (let i = 2; i <= 5; i++) r.addLine("m", { id: String(i), speaker: "A", text: "line " + i, final: true }, i * 1000);
  assert.deepEqual(r.history("m").map((l) => l.id), ["3", "4", "5"], "oldest lines dropped");
  r.addLine("n", { id: "1", speaker: "A", text: "hi", final: true }, 10000);
  r.addLine("o", { id: "1", speaker: "A", text: "hi", final: true }, 11000);
  assert.equal(r.roomCount(), 2, "least recently used room forgotten");
  assert.equal(roomName(""), "local");
  assert.equal(roomName("x".repeat(300)), "local");
  assert.equal(roomName("Y2lzY29zcGFyazovL21lZXRpbmc"), "Y2lzY29zcGFyazovL21lZXRpbmc");
});
