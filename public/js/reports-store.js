// Saved reports, kept in this browser only (newest first, last 10).
const KEY = "cameraCoach.reports";
const KEEP = 10;

export function listReports() {
  try {
    const reports = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(reports) ? reports : [];
  } catch (error) {
    return [];
  }
}

// Add a report, or replace the saved copy of the same session.
export function saveReport(report) {
  const reports = [report, ...listReports().filter((r) => r.id !== report.id)]
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, KEEP);
  try {
    localStorage.setItem(KEY, JSON.stringify(reports));
  } catch (error) {
    // storage blocked or full: the report is still shown, just not kept
  }
}

export function getReport(id) {
  return listReports().find((r) => r.id === id) || null;
}

// A session that was still running when the app closed (for example, the meeting ended).
// Marks it finished and returns it, so the app can show it straight away.
export function takeUnfinishedReport() {
  const unfinished = listReports().find((r) => !r.finished);
  if (!unfinished) return null;
  const finished = { ...unfinished, finished: true };
  saveReport(finished);
  return finished;
}
