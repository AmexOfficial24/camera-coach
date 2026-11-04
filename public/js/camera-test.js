/*
 * Camera test page. We made this before the real app to check three things:
 *   1. Is the page running inside Webex, and in a meeting or a space?
 *   2. Can an embedded app turn on the camera?
 *   3. Does MediaPipe Face Landmarker load and run in Webex's browser?
 * Everything runs in the browser and no video is sent anywhere.
 */

const MEDIAPIPE_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21";
const FACE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const WEBEX_TIMEOUT_MS = 4000;
const NO_FACE_WARNING_MS = 5000;

const results = {
  page: {
    address: location.origin,
    secureContext: window.isSecureContext,
    browser: navigator.userAgent,
  },
  webex: { status: "checking" },
  camera: { status: "not started" },
  tracking: { status: "not started" },
};

let stream = null;
let trackingHandle = null;

const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Resolve with the promise's value, or `fallback` if it takes longer than `ms`.
function withTimeout(promise, ms, fallback) {
  return Promise.race([promise, wait(ms).then(() => fallback)]);
}

/* =========================================================
 * RESULTS PANEL
 * ========================================================= */

function setCheck(id, state, badge, detail) {
  const check = $(id);
  const badgeEl = check.querySelector(".badge");
  badgeEl.dataset.state = state;
  badgeEl.textContent = badge;
  check.querySelector(".detail").textContent = detail;
}

function reportText() {
  const lines = ["Camera Coach camera test", "Time: " + new Date().toISOString()];
  for (const [section, values] of Object.entries(results)) {
    lines.push("", "[" + section + "]");
    for (const [key, value] of Object.entries(values)) {
      const shown = Array.isArray(value) ? value.join(", ") || "(none)" : value;
      lines.push(key + ": " + shown);
    }
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
    // Clipboard can be blocked in embedded browsers: select the text so it can be copied by hand.
    const range = document.createRange();
    range.selectNodeContents($("report"));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    button.textContent = "Selected: press Ctrl+C";
  }
  setTimeout(() => { button.textContent = "Copy results"; }, 2500);
}

/* =========================================================
 * 1) WEBEX
 * ========================================================= */

async function checkWebex() {
  if (!window.webex || !window.webex.Application) {
    results.webex = { status: "Webex SDK did not load" };
    setCheck("check-webex", "bad", "✕", "The Webex SDK didn't load, so this page can't talk to Webex.");
    return;
  }

  const app = new window.webex.Application();
  const ready = await withTimeout(app.onReady().then(() => true), WEBEX_TIMEOUT_MS, false);
  if (!ready) {
    results.webex = { status: "not inside Webex" };
    setCheck("check-webex", "warn", "!", "Not running inside Webex. That's fine for testing in a normal browser.");
    return;
  }

  const states = app.application && app.application.states;
  const user = (states && states.user) || {};
  const place = await detectPlace(app);
  results.webex = {
    status: "inside Webex",
    name: user.displayName || "(not shared)",
    userIdAvailable: Boolean(user.id),
    place: place.where,
    meetingRoles: place.roles,
    sdkVersion: app.sdkVersion || "unknown",
    deviceType: app.deviceType || "unknown",
    theme: app.theme || "unknown",
  };
  document.documentElement.dataset.theme = app.theme === "LIGHT" ? "LIGHT" : "DARK";
  setCheck(
    "check-webex", "ok", "✓",
    "Inside Webex as " + results.webex.name + ", in a " + place.where + "."
  );
}

// Work out whether the app was opened in a meeting or a space.
async function detectPlace(app) {
  const meeting = await withTimeout(app.context.getMeeting().catch(() => null), 3000, null);
  if (meeting && meeting.id) return { where: "meeting", roles: meeting.userRoles || [] };
  const space = await withTimeout(app.context.getSpace().catch(() => null), 3000, null);
  if (space && space.id) return { where: "space", roles: [] };
  return { where: "place Webex didn't report", roles: [] };
}

/* =========================================================
 * 2) CAMERA
 * ========================================================= */

const CAMERA_ERRORS = {
  NotAllowedError: "Permission denied: camera access was blocked (by Webex, the browser, or the permission prompt).",
  NotReadableError: "Camera is busy: another app, probably your Webex meeting video, is using it.",
  NotFoundError: "No camera was found on this computer.",
  OverconstrainedError: "The camera doesn't support the requested settings.",
  SecurityError: "Blocked by this page's security settings.",
  AbortError: "The camera started to open but then failed.",
};

async function cameraPermission() {
  try {
    return (await navigator.permissions.query({ name: "camera" })).state;
  } catch (error) {
    return "unknown";
  }
}

async function startCamera() {
  $("camera-start").disabled = true;
  setCheck("check-camera", "pending", "…", "Asking for the camera…");
  const hasApi = Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  results.camera = { status: "starting", cameraApiAvailable: hasApi, permissionBefore: await cameraPermission() };

  if (!hasApi) {
    results.camera.status = "failed";
    setCheck("check-camera", "bad", "✕", "This browser doesn't offer camera access here (the page isn't secure, or the camera API is switched off).");
    $("camera-start").disabled = false;
    renderReport();
    return;
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
      audio: false,
    });
  } catch (error) {
    results.camera.status = "failed";
    results.camera.error = error.name + ": " + error.message;
    setCheck("check-camera", "bad", "✕", CAMERA_ERRORS[error.name] || "The camera didn't start (" + error.name + ").");
    $("camera-start").disabled = false;
    renderReport();
    return;
  }

  const video = $("video");
  video.srcObject = stream;
  await video.play();
  $("preview").hidden = false;

  const track = stream.getVideoTracks()[0];
  const settings = track.getSettings();
  const devices = await navigator.mediaDevices.enumerateDevices();
  Object.assign(results.camera, {
    status: "on",
    device: track.label || "(name hidden)",
    resolution: settings.width + "x" + settings.height,
    frameRate: settings.frameRate ? Math.round(settings.frameRate) : "unknown",
    camerasFound: devices.filter((d) => d.kind === "videoinput").length,
    permissionAfter: await cameraPermission(),
  });
  setCheck("check-camera", "ok", "✓", "Camera is on: " + results.camera.device + " at " + results.camera.resolution + ".");
  $("camera-stop").disabled = false;
  $("tracking-start").disabled = false;
  renderReport();
}

