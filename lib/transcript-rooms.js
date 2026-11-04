// Meeting transcripts kept in memory, one per room (a Webex meeting or space).
// Only finished lines are stored; live (interim) captions are passed straight through.
// Nothing is written to disk, so a transcript disappears when the server stops.
const MAX_ID_LENGTH = 100;
const MAX_NAME_LENGTH = 80;
const MAX_TEXT_LENGTH = 500;
const MAX_AGE_MS = 60000;

function createRooms({ maxLines = 2000, maxRooms = 50, maxPending = 200 } = {}) {
  const rooms = new Map(); // name -> { lines: Map(id -> line), pending: Map(id -> at), touched }

  function getRoom(name, now) {
    let room = rooms.get(name);
    if (!room) {
      room = { lines: new Map(), pending: new Map(), touched: now };
      rooms.set(name, room);
      // Too many rooms: forget the one used least recently.
      if (rooms.size > maxRooms) {
        const oldest = [...rooms.entries()].sort((a, b) => a[1].touched - b[1].touched)[0];
        rooms.delete(oldest[0]);
      }
    }
    room.touched = now;
    return room;
  }

  // Check a line from a client and stamp it with the server's clock, so everyone's lines sort
  // into one order even if their computers' clocks differ. `ageMs` says how long ago the phrase
  // started. Returns the line to send to everyone in the room, or null if it's not valid.
  function addLine(roomName, input, now) {
    if (!input || typeof input !== "object") return null;
    const id = typeof input.id === "string" ? input.id.slice(0, MAX_ID_LENGTH) : "";
    const speaker = typeof input.speaker === "string" ? input.speaker.trim().slice(0, MAX_NAME_LENGTH) : "";
    const text = typeof input.text === "string" ? input.text.trim().slice(0, MAX_TEXT_LENGTH) : "";
    const final = input.final === true;
    if (!id || !speaker) return null;
    if (!final && !text) return null;

    const room = getRoom(roomName, now);
    const age = Math.min(Math.max(Number(input.ageMs) || 0, 0), MAX_AGE_MS);
    const known = room.lines.get(id);
    const at = known ? known.at : room.pending.get(id) ?? now - age;
    const line = { id, speaker, text, final, at };

    if (!final) {
      room.pending.set(id, at);
      if (room.pending.size > maxPending) room.pending.delete(room.pending.keys().next().value);
      return line;
    }
    room.pending.delete(id);
    if (!text) {
      room.lines.delete(id); // removed: the phrase wasn't speech, or wasn't this person
      return line;
    }
    room.lines.set(id, line);
    if (room.lines.size > maxLines) {
      const oldest = [...room.lines.values()].sort((a, b) => a.at - b.at)[0];
      room.lines.delete(oldest.id);
    }
    return line;
  }

  function history(roomName) {
    const room = rooms.get(roomName);
    return room ? [...room.lines.values()].sort((a, b) => a.at - b.at) : [];
  }

  return { addLine, history, roomCount: () => rooms.size };
}

// Room names come from the address (?room=...); anything odd becomes "local".
function roomName(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 200 ? value : "local";
}

module.exports = { createRooms, roomName };
