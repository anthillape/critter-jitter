import { CELL_COUNT, GRID_H, GRID_W, WATER_LEVEL, type Params } from "./config";
import { Perlin } from "./perlin";
import { mulberry32, type Rng } from "./rng";
import type { Terrain } from "./terrain";

/** Clouds are simulated on a coarse grid of CLOUD_CELL x CLOUD_CELL squares. */
export const CLOUD_CELL = 4;
export const CLOUD_W = GRID_W / CLOUD_CELL;
export const CLOUD_H = GRID_H / CLOUD_CELL;
const CLOUD_UPDATE_EVERY = 8; // ticks between cloud-pattern updates
const CLOUD_RAMP = 0.45; // noise range over which clouds go from wisp to full thickness

/**
 * The water cycle. Water lives in three places and the sum never changes:
 *  - surface: standing water on a square (lakes, puddles), in height units
 *  - soil:    water held in the ground, 0..soilCap per square
 *  - cloud:   a single pool, drawn as a drifting Perlin-noise pattern
 * Water evaporates from the surface and soil into the clouds. Once the clouds
 * hold more than `rainStart` of all water it starts raining where the clouds
 * are, at a roughly steady rate. How much falls varies from event to event:
 * usually a shower, sometimes until the clouds are empty. Surface water flows
 * downhill toward the lowest level. Soil water drains downhill quickly and
 * wicks uphill slowly.
 */
export class Hydrology {
  readonly surface = new Float64Array(CELL_COUNT);
  readonly soil = new Float64Array(CELL_COUNT);
  cloud = 0;
  raining = false;
  /** Cloud level at which the current rain event ends. */
  private rainTarget = 0;
  private readonly rng: Rng;
  /** Cloud density 0..1 on the coarse cloud grid. */
  readonly cloudDensity = new Float32Array(CLOUD_W * CLOUD_H);
  /** Total water in the world (surface + soil + cloud); constant. */
  readonly total: number;
  /** Water rained this tick (for stats). */
  lastRain = 0;
  /** Per-square flags / saturation, refreshed at the end of every step. */
  readonly wet = new Uint8Array(CELL_COUNT);
  readonly sat = new Float32Array(CELL_COUNT);

  /** Sum of rain weights (density squared) over the cloud grid. */
  private cloudWeight = 0;
  private readonly perlin: Perlin;
  private readonly fluxR = new Float64Array(CELL_COUNT);
  private readonly fluxD = new Float64Array(CELL_COUNT);
  /** 1 unless the square is in the last / first column (avoids % in hot loops). */
  readonly notLastCol = new Uint8Array(CELL_COUNT);
  readonly notFirstCol = new Uint8Array(CELL_COUNT);

  constructor(private terrain: Terrain, private p: Params) {
    this.perlin = new Perlin(mulberry32(terrain.seed + 2));
    this.rng = mulberry32(terrain.seed + 3);
    const { elevation, moisture } = terrain;
    let ground = 0;
    for (let i = 0; i < CELL_COUNT; i++) {
      const x = i % GRID_W;
      this.notLastCol[i] = x < GRID_W - 1 ? 1 : 0;
      this.notFirstCol[i] = x > 0 ? 1 : 0;
      // Lakes fill everything at or below WATER_LEVEL up to a flat surface.
      const depth = Math.max(0, WATER_LEVEL + 1 - elevation[i]);
      this.surface[i] = depth;
      // Start the soil near its long-run profile so the world doesn't begin bone dry.
      this.soil[i] = depth > 0 ? p.soilCap : p.soilCap * moisture[i];
      ground += this.surface[i] + this.soil[i];
    }
    // Some water starts in the sky, so the first rain comes soon and the
    // lakes don't have to shrink much to fill the clouds.
    this.cloud = ground * p.initialCloud / (1 - p.initialCloud);
    this.total = ground + this.cloud;
    this.updateClouds(0);
    this.refresh();
  }

  /** A square counts as water (algae can live, grass can't) above this depth. */
  isWater(i: number): boolean {
    return this.wet[i] === 1;
  }

  /** Soil saturation 0..1 (1 under standing water). */
  saturation(i: number): number {
    return this.sat[i];
  }

  private refresh(): void {
    const { surface, soil, wet, sat } = this;
    const min = this.p.waterDepthMin;
    const inv = 1 / this.p.soilCap;
    for (let i = 0; i < CELL_COUNT; i++) {
      const w = surface[i] >= min;
      wet[i] = w ? 1 : 0;
      sat[i] = w ? 1 : soil[i] * inv;
    }
  }

  /** Cloud density at a grid square, bilinearly interpolated. */
  cloudAt(x: number, y: number): number {
    const fx = Math.min(CLOUD_W - 1.001, Math.max(0, (x + 0.5) / CLOUD_CELL - 0.5));
    const fy = Math.min(CLOUD_H - 1.001, Math.max(0, (y + 0.5) / CLOUD_CELL - 0.5));
    const x0 = fx | 0;
    const y0 = fy | 0;
    const tx = fx - x0;
    const ty = fy - y0;
    const d = this.cloudDensity;
    const a = d[y0 * CLOUD_W + x0];
    const b = d[y0 * CLOUD_W + x0 + 1];
    const c = d[(y0 + 1) * CLOUD_W + x0];
    const e = d[(y0 + 1) * CLOUD_W + x0 + 1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + e * tx) * ty;
  }

