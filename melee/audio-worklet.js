// Plays the game's audio: interleaved stereo frames posted from the main
// thread, queued with a little latency to absorb the game's frame pacing.

class MeleeOutput extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunks = [];
    this.offset = 0; // within chunks[0], in frames
    this.queued = 0; // frames
    this.started = false;
    // Start once this much is queued, so a late batch doesn't click
    this.target = Math.round(sampleRate * 0.06);
    // Beyond this the main thread is ahead: drop the oldest
    this.limit = Math.round(sampleRate * 0.25);
    this.port.onmessage = (e) => {
      const samples = e.data; // Float32Array, L R L R ...
      this.chunks.push(samples);
      this.queued += samples.length / 2;
      while (this.queued > this.limit && this.chunks.length > 1) {
        const dropped = this.chunks.shift();
        this.queued -= dropped.length / 2 - this.offset;
        this.offset = 0;
      }
    };
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const left = out[0];
    const right = out[1] || out[0];
    if (!this.started) {
      if (this.queued < this.target) {
        left.fill(0);
        right.fill(0);
        return true;
      }
      this.started = true;
    }
    for (let i = 0; i < left.length; i++) {
      const chunk = this.chunks[0];
      if (!chunk) {
        // Ran dry: wait for the queue to fill again
        left.fill(0, i);
        right.fill(0, i);
        this.started = false;
        break;
      }
      left[i] = chunk[this.offset * 2];
      right[i] = chunk[this.offset * 2 + 1];
      this.offset++;
      this.queued--;
      if (this.offset * 2 >= chunk.length) {
        this.chunks.shift();
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor('melee-output', MeleeOutput);
