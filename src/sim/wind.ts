import type { Params } from "./config";
import { Perlin } from "./perlin";
import { mulberry32 } from "./rng";

/**
 * World wind: blows from a prevailing direction, but its direction and
 * speed wander slowly and smoothly (1D Perlin noise over time). Speed varies
 * by up to about ±50%. The direction usually stays within a quarter turn
 * or so of the prevailing wind but can swing to any bearing.
 *
 * It's independent of the water cycle: clouds read `offsetX/Y` to drift,
 * and other systems can use `vx/vy` later.
 */
export class Wind {
  /** Direction the wind blows toward, radians (screen axes: +x right, +y down). */
  angle = 0;
  /** Speed in squares per tick. */
  speed = 0;
  vx = 0;
  vy = 0;
  /** Total distance the air has carried things so far, in squares. */
  offsetX = 0;
  offsetY = 0;

  private readonly perlin: Perlin;
  /** Noise time, advanced by windChangeRate each tick (so changing the rate never jumps). */
  private phase = 0;

  constructor(seed: number, private p: Params) {
    this.perlin = new Perlin(mulberry32(seed + 4));
    this.sample();
  }

  step(): void {
    this.phase += this.p.windChangeRate;
    this.sample();
    this.offsetX += this.vx;
    this.offsetY += this.vy;
  }

  private sample(): void {
    const { windPrevailing, windSwing, windSpeed, windSpeedVariation } = this.p;
    const t = this.phase;
    // Noise is mostly within ±0.3 and rarely beyond ±0.7, so the bearing
    // stays near the prevailing one but can occasionally go anywhere.
    this.angle = windPrevailing + windSwing * this.perlin.noise(t, 0.37);
    const s = Math.max(-1, Math.min(1, 2.5 * this.perlin.noise(t * 1.3 + 17.1, 3.7)));
    this.speed = windSpeed * (1 + windSpeedVariation * s);
    this.vx = Math.cos(this.angle) * this.speed;
    this.vy = Math.sin(this.angle) * this.speed;
  }

  /** Compass bearing the wind blows *from*, degrees (0 = north, 90 = east). */
  get fromBearing(): number {
    // Screen +y is south. Blowing toward (vx, vy) means coming from the opposite side.
    const toward = (Math.atan2(this.vx, -this.vy) * 180) / Math.PI;
    return (toward + 180 + 360) % 360;
  }
}
