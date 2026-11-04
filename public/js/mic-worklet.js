// Runs on the browser's audio thread: collects microphone samples into 512-sample blocks
// (32 ms at 16 kHz) and hands them to the page.
class MicBlocks extends AudioWorkletProcessor {
  constructor() {
    super();
    this.block = new Float32Array(512);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        this.block[this.filled++] = channel[i];
        if (this.filled === this.block.length) {
          this.port.postMessage(this.block, [this.block.buffer]);
          this.block = new Float32Array(512);
          this.filled = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor("mic-blocks", MicBlocks);
