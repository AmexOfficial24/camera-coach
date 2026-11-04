# Camera Coach

Our Task 4 project for the Cisco Week 1 programme. It's a Webex Embedded App that watches
your camera during a meeting and gives you tips on how you come across: eye contact,
expression, framing, lighting and steadiness. It only shows one tip at a time, so it
doesn't get in the way.

When you end a session you get a report with your average score, a chart of how it went,
and what to work on. You can save it as a web page or CSV, or copy a summary into Webex.

Face tracking uses [MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker)
and runs in the browser, so your video isn't uploaded or recorded anywhere. Reports are
saved in the browser too.

## Running it

```sh
npm start
```

Then open http://localhost:3001. There's nothing to install.

Webex can't load localhost, so to use it in a meeting we run a Cloudflare tunnel:

```sh
cloudflared tunnel --url http://localhost:3001
```

and register an Embedded App in the [Webex Developer Portal](https://developer.webex.com)
with the tunnel URL as the Start page URL and its host as the Valid domain.

## What it checks

- Eye contact: head turned away, or eyes looking down at notes or off to the side
- Expression: smiling now and then, and a furrowed brow (we had to make sure a big smile
  didn't count as frowning)
- Framing: too close, too far, off-centre, camera too low or high, head tilted
- Lighting: face in shadow, washed out, or a bright window behind you
- Steadiness: moving around a lot (moving once to a new spot is fine)

A problem has to last 2 seconds before a tip appears. Fix it and you get "That's better!",
and if you ignore a tip it goes away after 10 seconds. All the numbers are in
`public/js/config.js`.

## Code

- `public/app.js` connects everything and runs the main loop
- `public/js/analysis.js` turns MediaPipe's output into measurements (head angle, gaze,
  smile, framing, lighting)
- `public/js/coach.js` scores those and decides which tip to show
- `public/js/report.js` builds the report, the chart and the exports
- `public/js/reports-store.js` saves reports, every 10 seconds during a session, so the
  report isn't lost if the meeting ends and Webex closes the app
- `tracker.js`, `camera.js`, `webex.js`, `settings.js` and `ui.js` handle face tracking,
  the camera, Webex, settings and the screen
- `public/camera-test.html` is the test page we made first to check Webex would let an app
  use the camera. We kept it for troubleshooting.

For testing, Settings has "Show face mesh" and "Show measurements" (or add `?debug=1` to
the URL). They're off by default.

## Tests

```sh
npm test
```

Uses Node's built-in test runner. Most of the tests feed a few seconds of made-up face data
into the coach and check which tips it gives.

## Known issues

- It needs an internet connection the first time, to download MediaPipe and the face model.
- Reports are only stored in the browser you used, so they don't follow you to another computer.
- The quick tunnel gets a new URL every time it starts, so the Start page URL has to be
  updated in the Developer Portal each time.
- Webex sometimes blocks downloads from the app panel. If that happens, use Copy summary instead.
- The thresholds haven't been tried with many different people, cameras or rooms yet.
