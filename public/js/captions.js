// Live captions: listens to your microphone, turns each phrase you say into text on this
// computer, and shares the text (never the audio) with others in the meeting using the app.
// Everyone transcribes only their own microphone, so every line is labelled with who said it.
import { CONFIG } from "./config.js";
import { rms } from "./audio-utils.js";
import { lipMovement } from "./analysis.js";
import { describeMicError, openMic } from "./mic.js";
import { Segmenter } from "./segmenter.js";
import { speechEngine } from "./speech-engine.js";
import { Transcript, cleanText } from "./transcript.js";
import { TranscriptLink } from "./transcript-link.js";

export class Captions {
  // room: the meeting's id; speaker: your name; lipSamples(): recent { t, mouthOpen } from face tracking
  constructor({ room, speaker, lipSamples }) {
    this.room = room;
    this.speaker = speaker;
    this.lipSamples = lipSamples || (() => []);
    this.transcript = new Transcript();
    this.segmenter = new Segmenter();
    this.session = Math.random().toString(36).slice(2, 8); // keeps line ids unique between sessions
    this.status = "starting";
    this.detail = "Starting…";
    this.level = 0;
    this.ignored = 0;          // phrases dropped because your lips weren't moving
    this.shared = new Set();   // phrase ids we've sent a live caption for
    this.finished = new Set(); // phrase ids that are done (late live captions are ignored)
    this.work = Promise.resolve(); // finished phrases are handled one at a time, in order
    this.stopped = false;
  }

  setStatus(status, detail) {
    this.status = status;
    this.detail = detail;
  }

  async start() {
    this.link = new TranscriptLink(this.room, {
      onLine: (line) => this.transcript.upsert(line),
      onHistory: (lines) => lines.forEach((line) => this.transcript.upsert(line)),
    });

    const engine = speechEngine();
    engine.onProgress = (loaded, total) => {
      if (this.status === "loading") this.setStatus("loading", "Downloading speech model " + Math.round((loaded / total) * 100) + "%");
    };
    this.setStatus("loading", "Loading speech model…");
    try {
      await engine.load();
    } catch (error) {
      this.setStatus("error", "Captions are off: the speech model didn't load.");
      return;
    }
    if (this.stopped) return;

    this.setStatus("loading", "Starting microphone…");
    try {
      this.mic = await openMic((block, now) => this.onBlock(block, now));
    } catch (error) {
      this.setStatus("error", "Captions are off: " + describeMicError(error).title.toLowerCase() + ".");
      return;
    }
    if (this.stopped) {
      this.mic.close();
      return;
    }
    this.setStatus("listening", "Listening");
  }

  onBlock(block, now) {
    this.level = Math.max(rms(block), this.level * 0.85); // the meter falls back smoothly
    for (const event of this.segmenter.push(block, now)) this.onPhrase(event, now);
  }

  // Was that you? If your face is being tracked, a phrase only counts if your lips moved.
  wasYou(from, to) {
    const movement = lipMovement(this.lipSamples(), from, to);
    return movement === null || movement >= CONFIG.speech.lipMovementMin;
  }

  onPhrase(event, now) {
    const id = this.session + "-" + event.id;
    if (event.type === "interim") {
      // A live update. Skip it if the model is busy: the finished version is what matters.
      if (speechEngine().busy || !this.wasYou(event.at, now)) return;
      speechEngine().transcribe(event.audio).then(({ text }) => {
        const clean = cleanText(text);
        if (clean && !this.finished.has(id)) this.share(id, clean, false, event.at);
      }).catch(() => {});
    } else if (event.type === "final" || event.type === "discard") {
      this.work = this.work.then(() => this.finish(id, event)).catch(() => {});
    }
  }

  async finish(id, event) {
    this.finished.add(id);
    if (event.type === "final") {
      if (this.wasYou(event.at, event.end)) {
        const { text } = await speechEngine().transcribe(event.audio);
        const clean = cleanText(text);
        if (clean) return this.share(id, clean, true, event.at);
      } else {
        this.ignored++;
      }
    }
    // Nothing to keep: take down any live caption we showed for this phrase.
    if (this.shared.has(id)) this.share(id, "", true, event.at);
  }

  // Send a line to everyone, including ourselves (the server's echo adds its clock time).
  // Without a server connection, keep it locally so captions still work on their own.
  share(id, text, final, startedAt) {
    if (text) this.shared.add(id);
    const line = { id, speaker: this.speaker, text, final, ageMs: Math.max(0, Math.round(performance.now() - startedAt)) };
    if (!this.link || !this.link.send(line)) this.transcript.upsert({ ...line, at: Date.now() - line.ageMs });
  }

  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    for (const event of this.segmenter.flush(performance.now())) this.onPhrase(event, performance.now());
    if (this.mic) this.mic.close();
    // Give the last phrase a moment to be turned into text and shared.
    await Promise.race([this.work, new Promise((resolve) => setTimeout(resolve, 4000))]);
    await new Promise((resolve) => setTimeout(resolve, 300)); // the server's echo
    if (this.link) this.link.close();
    this.setStatus("off", "Captions off");
  }

  // What the screen needs, a few times a second.
  view() {
    const lines = this.transcript.lines();
    let detail = this.detail;
    if (this.status === "listening" && this.link && !this.link.connected) detail += " (only you will see these: no server connection)";
    if (this.status === "listening" && this.ignored) detail += " · " + this.ignored + " ignored, lips not moving";
    return {
      status: this.status,
      detail,
      level: this.level,
      lines: lines.slice(-CONFIG.speech.captionLines),
      turns: this.transcript.turns(),
      count: this.transcript.finalLines().length,
    };
  }

  // Finished lines, for the report: { speaker, text, at }.
  finalLines() {
    return this.transcript.finalLines().map(({ speaker, text, at }) => ({ speaker, text, at }));
  }
}
