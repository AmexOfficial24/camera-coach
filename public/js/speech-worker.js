// Runs the speech model in the background, so the page and face tracking stay smooth.
// Audio arrives as 16 kHz samples and never leaves this computer: the model runs right here.
// Versions are pinned so a new release can't break a demo.
import { env, pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";

env.allowLocalModels = false; // models come from the Hugging Face hub (then the browser cache)

// Moonshine is built for live captions; Whisper is the fallback if it won't load.
const MODELS = [
  { id: "onnx-community/moonshine-tiny-ONNX", name: "Moonshine tiny" },
  { id: "onnx-community/whisper-tiny.en", name: "Whisper tiny" },
];

let transcriber = null;
let queue = Promise.resolve(); // one job at a time: the model can't run two at once

async function hasWebGpu() {
  try {
    return Boolean(self.navigator.gpu && (await self.navigator.gpu.requestAdapter()));
  } catch (error) {
    return false;
  }
}

async function load(preferGpu) {
  // Download progress across all the model's files, as one number.
  const files = new Map();
  const progress_callback = (p) => {
    if (p.status !== "progress" || !p.total) return;
    files.set(p.file, p);
    let loaded = 0, total = 0;
    for (const f of files.values()) { loaded += f.loaded; total += f.total; }
    self.postMessage({ type: "progress", loaded, total });
  };

  const devices = preferGpu && (await hasWebGpu()) ? ["webgpu", "wasm"] : ["wasm"];
  let lastError;
  for (const model of MODELS) {
    for (const device of devices) {
      try {
        // Graphics cards prefer full-precision encoders; processors prefer small 8-bit models.
        const dtype = device === "webgpu" ? { encoder_model: "fp32", decoder_model_merged: "q4" } : "q8";
        const started = performance.now();
        transcriber = await pipeline("automatic-speech-recognition", model.id, { device, dtype, progress_callback });
        await transcriber(new Float32Array(16000)); // warm up, so the first real caption isn't slow
        return { model: model.name, device, seconds: Math.round((performance.now() - started) / 100) / 10 };
      } catch (error) {
        lastError = error;
      }
    }
  }
  throw lastError;
}

function run(id, job) {
  queue = queue
    .then(job)
    .then((result) => self.postMessage({ id, ...result }))
    .catch((error) => self.postMessage({ id, type: "error", message: String((error && error.message) || error) }));
}

self.onmessage = (event) => {
  const { type, id } = event.data;
  if (type === "load") {
    run(id, async () => (transcriber ? { type: "ready", reused: true } : { type: "ready", ...(await load(event.data.preferGpu)) }));
  } else if (type === "transcribe") {
    run(id, async () => {
      const started = performance.now();
      const output = await transcriber(event.data.audio);
      return { type: "result", text: output.text || "", ms: Math.round(performance.now() - started) };
    });
  }
};
