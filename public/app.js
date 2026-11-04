/*
 * Camera Coach main file. Starts the camera and face tracking, runs the frame loop and
 * switches between screens. Most of the logic lives in js/: analysis.js works out the
 * measurements, coach.js turns them into scores and tips, report.js builds the report.
 * Video never leaves the browser.
 */
import { CONFIG } from "./js/config.js";
import { faceMetrics, measureLighting } from "./js/analysis.js";
import { Coach } from "./js/coach.js";
import { closeCamera, describeCameraError, openCamera } from "./js/camera.js";
import { loadTracker } from "./js/tracker.js";
import { webex } from "./js/webex.js";
import { loadSettings, saveSettings } from "./js/settings.js";
import { buildReport, reportFileName, reportToCsv, reportToHtml, reportToText } from "./js/report.js";
import { listReports, saveReport, takeUnfinishedReport } from "./js/reports-store.js";
import * as ui from "./js/ui.js";

const AUTOSAVE_MS = 10000;

const $ = (id) => document.getElementById(id);
const video = $("video");
const mesh = $("mesh");
const meshContext = mesh.getContext("2d");

// A small copy of each frame for measuring brightness (cheaper than the full frame).
const lightCanvas = document.createElement("canvas");
lightCanvas.width = 96;
lightCanvas.height = 72;
const lightContext = lightCanvas.getContext("2d", { willReadFrequently: true });

const settings = loadSettings();
const state = {
  mode: null,        // "coach" or "check" while the camera is on
  lastMode: "coach",
  stream: null,
  tracker: null,
  drawing: null,
  coach: null,
  frameHandle: null,
  checkEndsAt: 0,
  lastDetect: 0,
  lastLighting: 0,
  lastScreen: 0,
  lastScoreRecord: 0,
  metrics: null,
  lighting: null,
  fps: 0,
  fpsFrames: 0,
  fpsSince: 0,
  where: { place: "browser", title: null }, // from Webex
  session: null,     // { startedAt } for the coaching session being recorded
  lastAutosave: 0,
  report: null,      // the report on screen
};

/* =========================================================
 * STARTING AND STOPPING
 * ========================================================= */

async function start(mode) {
  state.lastMode = mode;
  ui.showScreen("loading");
  ui.setLoading("Starting your camera…");
  try {
    state.stream = await openCamera(video);
  } catch (error) {
    ui.showError(describeCameraError(error));
    return;
  }

  ui.setLoading("Loading face tracking…");
  try {
    state.tracker = await loadTracker();
  } catch (error) {
    stopCamera();
    ui.showError({ title: "Face tracking didn't load", text: "Check your internet connection, then try again." });
    return;
  }

  mesh.width = video.videoWidth;
  mesh.height = video.videoHeight;
  state.drawing = new state.tracker.vision.DrawingUtils(meshContext);

  const now = performance.now();
  Object.assign(state, {
    mode, coach: new Coach(now), metrics: null, lighting: null,
    lastScoreRecord: now, fpsSince: now, fpsFrames: 0, checkEndsAt: now + CONFIG.check.durationMs,
    session: mode === "coach" ? { startedAt: Date.now() } : null, lastAutosave: now,
  });
  ui.renderTip({ kind: "none", icon: "⏳", text: "Getting ready…" });
  ui.renderScores(state.coach.scores(now));
  applySettings();
  ui.showScreen(mode);
  state.frameHandle = requestAnimationFrame(frame);
}

function stopCamera() {
  cancelAnimationFrame(state.frameHandle);
  closeCamera(state.stream, video);
  state.stream = null;
  state.mode = null;
  meshContext.clearRect(0, 0, mesh.width, mesh.height);
  ui.showPreview(false);
  ui.showDebug(false);
}

function finishCheck(now) {
  const result = state.coach.checklist(now);
  stopCamera();
  ui.renderChecklist(result);
  ui.showScreen("check-results");
}

