// Replays simulated seconds of face data through the coach and checks its decisions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Coach } from "../public/js/coach.js";

const FRAME_MS = 66; // about 15 checks a second, like the app
const GOOD_LIGHT = { face: 0.55, background: 0.5 };

// A face that's centred, well sized, level and looking at the camera.
const goodFace = (overrides = {}) => ({
  box: { minX: 0.35, maxX: 0.65, minY: 0.2, maxY: 0.6 },
  centreX: 0.5, centreY: 0.4, size: 0.3, eyeLine: 0.35,
  yaw: 3, pitch: 4, tilt: 2,
  smile: 0.1, browDown: 0.1, gazeSideways: 0.2, gazeDown: 0.1, blink: 0.05,
  ...overrides,
});

// Feed frames from `from` to `to` ms; ask for the tip every 250 ms like the UI does.
// Returns every tip shown, in order, with the time it first appeared.
function play(coach, from, to, face = () => goodFace(), light = () => GOOD_LIGHT) {
  const shown = [];
  let lastKey = null;
  for (let t = from; t < to; t += FRAME_MS) {
    coach.addFrame(t, face(t));
    if (t % 500 < FRAME_MS) coach.addLighting(t, light(t));
    if (t % 250 < FRAME_MS) {
      const tip = coach.currentTip(t);
      const key = tip.kind + ":" + (tip.id || "");
      if (key !== lastKey) shown.push({ t, kind: tip.kind, id: tip.id });
      lastKey = key;
    }
  }
  return shown;
}
const tipIds = (shown) => shown.filter((s) => s.kind === "tip").map((s) => s.id);

test("a well set-up person gets no tips and a high score", () => {
  const coach = new Coach(0);
  const shown = play(coach, 0, 15000);
  assert.deepEqual(tipIds(shown), []);
  assert.ok(coach.scores(15000).overall >= 90, "overall score should be high");
});

test("looking away for a few seconds gives the eye contact tip, then 'That's better'", () => {
  const coach = new Coach(0);
  play(coach, 0, 5000);
  const away = play(coach, 5000, 11000, () => goodFace({ yaw: 40 }));
  const first = away.find((s) => s.id === "lookAway");
  assert.ok(first, "lookAway tip should appear");
  assert.ok(first.t >= 7000, "it shouldn't appear the moment you glance away");

  const back = play(coach, 11000, 16000);
  assert.equal(back.find((s) => s.kind !== "tip").kind, "better");
});

test("a fixed tip isn't repeated straight away", () => {
  const coach = new Coach(0);
  play(coach, 0, 3000);
  play(coach, 3000, 9000, () => goodFace({ yaw: 40 }));
  play(coach, 9000, 12000);
  const again = play(coach, 12000, 20000, () => goodFace({ yaw: 40 }));
  assert.deepEqual(tipIds(again), [], "lookAway is cooling down");
});

test("losing your face is reported quickly, every time", () => {
  const coach = new Coach(0);
  play(coach, 0, 3000);
  const gone = play(coach, 3000, 6000, () => null);
  const first = gone.find((s) => s.id === "noFace");
  assert.ok(first && first.t <= 3000 + 1500 + 300, "noFace within about 1.5 seconds");

  play(coach, 6000, 8000);
  const goneAgain = play(coach, 8000, 11000, () => null);
  assert.ok(tipIds(goneAgain).includes("noFace"), "noFace is never put on cooldown");
});

test("dark faces and bright backgrounds get lighting tips", () => {
  const dark = new Coach(0);
  assert.ok(tipIds(play(dark, 0, 8000, undefined, () => ({ face: 0.12, background: 0.15 }))).includes("tooDark"));
  assert.ok(dark.scores(8000).categories.lighting <= 25, "being in shadow shows as a real dip in the lighting score");

  const backlit = new Coach(0);
  assert.ok(tipIds(play(backlit, 0, 8000, undefined, () => ({ face: 0.4, background: 0.85 }))).includes("backlit"));
});

test("a big smile isn't mistaken for a tense face", () => {
  // Real values measured from a smiling face: the squint raises MediaPipe's brow-down score.
  const smiling = new Coach(0);
  assert.ok(!tipIds(play(smiling, 0, 10000, () => goodFace({ smile: 0.93, browDown: 0.73 }))).includes("tense"));
  assert.equal(smiling.scores(10000).categories.expression, 100);

  const frowning = new Coach(0);
  assert.ok(tipIds(play(frowning, 0, 10000, () => goodFace({ smile: 0.05, browDown: 0.73 }))).includes("tense"));
});