  step(tick: number): void {
    if (tick % CLOUD_UPDATE_EVERY === 0) this.updateClouds(tick);
    this.rain();
    this.evaporateAndInfiltrate();
    // Soil water moves slowly, so it only needs updating every other tick.
    if ((tick & 1) === 0) this.flowSoil();
    this.runOff();
    this.flowSurface();
  }

  /**
   * Shallow water (below waterDepthMin) runs down the steepest slope. Flows
   * from many squares merge along the same paths, carving out streams that
   * run into the lakes. Deeper water is handled by flowSurface.
   */
  private runOff(): void {
    const { surface, fluxR: moved } = this;
    const down = this.terrain.downhill;
    const min = this.p.waterDepthMin;
    const rate = this.p.runoffRate;
    moved.fill(0);
    for (let i = 0; i < CELL_COUNT; i++) {
      const s = surface[i];
      if (s <= 0 || s >= min) continue;
      const d = down[i];
      if (d < 0) continue;
      const m = s * rate;
      moved[i] -= m;
      moved[d] += m;
    }
    for (let i = 0; i < CELL_COUNT; i++) surface[i] += moved[i];
  }

  /** Evaporation into the clouds, then standing water soaking into the soil. */
  private evaporateAndInfiltrate(): void {
    const { surface, soil } = this;
    const { evapSurface, evapSoil, soilCap, infiltration } = this.p;
    let up = 0;
    for (let i = 0; i < CELL_COUNT; i++) {
      let s = surface[i];
      let g = soil[i];
      const e2 = g * evapSoil;
      g -= e2;
      up += e2;
      if (s > 0) {
        const e = s < evapSurface ? s : evapSurface;
        s -= e;
        up += e;
        // Soaking in is slow, and slower still as the soil fills, so most
        // rain runs off downhill before it can soak away.
        const room = soilCap - g;
        if (room > 0 && s > 0) {
          const rate = infiltration * room / soilCap;
          const m = s < rate ? s : rate;
          s -= m;
          g += m;
        }
        surface[i] = s;
      }
      soil[i] = g;
    }
    this.cloud += up;
  }

  /**
   * Two layers of Perlin noise drifting at different speeds give a slowly
   * moving, slowly changing pattern. More cloud water = more coverage.
   */
  private updateClouds(tick: number): void {
    const { cloudScale, windX, windY } = this.p;
    const frac = this.cloud / this.total;
    const threshold = 0.3 - 1.8 * frac;
    let weight = 0;
    for (let cy = 0; cy < CLOUD_H; cy++) {
      for (let cx = 0; cx < CLOUD_W; cx++) {
        const x = cx * CLOUD_CELL;
        const y = cy * CLOUD_CELL;
        const n = 0.65 * this.perlin.fbm((x - windX * tick) * cloudScale, (y - windY * tick) * cloudScale, 4)
          + 0.35 * this.perlin.fbm((x - windX * 1.6 * tick) * cloudScale * 1.9 + 50, (y - windY * 0.4 * tick) * cloudScale * 1.9, 3);
        // Wide ramp so only the cores reach full thickness.
        const d = Math.max(0, Math.min(1, (n - threshold) / CLOUD_RAMP));
        this.cloudDensity[cy * CLOUD_W + cx] = d;
        weight += d * d;
      }
    }
    this.cloudWeight = weight;
  }

  /**
   * Rain falls in proportion to cloud density squared, so it is heaviest
   * under the thickest cloud. The rate is steady (rainRate of all water per
   * tick) but each event drops a random share of the cloud water: mostly
   * showers, occasionally a deluge that empties the sky. Thin clouds can only
   * drop so much per square, so rain tapers off as they vanish.
   */
  private rain(): void {
    const p = this.p;
    if (!this.raining && this.cloud > p.rainStart * this.total) {
      const u = this.rng();
      // Skewed: typically 15-40% of the clouds, about 1 in 12 empties them.
      const share = Math.min(1, p.rainMinShare + u * u);
      this.rainTarget = this.cloud * (1 - share);
      this.raining = true;
    }
    this.lastRain = 0;
    if (!this.raining) return;

    const amount = Math.min(p.rainRate * this.total, this.cloud - this.rainTarget);
    const perCell = this.cloudWeight > 0 ? amount / (this.cloudWeight * CLOUD_CELL * CLOUD_CELL) : 0;
    const cap = p.rainMaxPerSquare;
    let fallen = 0;
    for (let cy = 0; cy < CLOUD_H; cy++) {
      for (let cx = 0; cx < CLOUD_W; cx++) {
        const d = this.cloudDensity[cy * CLOUD_W + cx];
        if (d <= 0) continue;
        // Density squared: rain is concentrated under the thickest cloud.
        const r = Math.min(perCell, cap) * d * d;
        for (let dy = 0; dy < CLOUD_CELL; dy++) {
          const row = (cy * CLOUD_CELL + dy) * GRID_W + cx * CLOUD_CELL;
          for (let dx = 0; dx < CLOUD_CELL; dx++) this.surface[row + dx] += r;
        }
        fallen += r * CLOUD_CELL * CLOUD_CELL;
      }
    }
    this.cloud -= fallen;
    this.lastRain = fallen;
    // Stop at the target, or once the clouds are too thin to rain properly.
    // (Half the normal rate: otherwise evaporation can sustain an endless drizzle.)
    if (this.cloud <= this.rainTarget + 1e-9 || fallen < 0.5 * p.rainRate * this.total) {
      this.raining = false;
    }
  }

