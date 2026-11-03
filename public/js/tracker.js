// Loads MediaPipe Face Landmarker once. Versions are pinned so a new release can't break a demo.
const MEDIAPIPE_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21";
const FACE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

let loading = null;

async function create() {
  const vision = await import(MEDIAPIPE_URL + "/vision_bundle.mjs");
  const files = await vision.FilesetResolver.forVisionTasks(MEDIAPIPE_URL + "/wasm");
  let lastError;
  // Try the graphics card first (fast), then fall back to the processor.
  for (const processor of ["GPU", "CPU"]) {
    try {
      const landmarker = await vision.FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate: processor },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      });
      return { vision, landmarker, processor };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

// Shared by every session; if loading fails, the next call tries again.
export function loadTracker() {
  if (!loading) loading = create().catch((error) => { loading = null; throw error; });
  return loading;
}
