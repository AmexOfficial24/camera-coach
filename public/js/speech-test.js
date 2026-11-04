/*
 * Camera Coach — speech test
 * Answers three questions before relying on captions in a meeting:
 *   1) Microphone     — can an embedded app use the mic (even while the Webex meeting uses it)?
 *   2) Speech model   — does it download and load here, on the graphics card or the processor?
 *   3) Speech to text — how well and how fast are 5 seconds of your speech turned into text?
 * Everything runs in the browser; no audio is sent anywhere. Add ?gpu to try the graphics card.
 */
import { concat, rms } from "./audio-utils.js";
import { describeMicError, openMic } from "./mic.js";
import { speechEngine } from "./speech-engine.js";
import { cleanText } from "./transcript.js";

const RECORD_SECONDS = 5;
const preferGpu = new URLSearchParams(location.search).has("gpu");

const results = {
  page: { address: location.origin, secureContext: window.isSecureContext, browser: navigator.userAgent },
  microphone: { status: "not started" },
  model: { status: "not loaded", graphicsCardAllowed: preferGpu },
  transcription: { status: "not started" },
};

let mic = null;
let recording = null; // blocks collected while recording
let modelReady = false;

const $ = (id) => document.getElementById(id);

/* ---------- results panel ---------- */

function setCheck(id, state, badge, detail) {
  const check = $(id);
  const badgeEl = check.querySelector(".badge");
  badgeEl.dataset.state = state;
  badgeEl.textContent = badge;
  check.querySelector(".detail").textContent = detail;
}

function reportText() {
  const lines = ["Camera Coach speech test", "Time: " + new Date().toISOString()];
  for (const [section, values] of Object.entries(results)) {
    lines.push("", "[" + section + "]");
    for (const [key, value] of Object.entries(values)) lines.push(key + ": " + value);
  }
  return lines.join("\n");
}

function renderReport() {
  $("report").textContent = reportText();
}

async function copyReport() {
  const button = $("copy-report");
  try {
    await navigator.clipboard.writeText(reportText());
    button.textContent = "Copied!";
  } catch (error) {
    const range = document.createRange();
    range.selectNodeContents($("report"));
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    button.textContent = "Selected: press Ctrl+C";
  }
  setTimeout(() => { button.textContent = "Copy results"; }, 2500);
}

function updateRecordButton() {
  $("record").disabled = !(mic && modelReady) || Boolean(recording);
}

/* ---------- 1) microphone ---------- */

function onBlock(block) {
  // Level meter on a decibel scale: -60 dB (silence) to 0 dB (as loud as it gets).
  const db = 20 * Math.log10(rms(block) || 1e-6);
  $("mic-meter").style.width = Math.max(0, Math.min(100, ((db + 60) / 60) * 100)) + "%";
  if (recording) recording.push(block);
}

async function startMic() {
  $("mic-start").disabled = true;
  setCheck("check-mic", "pending", "…", "Asking for the microphone…");
  try {
    mic = await openMic(onBlock);
  } catch (error) {
    const problem = describeMicError(error);
    results.microphone = { status: "failed", error: error.name + ": " + error.message };
    setCheck("check-mic", "bad", "✕", problem.title + ". " + problem.text);
    $("mic-start").disabled = false;
    renderReport();
    return;
  }
  results.microphone = { status: "on", device: mic.device, nativeSampleRate: mic.nativeRate };
  setCheck("check-mic", "ok", "✓", "Microphone is on: " + mic.device + ". The bar should move when you talk.");
  updateRecordButton();
  renderReport();
}

/* ---------- 2) speech model ---------- */

async function loadModel() {
  $("model-load").disabled = true;
  setCheck("check-model", "pending", "…", "Loading the speech model…");
  const engine = speechEngine();
  let downloadedMb = 0;
  engine.onProgress = (loaded, total) => {
    downloadedMb = total / 1e6;
    setCheck("check-model", "pending", "…",
      "Downloading the speech model: " + Math.round(loaded / 1e6) + " of " + Math.round(total / 1e6) + " MB…");
  };
  try {
    const info = await engine.load({ preferGpu });
    modelReady = true;
    results.model = {
      status: "loaded",
      model: info.model,
      runsOn: info.device === "webgpu" ? "graphics card (WebGPU)" : "processor (WebAssembly)",
      loadSeconds: info.seconds,
      downloadedMb: downloadedMb ? Math.round(downloadedMb) : "0 (already cached)",
    };
    setCheck("check-model", "ok", "✓",
      info.model + " loaded in " + info.seconds + " s, running on the " + results.model.runsOn + ".");
  } catch (error) {
    results.model = { status: "failed", error: String(error.message || error) };
    setCheck("check-model", "bad", "✕", "The speech model didn't load: " + results.model.error);
    $("model-load").disabled = false;
  }
  updateRecordButton();
  renderReport();
}

/* ---------- 3) speech to text ---------- */

async function record() {
  recording = [];
  updateRecordButton();
  for (let left = RECORD_SECONDS; left > 0; left--) {
    setCheck("check-transcribe", "pending", "…", "Recording: talk now… " + left);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const audio = concat(recording);
  recording = null;
  const audioSeconds = audio.length / 16000;
  setCheck("check-transcribe", "pending", "…", "Turning it into text…");
  try {
    const { text, ms } = await speechEngine().transcribe(audio);
    const heard = cleanText(text);
    results.transcription = {
      status: heard ? "worked" : "no words heard",
      text: heard || "(nothing)",
      audioSeconds: audioSeconds.toFixed(1),
      processingMs: ms,
      speed: (audioSeconds * 1000 / Math.max(ms, 1)).toFixed(1) + "x faster than real time",
    };
    $("heard").hidden = false;
    $("heard").textContent = "Heard: " + (heard || "(nothing)");
    setCheck("check-transcribe", heard ? "ok" : "warn", heard ? "✓" : "!",
      heard ? "Done in " + ms + " ms. Check the words below match what you said."
        : "No words were heard. Speak a little louder or closer to the microphone, then try again.");
  } catch (error) {
    results.transcription = { status: "failed", error: String(error.message || error) };
    setCheck("check-transcribe", "bad", "✕", "Transcription failed: " + results.transcription.error);
  }
  updateRecordButton();
  renderReport();
}

$("mic-start").addEventListener("click", startMic);
$("model-load").addEventListener("click", loadModel);
$("record").addEventListener("click", record);
$("copy-report").addEventListener("click", copyReport);
window.addEventListener("pagehide", () => mic && mic.close());
renderReport();
