import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReport, chartPoints, chartSvg, formatClock, formatDuration, reportToCsv, reportToHtml, reportToText, verdict } from "../public/js/report.js";

const summary = {
  durationMs: 754000,
  averageScore: 84,
  categories: { eyeContact: 78, expression: 90, framing: 85, lighting: null, steadiness: 88 },
  timeline: [{ s: 0, score: 70 }, { s: 375, score: 90 }, { s: 750, score: 80 }],
  eyeContactShare: 72, smilingShare: 18, inViewShare: 98,
  tips: [{ id: "lookAway", icon: "👀", text: "Look at your camera.", count: 5 }, { id: "smile", icon: "😊", text: "Try a smile, \"now\" & then.", count: 1 }],
  mostCommonTip: "Look at your camera.",
};
const report = buildReport(summary, { startedAt: Date.UTC(2026, 10, 3, 13, 20), place: "meeting", meetingTitle: "Weekly <sync>", finished: true });

test("reports get a stable id and an end time", () => {
  assert.equal(report.id, "r_" + Date.UTC(2026, 10, 3, 13, 20));
  assert.equal(report.endedAt - report.startedAt, 754000);
  assert.equal(report.finished, true);
});

test("times and verdicts read naturally", () => {
  assert.equal(formatDuration(45000), "45s");
  assert.equal(formatDuration(754000), "12m 34s");
  assert.equal(formatDuration(3720000), "1h 2m");
  assert.equal(formatClock(245), "4:05");
  assert.equal(verdict(90), "Excellent camera presence");
  assert.equal(verdict(null), "Not enough data");
});

test("the chart puts 100 at the top, 0 at the bottom, start left and end right", () => {
  const [first, middle, last] = chartPoints(summary.timeline);
  assert.ok(first.x < middle.x && middle.x < last.x);
  assert.ok(middle.y < first.y, "90 is drawn higher than 70");
  const svg = chartSvg(summary.timeline);
  assert.match(svg, /class="chart-line"/);
  assert.match(svg, />12:30</, "x axis ends at the session length");
  assert.match(chartSvg([{ s: 0, score: 50 }]), /Keep coaching/);
});

test("the text summary lists the score, areas and top tips", () => {
  const text = reportToText(report);
  assert.match(text, /Average score: 84 \(Good camera presence\)/);
  assert.match(text, /Lighting –/);
  assert.match(text, /Look at your camera\. \(5 times\)/);
});

test("the CSV has a header, quotes awkward text and includes the timeline", () => {
  const lines = reportToCsv(report).trim().split("\n");
  assert.equal(lines[0], "section,name,value");
  assert.ok(lines.includes('tip,"Try a smile, ""now"" & then.",1'));
  assert.ok(lines.includes("timeline_seconds,375,90"));
  assert.ok(lines.includes("category,Lighting,"), "missing values are left empty");
});

test("the exported page is self-contained and escapes the meeting title", () => {
  const html = reportToHtml(report);
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /Weekly &lt;sync&gt;/);
  assert.doesNotMatch(html, /<script/);
  assert.doesNotMatch(html, /src="http/);
});