// Save the coaching session so far. Unfinished reports are picked up next time the app opens,
// which is how a report survives the meeting ending and Webex closing the app.
function saveSession(finished) {
  if (!state.session || !state.coach) return null;
  const summary = state.coach.summary(performance.now());
  if (summary.averageScore === null) return null; // nothing worth reporting yet
  const report = buildReport(summary, {
    startedAt: state.session.startedAt, finished, place: state.where.place, meetingTitle: state.where.title,
  });
  saveReport(report);
  return report;
}

function endSession() {
  const report = saveSession(true);
  state.session = null;
  stopCamera();
  if (report) {
    showReport(report);
  } else {
    goHome();
  }
}

function showReport(report, options) {
  state.report = report;
  ui.renderReport(report, options);
  ui.showScreen("report");
  window.scrollTo(0, 0);
}

function goHome() {
  ui.renderPastReports(listReports().filter((r) => r.finished), (report) => showReport(report));
  ui.showScreen("start");
}

/* =========================================================
 * EXPORT
 * ========================================================= */

function download(text, type, fileName) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  ui.setExportStatus("Saved " + fileName + ". If no file appeared, Webex may block downloads here: use Copy summary instead.");
}

async function copySummary() {
  const text = reportToText(state.report);
  const box = $("copy-box");
  try {
    await navigator.clipboard.writeText(text);
    box.hidden = true;
    ui.setExportStatus("Summary copied. Paste it into a Webex message, an email or your notes.");
  } catch (error) {
    // Clipboard blocked (some embedded browsers): show the text selected, ready for Ctrl+C.
    box.value = text;
    box.hidden = false;
    box.focus();
    box.select();
    ui.setExportStatus("Press Ctrl+C (or Cmd+C) to copy the summary below.");
  }
}

/* =========================================================
 * FRAME LOOP
 * ========================================================= */

function frame(now) {
  state.frameHandle = requestAnimationFrame(frame);
  if (!state.stream || video.readyState < 2) return;
  if (now - state.lastDetect >= 1000 / CONFIG.detectionFps) {
    state.lastDetect = now;
    detect(now);
  }
  if (now - state.lastScreen >= 250) {
    state.lastScreen = now;
    updateScreen(now);
  }
}

function detect(now) {
  const result = state.tracker.landmarker.detectForVideo(video, now);
  const metrics = faceMetrics(result);
  state.metrics = metrics;
  state.coach.addFrame(now, metrics);

  if (metrics && now - state.lastLighting >= CONFIG.lightingSampleMs) {
    state.lastLighting = now;
    lightContext.drawImage(video, 0, 0, lightCanvas.width, lightCanvas.height);
    state.lighting = measureLighting(lightContext.getImageData(0, 0, lightCanvas.width, lightCanvas.height), metrics.box);
    state.coach.addLighting(now, state.lighting);
  }

  drawMesh(result);

  state.fpsFrames++;
  if (now - state.fpsSince >= 1000) {
    state.fps = Math.round((state.fpsFrames * 1000) / (now - state.fpsSince));
    state.fpsFrames = 0;
    state.fpsSince = now;
  }
}

// The face mesh is a testing view: only drawn when "Show face mesh" is on.
function drawMesh(result) {
  meshContext.clearRect(0, 0, mesh.width, mesh.height);
  const face = settings.showMesh && result.faceLandmarks[0];
  if (!face) return;
  const { FaceLandmarker } = state.tracker.vision;
  state.drawing.drawConnectors(face, FaceLandmarker.FACE_LANDMARKS_TESSELATION, { color: "rgba(51, 170, 255, 0.45)", lineWidth: 1 });
  state.drawing.drawConnectors(face, FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS, { color: "#3fb950", lineWidth: 2 });
  state.drawing.drawConnectors(face, FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS, { color: "#3fb950", lineWidth: 2 });
}

