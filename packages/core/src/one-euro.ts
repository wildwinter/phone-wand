// One Euro filter (Casiez, Roussel and Vogel, CHI 2012): a low-pass filter whose cutoff rises with
// speed, so a pointer is steady when still and responsive when moving.
// https://gery.casiez.net/1euro/

export interface SmoothingOptions {
  /** Cutoff frequency in Hz when still. Lower is steadier. */
  minCutoff: number;
  /** How much the cutoff rises with speed. Higher is quicker to follow movement. */
  beta: number;
  /** Cutoff in Hz for the speed estimate itself. */
  dCutoff: number;
}

export const DEFAULT_SMOOTHING: SmoothingOptions = { minCutoff: 1.0, beta: 5.0, dCutoff: 1.0 };

function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

/** Filters a fixed-length vector of numbers sampled at irregular times. */
export class OneEuroFilter {
  private x: number[] | null = null;
  private dx: number[] = [];
  private lastT = 0;

  constructor(public options: SmoothingOptions = DEFAULT_SMOOTHING) {}

  reset(): void {
    this.x = null;
  }

  /** `t` in milliseconds. Returns the filtered values. */
  filter(values: number[], t: number): number[] {
    if (this.x === null || this.x.length !== values.length) {
      this.x = values.slice();
      this.dx = values.map(() => 0);
      this.lastT = t;
      return values.slice();
    }
    const dt = (t - this.lastT) / 1000;
    // Repeated or out-of-order timestamps: hold the last output rather than divide by zero.
    if (!(dt > 0)) return this.x.slice();
    this.lastT = t;
    const { minCutoff, beta, dCutoff } = this.options;
    const ad = alpha(dCutoff, dt);
    let speed = 0;
    for (let i = 0; i < values.length; i++) {
      const d = (values[i] - this.x[i]) / dt;
      this.dx[i] = this.dx[i] + ad * (d - this.dx[i]);
      speed += this.dx[i] * this.dx[i];
    }
    // One cutoff for the whole vector, from its overall speed, so components stay consistent.
    const a = alpha(minCutoff + beta * Math.sqrt(speed), dt);
    for (let i = 0; i < values.length; i++) {
      this.x[i] = this.x[i] + a * (values[i] - this.x[i]);
    }
    return this.x.slice();
  }
}
