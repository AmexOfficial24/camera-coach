# Camera Coach

A Webex Embedded App that coaches you on how you come across on camera. It watches five
things and gives you one calm tip at a time:

| Area | What it checks |
|---|---|
| 👀 Eye contact | Head turned or tilted away, eyes looking sideways or down at notes |
| 😊 Expression | A smile now and then; a furrowed brow (that isn't just a smile) |
| 🖼️ Framing | Too close or far, off-centre, camera too low or high, head tilted |
| 💡 Lighting | Face in shadow, washed out, or a bright window behind you |
| 🧘 Steadiness | Constant movement (a single move to a new spot doesn't count) |

At the end of a session you get a **report**: an average score, a chart over time, each
area's score, highlights and what to work on. Export it as a **web page** (prints to PDF),
as **CSV** data, or **copy a summary** to paste into a Webex message.

**Privacy:** face tracking runs entirely in your browser using
[MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker).
Video never leaves your computer, nothing is recorded, and only you see your tips. Reports
are stored only in your browser.

## Run it

```sh
npm start
```

Open `http://localhost:3001`. There are no dependencies to install.

To use it inside Webex, give it a public HTTPS address (`cloudflared tunnel --url http://localhost:3001`)
and register it as an Embedded App in the [Webex Developer Portal](https://developer.webex.com),
with the tunnel URL as the **Start page URL** and its host as the **Valid domain**.

## How it's built

| File | Job |
|---|---|
| `public/app.js` | Wires everything together and runs the frame loop |
| `public/js/config.js` | Every threshold in one place, to tune the coach |
| `public/js/analysis.js` | Turns MediaPipe's output into measurements (head angles, smile, gaze, framing, lighting) |
| `public/js/coach.js` | Scores, and which tip to show: problems must last 2 seconds, fixed tips get "That's better!", ignored tips are rested instead of nagging |
| `public/js/report.js` | The report, its chart, and the web page / CSV / text exports |
| `public/js/reports-store.js` | Saves reports in the browser. Sessions autosave every 10 seconds, so a report survives the meeting ending |
| `public/js/tracker.js`, `camera.js`, `webex.js`, `settings.js`, `ui.js` | Face tracking, camera, Webex, settings, screen |
| `public/camera-test.html` | The original camera test page, kept for troubleshooting |

## Testing options

Open **Settings** (⚙️) and switch on **Show face mesh** and **Show measurements**, or add
`?debug=1` to the address. They're off by default, so users only see the coaching.

## Tests

```sh
npm test
```

Unit tests for the analysis, the coach's decisions and the report use Node's built-in test
runner, so there's nothing to install.
