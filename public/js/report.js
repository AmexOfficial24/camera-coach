// The session report: built from the coach's summary, drawn as a chart, and exported as
// a standalone web page, a CSV file or plain text. Pure functions, so they're unit-tested.
import { CATEGORIES } from "./coach.js";

export function buildReport(summary, meta) {
  return {
    id: "r_" + meta.startedAt,
    startedAt: meta.startedAt,              // ms since 1970
    endedAt: meta.startedAt + summary.durationMs,
    finished: Boolean(meta.finished),
    place: meta.place || "browser",         // "meeting", "space" or "browser"
    meetingTitle: meta.meetingTitle || null,
    ...summary,
  };
}

export function verdict(score) {
  if (score === null || score === undefined) return "Not enough data";
  if (score >= 85) return "Excellent camera presence";
  if (score >= 70) return "Good camera presence";
  if (score >= 50) return "Some room to improve";
  return "Plenty of quick wins";
}

export function formatDuration(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return seconds + "s";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + "m " + (seconds % 60) + "s";
  return Math.floor(minutes / 60) + "h " + (minutes % 60) + "m";
}

// "4:05" from seconds
export function formatClock(seconds) {
  return Math.floor(seconds / 60) + ":" + String(Math.round(seconds % 60)).padStart(2, "0");
}

