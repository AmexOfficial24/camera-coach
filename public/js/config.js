// Every threshold the coach uses, in one place so they're easy to tune.
// Positions and sizes are shares of the video frame (0–1). Angles are in degrees.
export const CONFIG = {
  detectionFps: 15,          // face checks per second; lower = less CPU during a meeting
  lightingSampleMs: 500,     // how often brightness is measured
  scoreWindowMs: 30000,      // scores reflect the last 30 seconds
  recentWindowMs: 4000,      // tips react to the last 4 seconds

  eyeContact: {
    maxYaw: 15,              // head turned left/right
    maxPitch: 15,            // head tilted up/down
    maxGazeSideways: 0.55,   // eyes looking left/right (MediaPipe score 0–1)
    maxGazeDown: 0.55,       // eyes looking down, e.g. at notes or the keyboard
    blinkAt: 0.5,            // a blink doesn't count as looking away
    lookingAwayShare: 0.7,   // looking away for 70% of the recent window triggers the tip
  },
  expression: {
    smileAt: 0.35,           // mouth-corner score that counts as a smile
    smileRemindAfterMs: 45000,
    browDownTenseAt: 0.45,   // furrowed brow score that counts as tense
    tenseShare: 0.6,
  },
  framing: {
    centreMin: 0.3, centreMax: 0.7,    // face centre, left to right
    sizeMin: 0.18, sizeMax: 0.5,       // face width as a share of the frame
    eyeLineMin: 0.2, eyeLineMax: 0.55, // eye height, top to bottom
    maxTilt: 10,
  },
  lighting: {
    min: 0.28, max: 0.88,    // average face brightness (0 = black, 1 = white)
    backlightGap: 0.2,       // background this much brighter than the face = backlit
    staleAfterMs: 2000,
  },
  steadiness: {
    // Typical (median) head speed, in face-widths per second. A median ignores one move
    // to a new position; it only rises when you keep moving.
    calmSpeed: 0.1,
    maxSpeed: 0.25,
  },
  weights: { eyeContact: 0.3, expression: 0.2, framing: 0.2, lighting: 0.15, steadiness: 0.15 },

  tips: {
    sustainMs: 2000,         // a problem must last this long before we mention it
    interruptGap: 20,        // a tip this much more important replaces the one on screen
    noFaceAfterMs: 1500,
    betterShowMs: 2500,      // how long "That's better" stays up
    maxShowMs: 10000,        // stop repeating a tip that isn't being fixed
    cooldownMs: 20000,       // don't repeat a fixed tip for this long
    longCooldownMs: 40000,   // ...or one that was ignored
    praiseEveryMs: 30000,
    praiseShowMs: 4000,
  },
  check: { durationMs: 6000 },

  // Captions: your own microphone, turned into text on this computer.
  speech: {
    // Measured: Moonshine tiny on the processor took 0.6 s for 5 s of speech (28 MB download);
    // on the graphics card it took 2.9 s (79 MB). The processor also leaves the graphics card
    // to face tracking. Add ?gpu to the address to try the graphics card anyway.
    useGraphicsCard: false,
    sampleRate: 16000,       // what the speech model expects
    startMs: 120,            // this much speech starts a phrase
    hangoverMs: 700,         // this much silence ends it
    prerollMs: 250,          // keep a little audio from just before the speech started
    maxPhraseMs: 8000,       // long speech is cut into 8-second captions
    minSpeechMs: 300,        // shorter than this (a cough, a click) is ignored
    interimEveryMs: 1500,    // how often the live caption updates while you speak
    minLevel: 0.008,         // quietest sound (RMS) that can count as speech
    noiseMultiplier: 3,      // speech must be this much louder than the background
    lipMovementMin: 0.012,   // average jaw movement per face check that counts as talking
    captionLines: 3,         // lines shown in the live captions
  },
};
