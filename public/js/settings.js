// User settings, remembered in this browser. ?debug=1 in the address turns on the testing views.
const KEY = "cameraCoach.settings";
// captions: live captions and the meeting transcript (off until you choose them: they use the mic)
// name: your name on captions when the app isn't inside Webex
const DEFAULTS = { showVideo: true, showMesh: false, showNumbers: false, captions: false, name: "" };

export function loadSettings() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY)) || {};
  } catch (error) {
    // storage blocked or empty: use the defaults
  }
  const settings = { ...DEFAULTS, ...saved };
  if (new URLSearchParams(location.search).has("debug")) {
    settings.showMesh = true;
    settings.showNumbers = true;
  }
  return settings;
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch (error) {
    // storage blocked: the setting lasts until the page closes
  }
}
