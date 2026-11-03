// Everything that talks to Webex. The app also works in a normal browser, where this does nothing.
export const webex = {
  app: null,

  // Resolves true inside Webex, false elsewhere (the SDK never becomes ready outside Webex).
  async init(timeoutMs = 4000) {
    if (!window.webex || !window.webex.Application) return false;
    const app = new window.webex.Application();
    const ready = await Promise.race([
      app.onReady().then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs)),
    ]);
    if (ready) this.app = app;
    return ready;
  },

  userName() {
    try {
      return this.app.application.states.user.displayName || "";
    } catch (error) {
      return "";
    }
  },

  // Where the app is open: { place: "meeting" | "space" | "browser", title }.
  async placeInfo() {
    if (!this.app) return { place: "browser", title: null };
    const ask = (promise) => Promise.race([
      promise.catch(() => null),
      new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
    ]);
    const meeting = await ask(this.app.context.getMeeting());
    if (meeting && meeting.id) return { place: "meeting", title: meeting.title || null };
    const space = await ask(this.app.context.getSpace());
    if (space && space.id) return { place: "space", title: space.title || null };
    return { place: "browser", title: null };
  },

  // Call apply("LIGHT" | "DARK") now and whenever the user changes their Webex theme.
  watchTheme(apply) {
    if (!this.app) return;
    apply(this.app.theme);
    this.app.listen()
      .then(() => this.app.on("application:themeChanged", apply))
      .catch((reason) => console.warn("Could not listen for theme changes:", reason));
  },
};