  /**
   * Soil water wicks from wetter to drier squares (slowly, in any direction)
   * and drains downhill (faster). Anything over capacity seeps out as
   * surface water.
   */
  private flowSoil(): void {
    const { soil, surface, fluxR, fluxD } = this;
    const h = this.terrain.elevation;
    const { soilCap, soilWick, soilDrain } = this.p;
    const inv = 1 / soilCap;
    const W = GRID_W;
    for (let i = 0; i < CELL_COUNT; i++) {
      const wa = soil[i];
      const ha = h[i];
      // Right neighbour
      let f = 0;
      if (this.notLastCol[i]) {
        const wb = soil[i + 1];
        const dh = ha - h[i + 1];
        f = soilWick * (wa - wb);
        if (dh > 0) f += soilDrain * dh * wa * (1 - wb * inv);
        else if (dh < 0) f += soilDrain * dh * wb * (1 - wa * inv);
        // Never move more than a quarter of what's there (4 neighbours).
        if (f > wa * 0.24) f = wa * 0.24;
        else if (f < -wb * 0.24) f = -wb * 0.24;
      }
      fluxR[i] = f;
      // Down neighbour
      f = 0;
      if (i + W < CELL_COUNT) {
        const wb = soil[i + W];
        const dh = ha - h[i + W];
        f = soilWick * (wa - wb);
        if (dh > 0) f += soilDrain * dh * wa * (1 - wb * inv);
        else if (dh < 0) f += soilDrain * dh * wb * (1 - wa * inv);
        if (f > wa * 0.24) f = wa * 0.24;
        else if (f < -wb * 0.24) f = -wb * 0.24;
      }
      fluxD[i] = f;
    }
    for (let i = 0; i < CELL_COUNT; i++) {
      let v = soil[i] - fluxR[i] - fluxD[i];
      if (this.notFirstCol[i]) v += fluxR[i - 1];
      if (i >= W) v += fluxD[i - W];
      if (v > soilCap) {
        surface[i] += v - soilCap;
        v = soilCap;
      }
      soil[i] = v;
    }
  }

  /**
   * Standing water flows toward neighbours with a lower water surface, so
   * lakes level out. Only edges touching water at least waterDepthMin deep
   * take part; thinner run-off follows the slope instead (runOff).
   */
  private flowSurface(): void {
    const { surface, fluxR, fluxD, notLastCol } = this;
    const h = this.terrain.elevation;
    const k = this.p.surfaceFlow;
    const min = this.p.waterDepthMin;
    const W = GRID_W;
    for (let i = 0; i < CELL_COUNT; i++) {
      const sa = surface[i];
      const la = h[i] + sa;
      let f = 0;
      if (notLastCol[i]) {
        const sb = surface[i + 1];
        if (sa >= min || sb >= min) {
          f = k * (la - h[i + 1] - sb);
          if (f > sa * 0.24) f = sa * 0.24;
          else if (f < -sb * 0.24) f = -sb * 0.24;
        }
      }
      fluxR[i] = f;
      f = 0;
      if (i + W < CELL_COUNT) {
        const sb = surface[i + W];
        if (sa >= min || sb >= min) {
          f = k * (la - h[i + W] - sb);
          if (f > sa * 0.24) f = sa * 0.24;
          else if (f < -sb * 0.24) f = -sb * 0.24;
        }
      }
      fluxD[i] = f;
    }
    // Apply, and refresh the per-square water flags in the same pass.
    const { wet, sat, soil, notFirstCol } = this;
    const inv = 1 / this.p.soilCap;
    for (let i = 0; i < CELL_COUNT; i++) {
      let v = surface[i] - fluxR[i] - fluxD[i];
      if (notFirstCol[i]) v += fluxR[i - 1];
      if (i >= W) v += fluxD[i - W];
      surface[i] = v;
      const w = v >= min;
      wet[i] = w ? 1 : 0;
      sat[i] = w ? 1 : soil[i] * inv;
    }
  }

  /** Sum of surface, soil and cloud water (should always equal `total`). */
  measure(): { surface: number; soil: number; cloud: number; total: number } {
    let s = 0;
    let g = 0;
    for (let i = 0; i < CELL_COUNT; i++) {
      s += this.surface[i];
      g += this.soil[i];
    }
    return { surface: s, soil: g, cloud: this.cloud, total: s + g + this.cloud };
  }
}