test("moving once to a new spot isn't fidgeting, but constant swaying is", () => {
  const moved = new Coach(0);
  play(moved, 0, 4000);
  const afterMove = play(moved, 4000, 12000, () => goodFace({ centreX: 0.6 }));
  assert.ok(!tipIds(afterMove).includes("fidgeting"));

  const swaying = new Coach(0);
  const shown = play(swaying, 0, 10000, (t) => goodFace({ centreX: 0.5 + 0.06 * Math.sin(t / 150) }));
  assert.ok(tipIds(shown).includes("fidgeting"));
});

test("a much more important problem replaces a minor tip", () => {
  const coach = new Coach(0);
  play(coach, 0, 50000); // long enough without smiling to get the smile reminder
  const shown = play(coach, 50000, 56000, () => null);
  assert.ok(tipIds(shown).includes("noFace"));
  const late = play(coach, 56000, 60000, () => goodFace({ yaw: 40 }));
  assert.ok(tipIds(late).includes("lookAway"));
});

test("sitting too close or too far gets a framing tip", () => {
  const close = new Coach(0);
  assert.ok(tipIds(play(close, 0, 8000, () => goodFace({ size: 0.65 }))).includes("tooClose"));

  const far = new Coach(0);
  assert.ok(tipIds(play(far, 0, 8000, () => goodFace({ size: 0.1 }))).includes("tooFar"));
});

test("a tip that isn't being fixed is rested after 10 seconds instead of nagging", () => {
  const coach = new Coach(0);
  const shown = play(coach, 0, 20000, undefined, () => ({ face: 0.12, background: 0.15 }));
  const start = shown.find((s) => s.id === "tooDark");
  const end = shown.find((s) => s.t > start.t && s.id !== "tooDark");
  assert.ok(end, "something else replaces the tip");
  assert.ok(end.t - start.t <= 10500, "shown for about 10 seconds at most");
  assert.notEqual(coach.currentTip(20000).text, "Looking good. Keep going!", "don't say 'looking good' while it's still dark");
});

test("no smile for 45 seconds brings a gentle reminder; smiling clears it", () => {
  const coach = new Coach(0);
  const quiet = play(coach, 0, 52000);
  assert.ok(tipIds(quiet).includes("smile"));
  const smiling = play(coach, 52000, 56000, () => goodFace({ smile: 0.6 }));
  assert.ok(smiling.some((s) => s.kind === "better"));
});

test("scores are empty before a face is seen, and use only categories with data", () => {
  const coach = new Coach(0);
  assert.equal(coach.scores(0).overall, null);
  coach.addFrame(100, goodFace());
  const { categories } = coach.scores(100);
  assert.equal(categories.lighting, null, "no brightness measured yet");
  assert.equal(categories.eyeContact, 100);
});

test("the camera check lists a problem against the right category", () => {
  const coach = new Coach(0);
  play(coach, 0, 6000, () => goodFace({ size: 0.65 }), () => ({ face: 0.12, background: 0.15 }));
  const result = coach.checklist(6000);
  const byId = Object.fromEntries(result.items.map((i) => [i.id, i]));
  assert.equal(byId.lighting.status, "fix");
  assert.match(byId.lighting.advice, /shadow/);
  assert.equal(byId.framing.status, "fix");
  assert.equal(byId.eyeContact.status, "good");
});

test("the session summary adds up", () => {
  const coach = new Coach(0);
  play(coach, 0, 10000);
  play(coach, 10000, 20000, () => goodFace({ yaw: 40, smile: 0.6 }));
  const categories = { eyeContact: 100, expression: 80, framing: 90, lighting: null, steadiness: 70 };
  coach.recordScore(2000, { overall: 80, categories });
  coach.recordScore(3000, { overall: 60, categories: { ...categories, eyeContact: 50 } });
  coach.recordScore(12000, { overall: 90, categories });
  coach.recordScore(13000, { overall: null, categories }); // no face: not recorded
  const summary = coach.summary(20000);
  assert.equal(summary.durationMs, 20000);
  assert.equal(summary.averageScore, 77);
  assert.equal(summary.categories.eyeContact, 83);
  assert.equal(summary.categories.lighting, null, "never measured");
  assert.deepEqual(summary.timeline, [{ s: 0, score: 70 }, { s: 10, score: 90 }]);
  assert.ok(Math.abs(summary.eyeContactShare - 50) <= 2);
  assert.ok(Math.abs(summary.smilingShare - 50) <= 2);
  assert.equal(summary.inViewShare, 100);
});
