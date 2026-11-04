// The coach: turns a stream of face measurements into scores and one tip at a time.
// So it doesn't nag, a problem has to last a couple of seconds before it's mentioned,
// fixed tips get a "That's better", and tips that keep coming back are rested.
import { CONFIG } from "./config.js";
import { clamp, isLookingAtCamera } from "./analysis.js";

export const CATEGORIES = [
  { id: "eyeContact", label: "Eye contact", icon: "👀" },
  { id: "expression", label: "Expression", icon: "😊" },
  { id: "framing", label: "Framing", icon: "🖼️" },
  { id: "lighting", label: "Lighting", icon: "💡" },
  { id: "steadiness", label: "Steadiness", icon: "🧘" },
];

// Higher priority wins when several problems happen at once.
export const TIPS = {
  noFace: { icon: "🙈", category: null, priority: 100, text: "We can't see your face. Move into view of your camera." },
  lookAway: { icon: "👀", category: "eyeContact", priority: 90, text: "Look at your camera. To everyone else, that feels like eye contact." },
  tooDark: { icon: "💡", category: "lighting", priority: 80, text: "Your face is in shadow. Add a light in front of you." },
  backlit: { icon: "🪟", category: "lighting", priority: 78, text: "There's bright light behind you. Try facing the window or lamp instead." },
  tooBright: { icon: "🔆", category: "lighting", priority: 70, text: "Your face looks washed out. Soften the light a little." },
  tooClose: { icon: "↔️", category: "framing", priority: 65, text: "You're very close to the camera. Sit back a little." },
  tooFar: { icon: "🔍", category: "framing", priority: 64, text: "You're quite far from the camera. Move a little closer." },
  offCentre: { icon: "🎯", category: "framing", priority: 60, text: "Move towards the centre of the picture." },
  eyesLow: { icon: "📐", category: "framing", priority: 58, text: "Raise your camera to eye level, or sit up a little." },
  eyesHigh: { icon: "📐", category: "framing", priority: 57, text: "You're near the top of the picture. Lower your camera a little." },
  tilted: { icon: "📏", category: "framing", priority: 50, text: "Straighten your head a little." },
  tense: { icon: "😌", category: "expression", priority: 45, text: "Relax your forehead. You look a little tense." },
  fidgeting: { icon: "🧘", category: "steadiness", priority: 40, text: "Try to keep still. Lots of movement is distracting." },
  smile: { icon: "😊", category: "expression", priority: 30, text: "Try a natural smile now and then." },
};

const PRAISE = {
  eyeContact: "Great eye contact. Keep it up!",
  expression: "You look friendly and relaxed.",
  framing: "You're framed really well.",
  lighting: "Your lighting looks great.",
  steadiness: "Nice and steady on camera.",
};

// A lowered brow only counts as tense when you're not smiling: a big smile squints the
// eyes, which MediaPipe also reports as a lowered brow (measured: smile 0.93, brow 0.73).
const isTense = (s, ex) => s.browDown >= ex.browDownTenseAt && s.smile < ex.smileAt;

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

// 1 inside [min, max], falling to 0 at `softness` outside it.
function rangeScore(value, min, max, softness) {
  if (value < min) return clamp(1 - (min - value) / softness, 0, 1);
  if (value > max) return clamp(1 - (value - max) / softness, 0, 1);
  return 1;
}

export class Coach {
  constructor(now, config = CONFIG) {
    this.config = config;
    this.startedAt = now;
    this.samples = [];          // recent frames, newest last
    this.lighting = null;       // latest { t, face, background }
    this.lastFaceAt = now;
    this.lastSmileAt = now;
    this.issueSince = new Map(); // issue id -> when it started (continuously)
    this.cooldownUntil = new Map();
    this.display = { kind: "none" };
    this.lastPraiseAt = now;
    this.totals = { frames: 0, faceFrames: 0, lookingFrames: 0, smilingFrames: 0 };
    this.scoreHistory = [];
    this.tipCounts = new Map();
  }

  /* ---------- input ---------- */