export function formatDate(ms) {
  return new Date(ms).toLocaleString(undefined, {
    weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

const escapeHtml = (text) => String(text)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* ---------- chart ---------- */

export const CHART = { width: 320, height: 150, left: 30, right: 34, top: 12, bottom: 24 };

// Where each timeline point sits on the chart, in SVG units.
export function chartPoints(timeline) {
  const { width, height, left, right, top, bottom } = CHART;
  const last = timeline.length ? timeline[timeline.length - 1].s : 0;
  const span = last || 1;
  return timeline.map((p) => ({
    ...p,
    x: left + (p.s / span) * (width - left - right),
    y: top + (1 - p.score / 100) * (height - top - bottom),
  }));
}

// One line of camera presence over time: 0–100 axis, hairline grid, the latest value labelled.
// Colours come from CSS classes, so the same SVG works in the app (light or dark) and in exports.
export function chartSvg(timeline) {
  const { width, height, left, right, top, bottom } = CHART;
  const points = chartPoints(timeline);
  if (points.length < 2) {
    return '<svg class="chart" viewBox="0 0 ' + width + " " + height + '" role="img" aria-label="Not enough data for a chart yet">' +
      '<text class="chart-axis" x="' + width / 2 + '" y="' + height / 2 + '" text-anchor="middle">Keep coaching for a few more seconds to see a chart</text></svg>';
  }
  const y = (v) => top + (1 - v / 100) * (height - top - bottom);
  const baseline = y(0);
  const line = "M" + points.map((p) => p.x.toFixed(1) + "," + p.y.toFixed(1)).join("L");
  const area = line + "L" + points[points.length - 1].x.toFixed(1) + "," + baseline + "L" + points[0].x.toFixed(1) + "," + baseline + "Z";
  const end = points[points.length - 1];
  const first = timeline[0], last = timeline[timeline.length - 1];

  const grid = [0, 50, 100].map((v) =>
    '<line class="chart-grid" x1="' + left + '" x2="' + (width - right) + '" y1="' + y(v) + '" y2="' + y(v) + '" />' +
    '<text class="chart-axis" x="' + (left - 6) + '" y="' + (y(v) + 3.5) + '" text-anchor="end">' + v + "</text>"
  ).join("");
  const xLabels =
    '<text class="chart-axis" x="' + left + '" y="' + (height - 6) + '">' + formatClock(first.s) + "</text>" +
    '<text class="chart-axis" x="' + (width - right) + '" y="' + (height - 6) + '" text-anchor="end">' + formatClock(last.s) + "</text>";

  return '<svg class="chart" viewBox="0 0 ' + width + " " + height + '" role="img" aria-label="Camera presence score over ' +
    formatClock(last.s) + ", ending at " + last.score + '">' +
    grid + xLabels +
    '<path class="chart-area" d="' + area + '" />' +
    '<path class="chart-line" d="' + line + '" />' +
    '<circle class="chart-dot" cx="' + end.x.toFixed(1) + '" cy="' + end.y.toFixed(1) + '" r="4" />' +
    '<text class="chart-value" x="' + (end.x + 8).toFixed(1) + '" y="' + (end.y + 4).toFixed(1) + '">' + end.score + "</text>" +
    "</svg>";
}

/* ---------- exports ---------- */

const categoryLine = (report) => CATEGORIES
  .map((c) => c.label + " " + (report.categories[c.id] === null ? "–" : report.categories[c.id]))
  .join(" · ");

export function reportToText(report) {
  const lines = [
    "Camera Coach report",
    formatDate(report.startedAt) + " · " + formatDuration(report.durationMs) +
      (report.meetingTitle ? " · " + report.meetingTitle : ""),
    "Average score: " + (report.averageScore ?? "–") + " (" + verdict(report.averageScore) + ")",
    categoryLine(report),
    "Looking at the camera: " + report.eyeContactShare + "% · Smiling: " + report.smilingShare + "% · In view: " + report.inViewShare + "%",
  ];
  if (report.tips.length) {
    lines.push("Work on:");
    for (const tip of report.tips.slice(0, 3)) lines.push("- " + tip.text + " (" + tip.count + (tip.count === 1 ? " time)" : " times)"));
  }
  return lines.join("\n");
}

const csvCell = (value) => {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
};

export function reportToCsv(report) {
  const rows = [
    ["section", "name", "value"],
    ["summary", "started", new Date(report.startedAt).toISOString()],
    ["summary", "duration_seconds", Math.round(report.durationMs / 1000)],
    ["summary", "place", report.place],
    ["summary", "meeting_title", report.meetingTitle],
    ["summary", "average_score", report.averageScore],
    ["summary", "looking_at_camera_percent", report.eyeContactShare],
    ["summary", "smiling_percent", report.smilingShare],
    ["summary", "in_view_percent", report.inViewShare],
    ...CATEGORIES.map((c) => ["category", c.label, report.categories[c.id]]),
    ...report.tips.map((t) => ["tip", t.text, t.count]),
    ...report.timeline.map((p) => ["timeline_seconds", p.s, p.score]),
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

// A complete web page that opens anywhere and prints cleanly to PDF. No scripts, no external files.
export function reportToHtml(report) {
  const category = (c) => {
    const score = report.categories[c.id];
    return "<tr><td>" + c.icon + " " + c.label + '</td><td class="barcell"><span class="bar"><span style="width:' +
      (score || 0) + '%"></span></span></td><td class="num">' + (score === null ? "–" : score) + "</td></tr>";
  };
  const tips = report.tips.slice(0, 3).map((t) =>
    "<li>" + t.icon + " " + escapeHtml(t.text) + ' <span class="muted">(' + t.count + (t.count === 1 ? " time" : " times") + ")</span></li>"
  ).join("");

  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    "<title>Camera Coach report – " + escapeHtml(formatDate(report.startedAt)) + "</title><style>" +
    "body{margin:0;background:#f4f6f8;color:#15191e;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;line-height:1.45}" +
    ".page{max-width:640px;margin:0 auto;padding:28px 20px}h1{margin:0;font-size:1.4rem}h2{font-size:1rem;margin:22px 0 8px}" +
    ".muted{color:#5f6b77}.card{background:#fff;border:1px solid #dde2e7;border-radius:12px;padding:16px}" +
    ".score{font-size:3rem;font-weight:700;line-height:1}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}" +
    ".stat b{display:block;font-size:1.4rem}table{width:100%;border-collapse:collapse}td{padding:6px 4px;border-bottom:1px solid #eef1f4}" +
    ".num{text-align:right;width:40px;font-variant-numeric:tabular-nums}.barcell{width:55%}" +
    ".bar{display:block;height:8px;border-radius:99px;background:#eef1f4;overflow:hidden}" +
    ".bar span{display:block;height:100%;background:#0077c8;border-radius:99px}ul{padding-left:18px}" +
    ".chart{width:100%;height:auto}.chart-grid{stroke:#eef1f4;stroke-width:1}.chart-axis{fill:#5f6b77;font-size:9px}" +
    ".chart-area{fill:#0077c8;opacity:.1}.chart-line{fill:none;stroke:#0077c8;stroke-width:2;stroke-linejoin:round;stroke-linecap:round}" +
    ".chart-dot{fill:#0077c8;stroke:#fff;stroke-width:2}.chart-value{fill:#15191e;font-size:10px;font-weight:700}" +
    "@media print{body{background:#fff}.card{border-color:#ccc}}" +
    '</style></head><body><main class="page">' +
    '<p class="muted">Camera Coach report</p>' +
    "<h1>" + escapeHtml(report.meetingTitle || "Coaching session") + "</h1>" +
    '<p class="muted">' + escapeHtml(formatDate(report.startedAt)) + " · " + formatDuration(report.durationMs) + "</p>" +
    '<div class="card"><div class="score">' + (report.averageScore ?? "–") + '</div><div class="muted">' +
      verdict(report.averageScore) + " (average score out of 100)</div></div>" +
    "<h2>Camera presence over time</h2><div class=\"card\">" + chartSvg(report.timeline) + "</div>" +
    "<h2>By area</h2><div class=\"card\"><table>" + CATEGORIES.map(category).join("") + "</table></div>" +
    '<h2>Highlights</h2><div class="stats">' +
      '<div class="card stat"><b>' + report.eyeContactShare + '%</b><span class="muted">Looking at the camera</span></div>' +
      '<div class="card stat"><b>' + report.smilingShare + '%</b><span class="muted">Smiling</span></div>' +
      '<div class="card stat"><b>' + report.inViewShare + '%</b><span class="muted">In view</span></div></div>' +
    (tips ? "<h2>What to work on</h2><div class=\"card\"><ul>" + tips + "</ul></div>" : "") +
    '<p class="muted" style="margin-top:24px;font-size:.8rem">Made by Camera Coach. Your video was analysed on your own computer and never recorded or uploaded.</p>' +
    "</main></body></html>";
}

export function reportFileName(report, extension) {
  const d = new Date(report.startedAt);
  const pad = (n) => String(n).padStart(2, "0");
  return "camera-coach-report-" + d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
    "-" + pad(d.getHours()) + pad(d.getMinutes()) + "." + extension;
}
