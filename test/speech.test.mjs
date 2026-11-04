// Voice detection and audio helpers, fed with made-up audio.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Segmenter } from "../public/js/segmenter.js";
import { Resampler, concat, rms } from "../public/js/audio-utils.js";

const RATE = 16000;
const BLOCK = 512; // 32 ms

// `ms` of a tone at `amplitude` (0 = silence), as 32 ms blocks.
function sound(ms, amplitude) {
  const blocks = [];
  for (let n = 0; n < Math.round((ms / 1000) * RATE / BLOCK); n++) {
    const block = new Float32Array(BLOCK);
    for (let i = 0; i < BLOCK; i++) block[i] = amplitude * Math.sin(((n * BLOCK + i) / RATE) * 2 * Math.PI * 220);
    blocks.push(block);
  }
  return blocks;
}

// Feed blocks starting at time `from` (ms); returns the events with the time they happened.
function feed(segmenter, blocks, from = 0) {
  const events = [];
  let now = from;
  for (const block of blocks) {
    now += (BLOCK / RATE) * 1000;
    for (const e of segmenter.push(block, now)) events.push({ ...e, now });
  }
  return { events, now };
}

test("silence and a steady background hum never count as speech", () => {
  const s = new Segmenter();
  assert.deepEqual(feed(s, sound(3000, 0)).events, []);
  const hum = new Segmenter();
  assert.deepEqual(feed(hum, sound(5000, 0.012)).events, []);
});

test("a spoken phrase starts quickly and ends after a short pause", () => {
  const s = new Segmenter();
  const quiet = feed(s, sound(500, 0.001));
  const talk = feed(s, sound(1200, 0.1), quiet.now);
  const pause = feed(s, sound(1000, 0.001), talk.now);

  const start = talk.events.find((e) => e.type === "start");
  assert.ok(start && start.now - quiet.now <= 200, "starts within about 0.2 s of speaking");
  const final = pause.events.find((e) => e.type === "final");
  assert.ok(final, "ends after the pause");
  assert.ok(final.now - talk.now >= 700 && final.now - talk.now <= 800, "waits about 0.7 s of silence");
  const seconds = final.audio.length / RATE;
  assert.ok(seconds >= 1.2 && seconds <= 1.8, "keeps the speech plus a little either side, got " + seconds);
});

test("live captions get the phrase so far while you keep talking", () => {
  const s = new Segmenter();
  const talk = feed(s, sound(4000, 0.1), 0);
  const interims = talk.events.filter((e) => e.type === "interim");
  assert.ok(interims.length >= 2);
  assert.ok(interims[1].audio.length > interims[0].audio.length, "each update has more audio");
});

test("a cough or click is ignored", () => {
  const s = new Segmenter();
  const quiet = feed(s, sound(500, 0.001));
  const cough = feed(s, sound(200, 0.2), quiet.now);
  const after = feed(s, sound(1000, 0.001), cough.now);
  assert.deepEqual([...cough.events, ...after.events].map((e) => e.type), ["start", "discard"]);
});

test("very long speech is cut into captions of about 8 seconds", () => {
  const s = new Segmenter();
  const talk = feed(s, sound(12000, 0.1), 0);
  const finals = talk.events.filter((e) => e.type === "final");
  assert.equal(finals.length, 1);
  assert.ok(finals[0].audio.length / RATE <= 8.1);
  assert.equal(talk.events.filter((e) => e.type === "start").length, 2, "a new phrase starts straight away");
});

test("switching captions off mid-phrase still delivers what was said", () => {
  const s = new Segmenter();
  const talk = feed(s, sound(1500, 0.1));
  const [last] = s.flush(talk.now);
  assert.equal(last.type, "final");
  assert.deepEqual(s.flush(talk.now), [], "nothing left afterwards");
});

test("audio helpers: loudness, joining and converting 48 kHz to 16 kHz", () => {
  assert.equal(rms(new Float32Array([0, 0, 0])), 0);
  assert.ok(Math.abs(rms(Float32Array.from([0.5, -0.5])) - 0.5) < 1e-9);
  assert.deepEqual([...concat([Float32Array.from([1, 2]), Float32Array.from([3])])], [1, 2, 3]);

  // A straight ramp stays a straight ramp, even across block boundaries.
  const ramp = Float32Array.from({ length: 4800 }, (_, i) => i / 4800);
  const r = new Resampler(48000, 16000);
  const out = concat([r.push(ramp.subarray(0, 1000)), r.push(ramp.subarray(1000, 3001)), r.push(ramp.subarray(3001))]);
  assert.ok(Math.abs(out.length - 1600) <= 1, "a third as many samples");
  for (let i = 0; i < out.length; i++) assert.ok(Math.abs(out[i] - (i * 3) / 4800) < 1e-6, "sample " + i);
});