  addFrame(t, metrics) {
    const sample = { t, face: Boolean(metrics) };
    this.totals.frames++;
    if (metrics) {
      Object.assign(sample, {
        looking: isLookingAtCamera(metrics, this.config.eyeContact),
        smile: metrics.smile, browDown: metrics.browDown,
        centreX: metrics.centreX, centreY: metrics.centreY, size: metrics.size,
        eyeLine: metrics.eyeLine, tilt: metrics.tilt,
      });
      this.lastFaceAt = t;
      this.totals.faceFrames++;
      if (sample.looking) this.totals.lookingFrames++;
      if (metrics.smile >= this.config.expression.smileAt) {
        this.lastSmileAt = t;
        this.totals.smilingFrames++;
      }
    }
    this.samples.push(sample);
    const oldest = t - this.config.scoreWindowMs;
    while (this.samples.length && this.samples[0].t < oldest) this.samples.shift();
  }

  addLighting(t, lighting) {
    this.lighting = { t, ...lighting };
  }

  // Call once a second with scores(t), to build the report's timeline and averages.
  recordScore(t, scores) {
    if (scores.overall !== null) this.scoreHistory.push({ t, overall: scores.overall, categories: { ...scores.categories } });
  }

  /* ---------- analysis ---------- */

  recentFaces(t) {
    return this.samples.filter((s) => s.face && t - s.t <= this.config.recentWindowMs);
  }

  freshLighting(t) {
    return this.lighting && t - this.lighting.t <= this.config.lighting.staleAfterMs ? this.lighting : null;
  }

  // Typical head speed in face-widths per second (the median, so one move doesn't count).
  movement(faces) {
    const speeds = [];
    for (let i = 1; i < faces.length; i++) {
      const a = faces[i - 1], b = faces[i];
      const seconds = (b.t - a.t) / 1000;
      if (seconds <= 0) continue;
      speeds.push(Math.hypot(b.centreX - a.centreX, b.centreY - a.centreY) / (b.size || 1) / seconds);
    }
    return speeds.length ? median(speeds) : 0;
  }

  // Problems happening right now (not yet checked for how long they've lasted).
  issues(t) {
    const c = this.config;
    const active = new Set();
    if (t - this.lastFaceAt > c.tips.noFaceAfterMs) active.add("noFace");

    const faces = this.recentFaces(t);
    if (faces.length >= 3) {
      const share = (test) => faces.filter(test).length / faces.length;
      const mid = (key) => median(faces.map((s) => s[key]));

      if (share((s) => !s.looking) >= c.eyeContact.lookingAwayShare) active.add("lookAway");
      const size = mid("size");
      if (size > c.framing.sizeMax) active.add("tooClose");
      else if (size < c.framing.sizeMin) active.add("tooFar");
      const centre = mid("centreX");
      if (centre < c.framing.centreMin || centre > c.framing.centreMax) active.add("offCentre");
      const eyeLine = mid("eyeLine");
      if (eyeLine > c.framing.eyeLineMax) active.add("eyesLow");
      else if (eyeLine < c.framing.eyeLineMin) active.add("eyesHigh");
      if (mid("tilt") > c.framing.maxTilt) active.add("tilted");
      if (share((s) => isTense(s, c.expression)) >= c.expression.tenseShare) active.add("tense");
      if (this.movement(faces) > c.steadiness.maxSpeed) active.add("fidgeting");
      if (t - this.lastSmileAt > c.expression.smileRemindAfterMs) active.add("smile");
    }

    const light = this.freshLighting(t);
    if (light && !active.has("noFace")) {
      if (light.face < c.lighting.min) active.add("tooDark");
      else if (light.face > c.lighting.max) active.add("tooBright");
      if (light.background - light.face > c.lighting.backlightGap) active.add("backlit");
    }
    return active;
  }