function stopCamera() {
  stopTracking();
  if (stream) stream.getTracks().forEach((track) => track.stop());
  stream = null;
  $("video").srcObject = null;
  $("preview").hidden = true;
  $("camera-start").disabled = false;
  $("camera-stop").disabled = true;
  $("tracking-start").disabled = true;
  if (results.camera.status === "on") results.camera.status = "worked, then stopped";
  setCheck("check-camera", "ok", "✓", "Camera worked and is now off.");
  renderReport();
}

/* =========================================================
 * 3) FACE TRACKING
 * ========================================================= */

// Try the GPU first (fast); fall back to the CPU if this browser can't use WebGL for it.
async function createLandmarker(vision, files) {
  let lastError;
  for (const delegate of ["GPU", "CPU"]) {
    try {
      const landmarker = await vision.FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
      });
      return { landmarker, delegate };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function startTracking() {
  $("tracking-start").disabled = true;
  setCheck("check-tracking", "pending", "…", "Loading face tracking (about 13 MB the first time)…");
  const loadStart = performance.now();

  let vision, landmarker, delegate;
  try {
    vision = await import(MEDIAPIPE_URL + "/vision_bundle.mjs");
    const files = await vision.FilesetResolver.forVisionTasks(MEDIAPIPE_URL + "/wasm");
    ({ landmarker, delegate } = await createLandmarker(vision, files));
  } catch (error) {
    results.tracking = { status: "failed to load", error: (error && error.name) + ": " + (error && error.message) };
    setCheck("check-tracking", "bad", "✕", "Face tracking couldn't load: " + results.tracking.error);
    $("tracking-start").disabled = false;
    renderReport();
    return;
  }

  results.tracking = {
    status: "running, looking for a face",
    processor: delegate,
    loadSeconds: ((performance.now() - loadStart) / 1000).toFixed(1),
  };
  setCheck("check-tracking", "pending", "…", "Face tracking loaded on the " + delegate + ". Looking for your face…");
  renderReport();
  runTrackingLoop(vision, landmarker);
}

function smileScore(result) {
  const shapes = result.faceBlendshapes && result.faceBlendshapes[0];
  if (!shapes) return 0;
  const score = (name) => (shapes.categories.find((c) => c.categoryName === name) || { score: 0 }).score;
  return (score("mouthSmileLeft") + score("mouthSmileRight")) / 2;
}

function runTrackingLoop(vision, landmarker) {
  const video = $("video");
  const canvas = $("overlay");
  const ctx = canvas.getContext("2d");
  const drawing = new vision.DrawingUtils(ctx);
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  const startedAt = performance.now();
  let lastVideoTime = -1;
  let frames = 0;
  let windowStart = startedAt;
  let faceSeen = false;
  let latest = null;

  function frame() {
    if (!stream) return;
    if (video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      latest = landmarker.detectForVideo(video, performance.now());
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const face = latest.faceLandmarks[0];
      if (face) {
        faceSeen = true;
        drawing.drawConnectors(face, vision.FaceLandmarker.FACE_LANDMARKS_TESSELATION, {
          color: "rgba(0, 176, 240, 0.55)",
          lineWidth: 1,
        });
      }
      frames++;
    }

    const now = performance.now();
    if (now - windowStart >= 1000) {
      const fps = Math.round((frames * 1000) / (now - windowStart));
      frames = 0;
      windowStart = now;
      reportTracking(fps, latest, faceSeen, now - startedAt);
    }
    trackingHandle = requestAnimationFrame(frame);
  }
  trackingHandle = requestAnimationFrame(frame);
}

// Once a second: update the live readout, the tracking check, and the report.
function reportTracking(fps, latest, faceSeen, runningMs) {
  const faceNow = Boolean(latest && latest.faceLandmarks[0]);
  const smile = Math.round(smileScore(latest || {}) * 100);
  const readout = $("live-readout");
  readout.hidden = false;
  readout.textContent = "Face: " + (faceNow ? "found" : "not found") + "  ·  Smile: " + smile + "%  ·  " + fps + " frames/sec";

  Object.assign(results.tracking, { framesPerSecond: fps, faceFoundNow: faceNow, smileNow: smile + "%" });
  if (faceSeen) {
    results.tracking.status = "working";
    setCheck("check-tracking", "ok", "✓", "Face tracking works: " + fps + " frames/sec on the " + results.tracking.processor + ".");
  } else if (runningMs > NO_FACE_WARNING_MS) {
    results.tracking.status = "running, but no face found yet";
    setCheck("check-tracking", "warn", "!", "Running, but no face found yet. Check the lighting and that your face is in view.");
  }
  renderReport();
}

function stopTracking() {
  if (trackingHandle) cancelAnimationFrame(trackingHandle);
  trackingHandle = null;
  const canvas = $("overlay");
  canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
  $("live-readout").hidden = true;
}

/* =========================================================
 * BOOTSTRAP
 * ========================================================= */

$("camera-start").addEventListener("click", startCamera);
$("camera-stop").addEventListener("click", stopCamera);
$("tracking-start").addEventListener("click", startTracking);
$("copy-report").addEventListener("click", copyReport);
renderReport();
checkWebex().then(renderReport);
