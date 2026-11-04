// Everything that changes what's on screen. No decisions are made here.
import { CATEGORIES } from "./coach.js";
import { CHART, chartPoints, chartSvg, formatClock, formatDate, formatDuration, verdict } from "./report.js";
import { formatClock as clockSince, groupTurns, transcriptStart } from "./transcript.js";

const $ = (id) => document.getElementById(id);
const RING_LENGTH = 2 * Math.PI * 52;

export const level = (score) =>
  score === null ? "none" : score >= 80 ? "good" : score >= 60 ? "ok" : "poor";

export function showScreen(name) {
  for (const screen of document.querySelectorAll(".screen")) screen.hidden = screen.dataset.screen !== name;
}

export function setLoading(text) {
  $("loading-text").textContent = text;
}

export function setGreeting(name) {
  $("greeting").textContent = name ? "Hi " + name + ". Look your best on camera" : "Look your best on camera";
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === "LIGHT" ? "LIGHT" : "DARK";
}

export function showPreview(visible) {
  $("preview").hidden = !visible;
}

export function showDebug(visible) {
  $("debug").hidden = !visible;
}

// One row per category (icon, name, bar, score) in the list with this id.
export function buildCategories(listId = "categories") {
  $(listId).innerHTML = CATEGORIES.map((c) =>
    '<li data-id="' + c.id + '" data-level="none">' +
      '<span aria-hidden="true">' + c.icon + "</span>" +
      "<span>" + c.label + "</span>" +
      '<span class="bar"><span class="bar-fill"></span></span>' +
      '<span class="cat-value">–</span>' +
    "</li>"
  ).join("");
}

function fillCategories(listId, categories) {
  for (const row of $(listId).children) {
    const score = categories[row.dataset.id];
    row.dataset.level = level(score);
    row.querySelector(".bar-fill").style.width = (score || 0) + "%";
    row.querySelector(".cat-value").textContent = score === null ? "–" : score;
  }
}

export function renderScores({ overall, categories }) {
  const ring = document.querySelector(".ring");
  ring.dataset.level = level(overall);
  $("ring-value").style.strokeDashoffset = RING_LENGTH * (1 - (overall || 0) / 100);
  $("score").textContent = overall === null ? "–" : overall;
  fillCategories("categories", categories);
}

// Only touches the DOM when the tip changes, so screen readers announce each tip once.
export function renderTip(tip) {
  const box = $("tip");
  if (box.dataset.kind === tip.kind && $("tip-text").textContent === tip.text) return;
  box.dataset.kind = tip.kind;
  $("tip-icon").textContent = tip.icon;
  $("tip-text").textContent = tip.text;
}

export function renderCheckProgress(fraction, secondsLeft) {
  $("check-progress").style.width = Math.round(fraction * 100) + "%";
  $("check-seconds").textContent = secondsLeft + (secondsLeft === 1 ? " second left" : " seconds left");
}

const MARKS = { good: "✅", ok: "🟡", fix: "⚠️", unknown: "❔" };

export function renderChecklist({ overall, faceSeen, items }) {
  const fixes = items.filter((item) => item.status === "fix").length;
  $("check-headline").textContent = !faceSeen
    ? "We couldn't see your face. Check your camera is pointing at you and try again."
    : fixes === 0 ? "Score " + overall + ". You're ready to go!"
    : "Score " + overall + ". " + (fixes === 1 ? "One quick fix" : fixes + " quick fixes") + " will help:";

  const list = $("checklist");
  list.replaceChildren(...items.map((item) => {
    const li = document.createElement("li");
    const mark = document.createElement("span");
    mark.className = "mark";
    mark.textContent = MARKS[item.status];
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = item.icon + " " + item.label;
    const value = document.createElement("span");
    value.className = "value";
    value.textContent = item.score === null ? "–" : item.score;
    li.append(mark, name, value);
    if (item.advice) {
      const advice = document.createElement("span");
      advice.className = "advice";
      advice.textContent = item.advice;
      li.append(advice);
    }
    return li;
  }));
}

/* ---------- report ---------- */

const PLACES = { meeting: "in a Webex meeting", space: "in a Webex space", browser: "in the browser" };

function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