  // Scores from 0 to 100 for each category, and overall. null where there's no data yet.
  scores(t) {
    const c = this.config;
    const empty = { overall: null, categories: Object.fromEntries(CATEGORIES.map((k) => [k.id, null])) };
    const faces = this.samples.filter((s) => s.face);
    if (!faces.length) return empty;

    const share = (list, test) => list.filter(test).length / list.length;
    const categories = {};
    categories.eyeContact = share(faces, (s) => s.looking);

    const sinceSmile = t - this.lastSmileAt;
    const remind = c.expression.smileRemindAfterMs;
    const smileFactor = sinceSmile <= remind ? 1 : clamp(1 - (sinceSmile - remind) / remind, 0.3, 1);
    categories.expression = 0.5 * smileFactor + 0.5 * (1 - share(faces, (s) => isTense(s, c.expression)));

    const recent = this.recentFaces(t);
    if (recent.length) {
      const mid = (key) => median(recent.map((s) => s[key]));
      const f = c.framing;
      const tilt = mid("tilt");
      // Scored by the weakest part, so one real problem (e.g. off-centre) shows as a real dip.
      categories.framing = Math.min(
        rangeScore(mid("size"), f.sizeMin, f.sizeMax, 0.15),
        rangeScore(mid("centreX"), f.centreMin, f.centreMax, 0.2),
        rangeScore(mid("eyeLine"), f.eyeLineMin, f.eyeLineMax, 0.2),
        tilt <= f.maxTilt ? 1 : clamp(1 - (tilt - f.maxTilt) / f.maxTilt, 0, 1)
      );
      const speed = recent.length >= 3 ? this.movement(recent) : 0;
      const { calmSpeed, maxSpeed } = c.steadiness;
      categories.steadiness = clamp(1 - (speed - calmSpeed) / (maxSpeed - calmSpeed), 0, 1);
    } else {
      categories.framing = null;
      categories.steadiness = null;
    }

    const light = this.freshLighting(t);
    if (light) {
      const gap = light.background - light.face;
      const backlight = gap <= c.lighting.backlightGap ? 1 : clamp(1 - (gap - c.lighting.backlightGap) / 0.2, 0, 1);
      categories.lighting = Math.min(rangeScore(light.face, c.lighting.min, c.lighting.max, 0.2), backlight);
    } else {
      categories.lighting = null;
    }

    let weighted = 0, weightUsed = 0;
    for (const { id } of CATEGORIES) {
      if (categories[id] === null) continue;
      weighted += categories[id] * c.weights[id];
      weightUsed += c.weights[id];
    }
    for (const id of Object.keys(categories)) {
      if (categories[id] !== null) categories[id] = Math.round(categories[id] * 100);
    }
    return { overall: weightUsed ? Math.round((weighted / weightUsed) * 100) : null, categories };
  }

  /* ---------- the one tip on screen ---------- */

  // Call a few times a second. Returns what to show: a tip, "better", praise, or nothing.
  currentTip(t) {
    const tips = this.config.tips;
    const active = this.issues(t);
    for (const id of [...this.issueSince.keys()]) if (!active.has(id)) this.issueSince.delete(id);
    for (const id of active) if (!this.issueSince.has(id)) this.issueSince.set(id, t);

    // Problems that have lasted long enough and aren't resting, most important first.
    // Losing your face is always reported. (A function, because resting a tip below changes the answer.)
    const ready = () => [...active].filter((id) => id === "noFace" || (
      t - this.issueSince.get(id) >= tips.sustainMs && !(t < (this.cooldownUntil.get(id) || 0))
    )).sort((a, b) => TIPS[b].priority - TIPS[a].priority);

    const d = this.display;
    // Losing the face interrupts anything else.
    if (active.has("noFace") && !(d.kind === "tip" && d.id === "noFace")) return this.showTip("noFace", t);

    if (d.kind === "tip") {
      // A much more important problem replaces a minor tip straight away.
      const urgent = ready()[0];
      if (urgent && urgent !== d.id && TIPS[urgent].priority - TIPS[d.id].priority >= tips.interruptGap) {
        return this.showTip(urgent, t);
      }
      if (!active.has(d.id)) {
        this.cooldownUntil.set(d.id, t + tips.cooldownMs);
        this.display = { kind: "better", until: t + tips.betterShowMs };
      } else if (t - d.shownAt >= tips.maxShowMs && d.id !== "noFace") {
        // Not being fixed: rest it rather than nag.
        this.cooldownUntil.set(d.id, t + tips.longCooldownMs);
        this.display = { kind: "none" };
      } else {
        return this.describe();
      }
    }
    if ((this.display.kind === "better" || this.display.kind === "praise") && t < this.display.until) {
      return this.describe();
    }

    const next = ready()[0];
    if (next) return this.showTip(next, t);

    if (!active.size && t - this.lastPraiseAt >= tips.praiseEveryMs) {
      const { categories } = this.scores(t);
      const best = CATEGORIES.map((c) => c.id).filter((id) => categories[id] !== null)
        .sort((a, b) => categories[b] - categories[a])[0];
      if (best) {
        this.lastPraiseAt = t;
        this.display = { kind: "praise", text: PRAISE[best], until: t + tips.praiseShowMs };
        return this.describe();
      }
    }
    // Nothing to say right now. Only claim "looking good" if nothing is actually wrong.
    this.display = { kind: "none", resting: active.size > 0 };
    return this.describe();
  }

