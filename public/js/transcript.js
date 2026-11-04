// The meeting transcript: everyone's lines, merged in time order and labelled with who spoke.
// Pure logic, so it's unit-tested.

// Speech models sometimes output sound tags like "[Music]" or "(inaudible)", or nothing useful.
export function cleanText(text) {
  const cleaned = String(text || "")
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /[a-z0-9]/i.test(cleaned) ? cleaned : "";
}

// "00:01:23" from milliseconds
export function formatClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const pad = (n) => String(n).padStart(2, "0");
  return pad(Math.floor(total / 3600)) + ":" + pad(Math.floor(total / 60) % 60) + ":" + pad(total % 60);
}

export class Transcript {
  constructor() {
    this.byId = new Map();
  }

  // Add or update a line: { id, speaker, text, at, final }. A final line with no text removes
  // the line (a phrase that turned out to be someone else's voice, or nothing at all).
  upsert(line) {
    if (!line || !line.id) return false;
    const existing = this.byId.get(line.id);
    if (existing && existing.final && !line.final) return false; // a late live update
    if (!line.text) return this.byId.delete(line.id);
    this.byId.set(line.id, { ...existing, ...line, at: existing ? existing.at : line.at });
    return true;
  }

  lines() {
    return [...this.byId.values()].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  }

  finalLines() {
    return this.lines().filter((line) => line.final);
  }

  turns(gapMs) {
    return groupTurns(this.finalLines(), gapMs);
  }
}

// Consecutive lines from the same person (in time order), joined into one turn.
export function groupTurns(lines, gapMs = 30000) {
  const turns = [];
  for (const line of lines) {
    const last = turns[turns.length - 1];
    if (last && last.speaker === line.speaker && line.at - last.lastAt <= gapMs) {
      last.text += " " + line.text;
      last.lastAt = line.at;
    } else {
      turns.push({ speaker: line.speaker, at: line.at, lastAt: line.at, text: line.text });
    }
  }
  return turns;
}

// Where transcript times count from: the start of your session, or the first line if others
// were already being transcribed when you joined (so their lines don't all read 00:00:00).
// `lines` (or turns) are in time order.
export function transcriptStart(lines, startAt) {
  return lines.length ? Math.min(startAt, lines[0].at) : startAt;
}

// "[00:01:23] Oliver: text", one line each, with times counted from `startAt`.
export function transcriptToText(lines, startAt) {
  const start = transcriptStart(lines, startAt);
  return lines.map((line) => "[" + formatClock(line.at - start) + "] " + line.speaker + ": " + line.text).join("\n");
}