function updateScreen(now) {
  const coach = state.coach;
  if (state.mode === "coach") {
    const scores = coach.scores(now);
    ui.renderScores(scores);
    ui.renderTip(coach.currentTip(now));
    if (now - state.lastScoreRecord >= 1000) {
      state.lastScoreRecord = now;
      coach.recordScore(now, scores);
    }
    if (now - state.lastAutosave >= AUTOSAVE_MS) {
      state.lastAutosave = now;
      saveSession(false);
    }
  } else if (state.mode === "check") {
    const left = Math.max(0, state.checkEndsAt - now);
    ui.renderCheckProgress(1 - left / CONFIG.check.durationMs, Math.ceil(left / 1000));
    if (left === 0) {
      finishCheck(now);
      return;
    }
  }
  if (settings.showNumbers) ui.renderDebug(measurementLines());
}

function measurementLines() {
  const m = state.metrics;
  const l = state.lighting;
  const n = (value, digits = 2) => Number(value).toFixed(digits);
  const lines = ["tracking: " + state.tracker.processor + ", " + state.fps + " checks/sec"];
  if (!m) return lines.concat("face: not found");
  return lines.concat(
    "head: turn " + n(m.yaw, 0) + "°, nod " + n(m.pitch, 0) + "°, tilt " + n(m.tilt, 0) + "°",
    "eyes: sideways " + n(m.gazeSideways) + ", down " + n(m.gazeDown) + ", blink " + n(m.blink),
    "expression: smile " + n(m.smile) + ", brow down " + n(m.browDown),
    "framing: centre " + n(m.centreX) + ", size " + n(m.size) + ", eye line " + n(m.eyeLine),
    l ? "light: face " + n(l.face) + ", background " + n(l.background) : "light: measuring…"
  );
}

/* =========================================================
 * SETTINGS
 * ========================================================= */

const TOGGLES = { "setting-video": "showVideo", "setting-mesh": "showMesh", "setting-numbers": "showNumbers" };

function applySettings() {
  // You always see yourself during the quick check; while coaching it's your choice.
  ui.showPreview(state.mode === "check" || (state.mode === "coach" && settings.showVideo));
  ui.showDebug(Boolean(state.mode) && settings.showNumbers);
  if (!settings.showMesh) meshContext.clearRect(0, 0, mesh.width, mesh.height);
}

function openSettings() {
  for (const [id, key] of Object.entries(TOGGLES)) $(id).checked = settings[key];
  $("settings").showModal();
}

for (const [id, key] of Object.entries(TOGGLES)) {
  $(id).addEventListener("change", (event) => {
    settings[key] = event.target.checked;
    saveSettings(settings);
    applySettings();
  });
}

/* =========================================================
 * EVENTS AND STARTUP
 * ========================================================= */

$("start-coaching").addEventListener("click", () => start("coach"));
$("start-check").addEventListener("click", () => start("check"));
$("stop-coaching").addEventListener("click", endSession);
$("results-coach").addEventListener("click", () => start("coach"));
$("results-again").addEventListener("click", () => start("check"));
$("report-again").addEventListener("click", () => start("coach"));
$("report-home").addEventListener("click", goHome);
$("export-html").addEventListener("click", () =>
  download(reportToHtml(state.report), "text/html", reportFileName(state.report, "html")));
$("export-csv").addEventListener("click", () =>
  download(reportToCsv(state.report), "text/csv", reportFileName(state.report, "csv")));
$("export-copy").addEventListener("click", copySummary);
$("error-retry").addEventListener("click", () => start(state.lastMode));
$("open-settings").addEventListener("click", openSettings);
$("close-settings").addEventListener("click", () => $("settings").close());
// The meeting ending closes the app: save what we have so the report is waiting next time.
window.addEventListener("pagehide", () => {
  saveSession(false);
  stopCamera();
});

ui.buildCategories();
ui.applyTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "DARK" : "LIGHT");
const unfinished = takeUnfinishedReport();
if (unfinished) {
  showReport(unfinished, { justEnded: true });
} else {
  goHome();
}
webex.init().then(async (insideWebex) => {
  if (!insideWebex) return;
  ui.setGreeting(webex.userName());
  webex.watchTheme(ui.applyTheme);
  state.where = await webex.placeInfo();
});
// Start downloading face tracking in the background, so Start feels instant.
setTimeout(() => loadTracker().catch(() => {}), 1000);
