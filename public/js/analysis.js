// Turns MediaPipe's raw output into simple measurements the coach can reason about.
// Pure functions only, so they can be unit-tested without a camera.
import { CONFIG } from "./config.js";

// Face mesh point numbers (MediaPipe's 478-point face model)
const POINT = { eyeOuterA: 33, eyeOuterB: 263, noseTip: 1, faceEdgeA: 234, faceEdgeB: 454 };

const toDegrees = (radians) => (radians * 180) / Math.PI;
export const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

// How far an angle is from level, ignoring direction: 170° and -10° both count as 10°.
export function foldAngle(degrees) {
  const a = Math.abs(degrees) % 180;
  return a > 90 ? 180 - a : a;
}

// MediaPipe's expression scores as { name: score }.
export function blendshapeScores(result) {
  const shapes = result && result.faceBlendshapes && result.faceBlendshapes[0];
  const scores = {};
  if (shapes) for (const c of shapes.categories) scores[c.categoryName] = c.score;
  return scores;
}

// Head turn (yaw) and nod (pitch) from the rotation part of MediaPipe's face transform.
// We only need how far the head has turned, not which way, so the result is unsigned.
export function headAngles(matrix) {
  if (!matrix || !matrix.data || matrix.data.length < 16) return null;
  const m = matrix.data;
  return {
    yaw: foldAngle(toDegrees(Math.asin(clamp(-m[2], -1, 1)))),
    pitch: foldAngle(toDegrees(Math.atan2(m[6], m[10]))),
  };
}

// Fallback head turn from the face mesh: where the nose sits between the face edges.
function yawFromNose(points) {
  const a = points[POINT.faceEdgeA].x;
  const b = points[POINT.faceEdgeB].x;
  const ratio = (points[POINT.noseTip].x - a) / (b - a || 1);
  return Math.abs(ratio - 0.5) * 120;
}

// One frame's measurements, or null if there's no face.
export function faceMetrics(result) {
  const points = result && result.faceLandmarks && result.faceLandmarks[0];
  if (!points) return null;

  let minX = 1, maxX = 0, minY = 1, maxY = 0;
  for (const p of points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }

  const s = blendshapeScores(result);
  const score = (name) => s[name] || 0;
  const angles = headAngles(result.facialTransformationMatrixes && result.facialTransformationMatrixes[0]);
  const eyeA = points[POINT.eyeOuterA];
  const eyeB = points[POINT.eyeOuterB];

  return {
    box: { minX, maxX, minY, maxY },
    centreX: (minX + maxX) / 2,
    centreY: (minY + maxY) / 2,
    size: maxX - minX,
    eyeLine: (eyeA.y + eyeB.y) / 2,
    yaw: angles ? angles.yaw : yawFromNose(points),
    pitch: angles ? angles.pitch : 0,
    tilt: foldAngle(toDegrees(Math.atan2(eyeB.y - eyeA.y, eyeB.x - eyeA.x))),
    smile: (score("mouthSmileLeft") + score("mouthSmileRight")) / 2,
    browDown: (score("browDownLeft") + score("browDownRight")) / 2,
    gazeSideways: Math.max(score("eyeLookOutLeft"), score("eyeLookInLeft"), score("eyeLookOutRight"), score("eyeLookInRight")),
    gazeDown: Math.max(score("eyeLookDownLeft"), score("eyeLookDownRight")),
    blink: (score("eyeBlinkLeft") + score("eyeBlinkRight")) / 2,
    mouthOpen: score("jawOpen"),
  };
}

// How much your jaw moved between `from` and `to` (average change per face check), from
// samples of { t, mouthOpen }. Captions use it to tell your voice from other people's voices
// coming out of your speakers. null if your face wasn't tracked then, so we can't tell.
export function lipMovement(samples, from, to) {
  const window = samples.filter((s) => s.t >= from && s.t <= to);
  if (window.length < 5) return null;
  let total = 0;
  for (let i = 1; i < window.length; i++) total += Math.abs(window[i].mouthOpen - window[i - 1].mouthOpen);
  return total / (window.length - 1);
}

export function isLookingAtCamera(m, limits = CONFIG.eyeContact) {
  if (m.blink >= limits.blinkAt) return true; // blinking isn't looking away
  return m.yaw <= limits.maxYaw && m.pitch <= limits.maxPitch &&
    m.gazeSideways <= limits.maxGazeSideways && m.gazeDown <= limits.maxGazeDown;
}

// Average brightness (0–1) of the face and of everything around it.
// `image` is ImageData-like ({ data, width, height }) from the un-mirrored video.
export function measureLighting(image, box) {
  const { data, width, height } = image;
  // Use the middle of the face box, so hair and background at the edges don't count as face.
  const shrinkX = (box.maxX - box.minX) * 0.15;
  const shrinkY = (box.maxY - box.minY) * 0.15;
  const x0 = Math.floor(clamp(box.minX + shrinkX, 0, 1) * width);
  const x1 = Math.ceil(clamp(box.maxX - shrinkX, 0, 1) * width);
  const y0 = Math.floor(clamp(box.minY + shrinkY, 0, 1) * height);
  const y1 = Math.ceil(clamp(box.maxY - shrinkY, 0, 1) * height);
  const outer = {
    x0: Math.floor(clamp(box.minX, 0, 1) * width), x1: Math.ceil(clamp(box.maxX, 0, 1) * width),
    y0: Math.floor(clamp(box.minY, 0, 1) * height), y1: Math.ceil(clamp(box.maxY, 0, 1) * height),
  };

  let faceSum = 0, faceCount = 0, backSum = 0, backCount = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const luminance = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
      if (x >= x0 && x < x1 && y >= y0 && y < y1) {
        faceSum += luminance; faceCount++;
      } else if (x < outer.x0 || x >= outer.x1 || y < outer.y0 || y >= outer.y1) {
        backSum += luminance; backCount++;
      }
    }
  }
  return {
    face: faceCount ? faceSum / faceCount : 0,
    background: backCount ? backSum / backCount : 0,
  };
}
