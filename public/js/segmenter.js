// Voice activity detection: splits microphone audio into spoken phrases.
// Feed it small blocks of 16 kHz audio; it reports when a phrase starts, sends the phrase
// so far every so often (for live captions), and hands over the whole phrase when you pause.
// Pure logic, so it's unit-tested with made-up audio.
import { CONFIG } from "./config.js";
import { concat, rms } from "./audio-utils.js";

export class Segmenter {
  constructor(options = CONFIG.speech) {
    this.o = options;
    this.noise = options.minLevel;  // background loudness, learned from quiet moments
    this.state = "idle";
    this.preroll = [];              // recent quiet blocks, so a phrase doesn't start mid-word
    this.voicedMs = 0;              // speech so far, in a row (idle) or in total (speaking)
    this.nextId = 1;
  }

  durationMs(blocks) {
    return (blocks.reduce((n, b) => n + b.length, 0) / this.o.sampleRate) * 1000;
  }

  // Returns a list of events: { type: "start" | "interim" | "final" | "discard", id, at, ... }.
  push(block, now) {
    const o = this.o;
    const blockMs = (block.length / o.sampleRate) * 1000;
    const level = rms(block);
    const voiced = level >= Math.max(o.minLevel, this.noise * o.noiseMultiplier);
    // Learn the background level from quiet blocks only, slowly.
    if (!voiced) this.noise = Math.max(o.minLevel / 4, this.noise * 0.95 + level * 0.05);

    if (this.state === "idle") {
      this.preroll.push(block);
      while (this.preroll.length > 1 && this.durationMs(this.preroll) > o.prerollMs + o.startMs) this.preroll.shift();
      this.voicedMs = voiced ? this.voicedMs + blockMs : 0;
      if (this.voicedMs < o.startMs) return [];
      this.state = "speaking";
      this.blocks = this.preroll;
      this.preroll = [];
      this.id = this.nextId++;
      this.startAt = now - this.durationMs(this.blocks);
      this.silentMs = 0;
      this.lastInterimAt = now;
      return [{ type: "start", id: this.id, at: this.startAt }];
    }

    this.blocks.push(block);
    if (voiced) this.voicedMs += blockMs;
    this.silentMs = voiced ? 0 : this.silentMs + blockMs;

    const length = this.durationMs(this.blocks);
    if (this.silentMs >= o.hangoverMs || length >= o.maxPhraseMs) {
      const event = this.finish(now);
      // Cut short because it was long? Keep listening: the next voiced block starts a new phrase.
      this.voicedMs = voiced ? o.startMs : 0;
      return [event];
    }
    if (now - this.lastInterimAt >= o.interimEveryMs) {
      this.lastInterimAt = now;
      return [{ type: "interim", id: this.id, at: this.startAt, audio: concat(this.blocks) }];
    }
    return [];
  }

  // End the current phrase (when you pause, or when captions are switched off).
  finish(now) {
    const o = this.o;
    const id = this.id;
    // Drop most of the trailing silence; keep a little so the last word isn't clipped.
    const keepSilentMs = 200;
    let trimMs = Math.max(0, this.silentMs - keepSilentMs);
    const blocks = [...this.blocks];
    while (blocks.length > 1 && trimMs > 0) {
      trimMs -= (blocks[blocks.length - 1].length / o.sampleRate) * 1000;
      blocks.pop();
    }
    const spokenMs = this.voicedMs;
    this.state = "idle";
    this.blocks = [];
    this.preroll = [];
    this.voicedMs = 0;
    if (spokenMs < o.minSpeechMs) return { type: "discard", id, at: this.startAt };
    return { type: "final", id, at: this.startAt, end: now, audio: concat(blocks) };
  }

  flush(now) {
    return this.state === "speaking" ? [this.finish(now)] : [];
  }
}
