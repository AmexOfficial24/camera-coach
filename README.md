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

**Live captions and a meeting transcript** (optional, tick the box on the start screen):
what you say is turned into text on your own computer, and the text is shared with everyone
in the same meeting who has captions on. Each person's app only listens to their own
microphone, so every line is labelled with who said it:

```
[00:00:00] Alex: Good morning, everyone.
[00:02:12] Sam: Thanks, Alex.
```

The transcript goes into the report and every export, and downloads as a text file. If your
face is being tracked, a phrase only counts when your lips moved, so other voices in the room
aren't put under your name.

**Privacy:** face tracking runs entirely in your browser using
[MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker).
Video never leaves your computer, nothing is recorded, and only you see your tips. Reports
are stored only in your browser. With captions on, speech is turned into text in your browser
too (the [Moonshine tiny](https://huggingface.co/onnx-community/moonshine-tiny-ONNX) model, a
28 MB download the first time). Audio never leaves your computer: only the text is sent, to
this app's server, which passes it to others in the same meeting and keeps it in memory only.

## Run it

```sh
npm install
npm start
```

Open `http://localhost:3001`. The only dependency is [`ws`](https://github.com/websockets/ws),
for sharing caption text.

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
| `public/js/captions.js` | Live captions: microphone → phrases → text → shared with the meeting |
| `public/js/mic.js`, `mic-worklet.js`, `audio-utils.js` | The microphone, as 16 kHz audio |
| `public/js/segmenter.js` | Splits the audio into phrases: starts when you speak, ends after a short pause |
| `public/js/speech-engine.js`, `speech-worker.js` | Runs the speech model in the background, so face tracking stays smooth |
| `public/js/transcript.js`, `transcript-link.js` | Merges everyone's lines in time order, and the connection to the server |
| `server.js`, `lib/transcript-rooms.js` | Serves the app, and passes caption text between people in the same meeting |
| `public/camera-test.html` | The original camera test page, kept for troubleshooting |
| `public/speech-test.html` | Checks the microphone and the speech model on their own (add `?gpu` to try the graphics card) |

## Testing options

Open **Settings** (⚙️) and switch on **Show face mesh** and **Show measurements**, or add
`?debug=1` to the address. They're off by default, so users only see the coaching.

## Tests

```sh
npm test
```

Unit tests for the analysis, the coach's decisions, the report and the captions (phrases,
transcript, server rooms) use Node's built-in test runner. One test starts the real server.
