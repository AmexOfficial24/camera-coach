import { test } from "node:test";
import assert from "node:assert/strict";
import { faceMetrics, foldAngle, headAngles, isLookingAtCamera, measureLighting } from "../public/js/analysis.js";

// A 4x4 transform (column-major, like MediaPipe) that turns the head `degrees` around the vertical axis.
function turnedHead(degrees) {
  const r = (degrees * Math.PI) / 180;
  return { data: [Math.cos(r), 0, -Math.sin(r), 0, 0, 1, 0, 0, Math.sin(r), 0, Math.cos(r), 0, 0, 0, 0, 1] };
}

test("head angles: facing the camera is 0, a 30 degree turn is 30", () => {
  assert.deepEqual(headAngles(turnedHead(0)), { yaw: 0, pitch: 0 });
  assert.ok(Math.abs(headAngles(turnedHead(30)).yaw - 30) < 0.01);
  assert.ok(Math.abs(headAngles(turnedHead(-30)).yaw - 30) < 0.01, "direction doesn't matter");
  assert.equal(headAngles(null), null);
});

test("angles are folded so upside-down conventions don't read as a big turn", () => {
  assert.equal(foldAngle(180), 0);
  assert.equal(foldAngle(-170), 10);
  assert.equal(foldAngle(95), 85);
});

test("looking at the camera: blinking still counts, looking down at notes doesn't", () => {
  const base = { yaw: 5, pitch: 5, gazeSideways: 0.2, gazeDown: 0.1, blink: 0 };
  assert.equal(isLookingAtCamera(base), true);
  assert.equal(isLookingAtCamera({ ...base, yaw: 30 }), false);
  assert.equal(isLookingAtCamera({ ...base, gazeDown: 0.8 }), false);
  assert.equal(isLookingAtCamera({ ...base, gazeDown: 0.8, blink: 0.9 }), true);
});

test("face metrics come from the mesh points and expression scores", () => {
  const points = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.4, z: 0 }));
  points[10] = { x: 0.5, y: 0.2, z: 0 };   // top of the face box
  points[152] = { x: 0.5, y: 0.6, z: 0 };  // chin
  points[234] = { x: 0.35, y: 0.4, z: 0 }; // face edges
  points[454] = { x: 0.65, y: 0.4, z: 0 };
  points[33] = { x: 0.42, y: 0.35, z: 0 }; // outer eye corners, level
  points[263] = { x: 0.58, y: 0.35, z: 0 };
  const result = {
    faceLandmarks: [points],
    faceBlendshapes: [{ categories: [
      { categoryName: "mouthSmileLeft", score: 0.8 }, { categoryName: "mouthSmileRight", score: 0.6 },
    ] }],
    facialTransformationMatrixes: [turnedHead(0)],
  };
  const m = faceMetrics(result);
  assert.ok(Math.abs(m.size - 0.3) < 1e-9);
  assert.ok(Math.abs(m.centreX - 0.5) < 1e-9);
  assert.ok(Math.abs(m.eyeLine - 0.35) < 1e-9);
  assert.equal(m.tilt, 0);
  assert.ok(Math.abs(m.smile - 0.7) < 1e-9);
  assert.equal(faceMetrics({ faceLandmarks: [] }), null);
});

test("lighting compares the middle of the face with the background", () => {
  const width = 20, height = 20;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inFace = x >= 5 && x < 15 && y >= 5 && y < 15;
      const v = inFace ? 40 : 230; // dark face, bright window behind
      data.set([v, v, v, 255], (y * width + x) * 4);
    }
  }
  const light = measureLighting({ data, width, height }, { minX: 0.25, maxX: 0.75, minY: 0.25, maxY: 0.75 });
  assert.ok(light.face < 0.2);
  assert.ok(light.background > 0.85);
});