export function renderReport(report, { justEnded = false } = {}) {
  $("report-notice").hidden = !justEnded;
  $("report-when").textContent = formatDate(report.startedAt) + " · " + formatDuration(report.durationMs) +
    " · " + (PLACES[report.place] || PLACES.browser);
  $("report-title").textContent = report.meetingTitle || "Coaching session";
  $("report-score").textContent = report.averageScore ?? "–";
  $("report-verdict").textContent = verdict(report.averageScore);

  $("report-chart").innerHTML = chartSvg(report.timeline);
  addChartHover($("report-chart"), report.timeline);

  buildCategories("report-categories");
  fillCategories("report-categories", report.categories);

  const stats = [
    [report.eyeContactShare + "%", "Looking at the camera"],
    [report.smilingShare + "%", "Smiling"],
    [report.inViewShare + "%", "In view"],
  ];
  $("report-stats").replaceChildren(...stats.map(([value, label]) => {
    const box = element("div", "stat");
    box.append(element("span", "stat-value", value), element("span", "stat-label", label));
    return box;
  }));

  const tips = report.tips.slice(0, 3);
  $("report-tips-section").hidden = tips.length === 0;
  $("report-tips").replaceChildren(...tips.map((tip) => {
    const li = element("li");
    li.append(element("span", "", tip.icon), element("span", "", tip.text),
      element("span", "count", tip.count + (tip.count === 1 ? " time" : " times")));
    return li;
  }));

  const transcript = report.transcript || [];
  $("report-transcript-section").hidden = transcript.length === 0;
  $("export-transcript").hidden = transcript.length === 0;
  renderTurns("report-transcript", groupTurns(transcript), report.startedAt);

  const table = $("report-table");
  table.replaceChildren();
  const head = table.insertRow();
  head.append(element("th", "", "Time"), element("th", "", "Score"));
  for (const point of report.timeline) {
    const row = table.insertRow();
    row.append(element("td", "", formatClock(point.s)), element("td", "", point.score));
  }
  $("export-status").textContent = "";
  $("copy-box").hidden = true;
}

/* ---------- captions ---------- */

// The transcript as speaker turns: who spoke, when (counted from `startAt`), and what they said.
function renderTurns(listId, turns, startAt) {
  const start = transcriptStart(turns, startAt);
  $(listId).replaceChildren(...turns.map((turn) => {
    const li = element("li");
    const who = element("span", "who", turn.speaker);
    const when = element("time", "", clockSince(turn.at - start));
    li.append(who, when, element("p", "", turn.text));
    return li;
  }));
}

let shownTranscript = "";

// view: from Captions.view(), or null when captions are off.
export function renderCaptions(view, startedAt) {
  $("captions").hidden = !view;
  if (!view) return;
  $("captions-status").textContent = view.detail;
  // Microphone level on a decibel scale: -60 dB (silence) to 0 dB (as loud as it gets).
  const db = 20 * Math.log10(view.level || 1e-6);
  $("mic-level").style.width = Math.max(0, Math.min(100, ((db + 60) / 60) * 100)) + "%";

  $("caption-lines").replaceChildren(...view.lines.map((line) => {
    const li = element("li");
    li.dataset.final = String(line.final);
    li.append(element("span", "who", line.speaker), element("span", "said", line.text));
    return li;
  }));

  // The full transcript only changes when a line is finished, so only rebuild it then.
  const signature = view.count + ":" + (view.turns.length ? view.turns[view.turns.length - 1].text : "");
  if (signature === shownTranscript) return;
  shownTranscript = signature;
  $("transcript-summary").textContent = "Meeting transcript (" + view.count + (view.count === 1 ? " line)" : " lines)");
  renderTurns("transcript-turns", view.turns, startedAt);
}

// Hovering the chart shows a crosshair and the score at that moment.
function addChartHover(card, timeline) {
  const svg = card.querySelector("svg");
  const points = chartPoints(timeline);
  if (!svg || points.length < 2) return;

  const cross = document.createElementNS("http://www.w3.org/2000/svg", "line");
  cross.setAttribute("class", "chart-cross");
  cross.setAttribute("y1", CHART.top);
  cross.setAttribute("y2", CHART.height - CHART.bottom);
  cross.style.display = "none";
  svg.insertBefore(cross, svg.querySelector(".chart-area"));
  const tip = element("div", "chart-tip");
  tip.hidden = true;
  card.append(tip);

  svg.addEventListener("pointermove", (event) => {
    const box = svg.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * CHART.width;
    const nearest = points.reduce((best, p) => (Math.abs(p.x - x) < Math.abs(best.x - x) ? p : best));
    cross.setAttribute("x1", nearest.x);
    cross.setAttribute("x2", nearest.x);
    cross.style.display = "";
    tip.hidden = false;
    tip.textContent = formatClock(nearest.s) + " · score " + nearest.score;
    const left = (nearest.x / CHART.width) * box.width + (box.left - card.getBoundingClientRect().left);
    tip.style.left = Math.min(Math.max(left, 50), card.clientWidth - 50) + "px";
  });
  svg.addEventListener("pointerleave", () => {
    cross.style.display = "none";
    tip.hidden = true;
  });
}

export function renderPastReports(reports, onOpen) {
  const list = $("report-list");
  $("past-reports").hidden = reports.length === 0;
  list.replaceChildren(...reports.slice(0, 5).map((report) => {
    const li = element("li");
    const button = element("button");
    button.type = "button";
    const label = element("span", "", (report.meetingTitle ? report.meetingTitle + " · " : "") +
      formatDate(report.startedAt) + " · " + formatDuration(report.durationMs));
    const pill = element("span", "pill", report.averageScore ?? "–");
    pill.dataset.level = level(report.averageScore ?? null);
    button.append(label, pill);
    button.addEventListener("click", () => onOpen(report));
    li.append(button);
    return li;
  }));
}

export function setExportStatus(text) {
  $("export-status").textContent = text;
}

export function showError({ title, text }) {
  $("error-title").textContent = title;
  $("error-text").textContent = text;
  showScreen("error");
}

export function renderDebug(lines) {
  $("debug").textContent = lines.join("\n");
}
