// Small helpers for microphone audio. Pure functions, so they're unit-tested.

// Loudness of a block of samples (root mean square, 0 = silence).
export function rms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return samples.length ? Math.sqrt(sum / samples.length) : 0;
}

export function concat(blocks) {
  const out = new Float32Array(blocks.reduce((n, b) => n + b.length, 0));
  let offset = 0;
  for (const b of blocks) {
    out.set(b, offset);
    offset += b.length;
  }
  return out;
}

// Converts a stream of audio blocks from one sample rate to another (e.g. 48000 -> 16000),
// carrying the position across blocks so there are no clicks at the joins.
export class Resampler {
  constructor(fromRate, toRate) {
    this.step = fromRate / toRate;
    this.position = 0;   // where the next output sample falls, counted from the start of the block
    this.previous = 0;   // last sample of the previous block (position -1)
  }

  push(input) {
    if (!input.length) return new Float32Array(0);
    const at = (k) => (k < 0 ? this.previous : input[k]);
    const out = [];
    // Linear interpolation between the two samples either side of each output position.
    while (this.position + 1 < input.length) {
      const i = Math.floor(this.position);
      const fraction = this.position - i;
      out.push(at(i) + (at(i + 1) - at(i)) * fraction);
      this.position += this.step;
    }
    this.position -= input.length;
    this.previous = input[input.length - 1];
    return Float32Array.from(out);
  }
}