  showTip(id, t) {
    this.display = { kind: "tip", id, shownAt: t };
    this.tipCounts.set(id, (this.tipCounts.get(id) || 0) + 1);
    return this.describe();
  }

  describe() {
    const d = this.display;
    if (d.kind === "tip") return { kind: "tip", id: d.id, icon: TIPS[d.id].icon, text: TIPS[d.id].text };
    if (d.kind === "better") return { kind: "better", icon: "✅", text: "That's better!" };
    if (d.kind === "praise") return { kind: "praise", icon: "✨", text: d.text };
    if (d.resting) return { kind: "none", icon: "💬", text: "Keep going. We'll check in again soon." };
    return { kind: "none", icon: "👍", text: "Looking good. Keep going!" };
  }

  /* ---------- results ---------- */

  // For the quick camera check: each category's score and its biggest problem right now.
  checklist(t) {
    const { overall, categories } = this.scores(t);
    const active = this.issues(t);
    const items = CATEGORIES.map((cat) => {
      const problem = [...active].filter((id) => TIPS[id].category === cat.id)
        .sort((a, b) => TIPS[b].priority - TIPS[a].priority)[0];
      const score = categories[cat.id];
      const status = score === null ? "unknown" : problem || score < 60 ? "fix" : score < 80 ? "ok" : "good";
      return { ...cat, score, status, advice: problem ? TIPS[problem].text : null };
    });
    return { overall, faceSeen: this.totals.faceFrames > 0, items };
  }

  summary(t) {
    const { faceFrames, lookingFrames, smilingFrames, frames } = this.totals;
    const share = (n, of) => (of ? Math.round((n / of) * 100) : 0);
    const mean = (values) => (values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null);
    const history = this.scoreHistory;

    const categories = {};
    for (const { id } of CATEGORIES) {
      categories[id] = mean(history.map((h) => h.categories[id]).filter((v) => v !== null));
    }

    // Score over time, averaged into buckets so even a long meeting stays a readable chart.
    const durationMs = t - this.startedAt;
    const bucketSeconds = Math.max(5, Math.ceil(durationMs / 1000 / 200));
    const buckets = new Map();
    for (const h of history) {
      const bucket = Math.floor((h.t - this.startedAt) / 1000 / bucketSeconds);
      if (!buckets.has(bucket)) buckets.set(bucket, []);
      buckets.get(bucket).push(h.overall);
    }
    const timeline = [...buckets.entries()].sort((a, b) => a[0] - b[0])
      .map(([bucket, scores]) => ({ s: bucket * bucketSeconds, score: mean(scores) }));

    const tips = [...this.tipCounts.entries()].filter(([id]) => id !== "noFace")
      .sort((a, b) => b[1] - a[1])
      .map(([id, count]) => ({ id, text: TIPS[id].text, icon: TIPS[id].icon, count }));

    return {
      durationMs,
      averageScore: mean(history.map((h) => h.overall)),
      categories,
      timeline,
      eyeContactShare: share(lookingFrames, faceFrames),
      smilingShare: share(smilingFrames, faceFrames),
      inViewShare: share(faceFrames, frames),
      tips,
      mostCommonTip: tips.length ? tips[0].text : null,
    };
  }
}
