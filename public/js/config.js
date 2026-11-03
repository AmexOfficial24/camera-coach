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
};
