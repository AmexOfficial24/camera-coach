// The page's side of the speech worker: load the model once, then turn phrases into text.
import { CONFIG } from "./config.js";

export class SpeechEngine {
  constructor() {
    this.worker = new Worker(new URL("./speech-worker.js", import.meta.url), { type: "module" });
    this.pending = new Map();
    this.nextId = 1;
    this.info = null;           // { model, device, seconds } once loaded
    this.onProgress = null;     // (loaded, total) while downloading
    this.worker.onmessage = (event) => this.handle(event.data);
    // The worker itself failed (e.g. the speech library couldn't be downloaded).
    this.worker.onerror = (event) => {
      event.preventDefault();
      for (const { reject } of this.pending.values()) reject(new Error(event.message || "Speech worker failed to start"));
      this.pending.clear();
    };
  }

  handle(message) {
    if (message.type === "progress") {
      if (this.onProgress) this.onProgress(message.loaded, message.total);
      return;
    }
    const waiting = this.pending.get(message.id);
    if (!waiting) return;
    this.pending.delete(message.id);
    if (message.type === "error") waiting.reject(new Error(message.message));
    else waiting.resolve(message);
  }

  request(message, transfer = []) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...message, id }, transfer);
    });
  }

  async load({ preferGpu = CONFIG.speech.useGraphicsCard || new URLSearchParams(location.search).has("gpu") } = {}) {
    const ready = await this.request({ type: "load", preferGpu });
    if (!ready.reused) this.info = { model: ready.model, device: ready.device, seconds: ready.seconds };
    return this.info;
  }

  // Resolves { text, ms }. The audio buffer is handed to the worker, so don't reuse it.
  transcribe(audio) {
    return this.request({ type: "transcribe", audio }, [audio.buffer]);
  }

  get busy() {
    return this.pending.size > 0;
  }
}

// One engine for the whole page, so the model is only downloaded and loaded once.
let shared = null;
export function speechEngine() {
  if (!shared) shared = new SpeechEngine();
  return shared;
}
