// Turning the camera on and off, and explaining what went wrong when it won't start.
const PROBLEMS = {
  NotAllowedError: {
    title: "Camera access is blocked",
    text: "Allow camera access for Camera Coach when Webex or your browser asks, then try again.",
  },
  NotReadableError: {
    title: "Your camera is busy",
    text: "Another app is using it, probably your Webex meeting video. Turn your meeting video off, or run a camera check before you join.",
  },
  NotFoundError: {
    title: "No camera found",
    text: "Plug in or turn on a camera, then try again.",
  },
};

const SIZE = { width: { ideal: 640 }, height: { ideal: 480 } };

// Windows only lets one app use a webcam at a time, so the default camera is often
// busy with the Webex meeting video. If it is, try the other cameras, for example
// an OBS Virtual Camera that shares the webcam with Webex.
async function getCameraStream() {
  try {
    return await navigator.mediaDevices.getUserMedia({ video: { ...SIZE, facingMode: "user" }, audio: false });
  } catch (error) {
    if (error.name !== "NotReadableError" && error.name !== "AbortError") throw error;
    const devices = await navigator.mediaDevices.enumerateDevices();
    for (const device of devices) {
      if (device.kind !== "videoinput" || !device.deviceId) continue;
      try {
        return await navigator.mediaDevices.getUserMedia({
          video: { ...SIZE, deviceId: { exact: device.deviceId } },
          audio: false,
        });
      } catch {
        // This one is busy too, so try the next one.
      }
    }
    throw error;
  }
}

export async function openCamera(video) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    const error = new Error("Camera API not available");
    error.name = "NoCameraApi";
    throw error;
  }
  const stream = await getCameraStream();
  video.srcObject = stream;
  await video.play();
  return stream;
}

export function closeCamera(stream, video) {
  if (stream) stream.getTracks().forEach((track) => track.stop());
  video.srcObject = null;
}

export function describeCameraError(error) {
  if (error && error.name === "NoCameraApi") {
    return { title: "Camera isn't available here", text: "This page can't use a camera. Open it over HTTPS, or inside Webex." };
  }
  return PROBLEMS[error && error.name] || {
    title: "The camera didn't start",
    text: "Something went wrong (" + ((error && error.name) || "unknown error") + "). Try again, or restart Webex.",
  };
}
