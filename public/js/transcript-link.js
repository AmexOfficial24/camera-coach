// The connection to the server's caption room for this meeting. Sends your lines, receives
// everyone's (including your own, stamped with the server's clock), and reconnects if it drops.
export class TranscriptLink {
  constructor(room, { onLine, onHistory, onStatus }) {
    this.room = room;
    this.onLine = onLine;
    this.onHistory = onHistory;
    this.onStatus = onStatus || (() => {});
    this.closed = false;
    this.retryMs = 1000;
    this.connect();
  }

  connect() {
    const scheme = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(scheme + "//" + location.host + "/ws?room=" + encodeURIComponent(this.room));
    this.ws = ws;
    ws.addEventListener("open", () => {
      this.retryMs = 1000;
      this.onStatus("connected");
    });
    ws.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch (error) {
        return;
      }
      if (message.type === "history") this.onHistory(message.lines || []);
      if (message.type === "line" && message.line) this.onLine(message.line);
    });
    ws.addEventListener("close", () => {
      if (this.closed || this.ws !== ws) return;
      this.onStatus("reconnecting");
      setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 10000);
    });
    ws.addEventListener("error", () => ws.close());
  }

  get connected() {
    return Boolean(this.ws) && this.ws.readyState === WebSocket.OPEN;
  }

  // Returns false if the line couldn't be sent (no connection right now).
  send(line) {
    if (!this.connected) return false;
    this.ws.send(JSON.stringify({ type: "line", line }));
    return true;
  }

  close() {
    this.closed = true;
    if (this.ws) this.ws.close();
  }
}
