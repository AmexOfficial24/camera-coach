// The microphone, delivered as small blocks of 16 kHz audio (what the speech model expects).
import { Resampler } from "./audio-utils.js";

const RATE = 16000;

const PROBLEMS = {
  NotAllowedError: {
    title: "Microphone access is blocked",
    text: "Allow microphone access for Camera Coach when Webex or your browser asks, then try again.",
  },
  NotReadableError: {
    title: "Your microphone is busy",
    text: "Another app is holding it exclusively. Close other apps using the microphone, then try again.",
  },
  NotFoundError: {
    title: "No microphone found",
    text: "Plug in or turn on a microphone, then try again.",
  },
};

export function describeMicError(error) {
  return PROBLEMS[error && error.name] || {
    title: "The microphone didn't start",
    text: "Something went wrong (" + ((error && error.name) || "unknown error") + "). Try again.",
  };
}

// Opens the mic at 16 kHz if the browser allows it, otherwise at its own rate and converts.
function audioGraph(stream) {
  let context;
  try {
    context = new AudioContext({ sampleRate: RATE });
    return { context, source: context.createMediaStreamSource(stream) };
  } catch (error) {
    if (context) context.close();
    context = new AudioContext();
    return { context, source: context.createMediaStreamSource(stream) };
  }
}

// Calls onBlock(samples, time) about 30 times a second. Returns { close() }.
export async function openMic(onBlock) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    const error = new Error("Microphone API not available");
    error.name = "NoMicApi";
    throw error;
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    video: false,
  });
  const { context, source } = audioGraph(stream);
  await context.audioWorklet.addModule(new URL("./mic-worklet.js", import.meta.url));
  const node = new AudioWorkletNode(context, "mic-blocks");
  const resampler = context.sampleRate === RATE ? null : new Resampler(context.sampleRate, RATE);
  node.port.onmessage = (event) => {
    const block = resampler ? resampler.push(event.data) : event.data;
    if (block.length) onBlock(block, performance.now());
  };
  // The worklet only runs while connected to the speakers; a muted gain keeps it silent.
  const mute = context.createGain();
  mute.gain.value = 0;
  source.connect(node).connect(mute).connect(context.destination);
  if (context.state === "suspended") await context.resume();

  return {
    device: (stream.getAudioTracks()[0] || {}).label || "microphone",
    nativeRate: context.sampleRate,
    close() {
      node.port.onmessage = null;
      source.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      context.close();
    },
  };
}
