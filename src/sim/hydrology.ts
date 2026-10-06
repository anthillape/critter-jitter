import { CELL_COUNT, GRID_H, GRID_W, TERRAIN, type Params } from "./config";
import { Perlin } from "./perlin";
import { mulberry32, type Rng } from "./rng";
import type { Terrain } from "./terrain";
import type { Wind } from "./wind";

/** Clouds are simulated on a coarse grid of CLOUD_CELL x CLOUD_CELL squares. */
export const CLOUD_CELL = 4;
const CLOUD_UPDATE_EVERY = 8; // ticks between cloud-pattern updates
const CLOUD_RAMP = 0.45; // noise range over which clouds go from wisp to full thickness

// The 8 neighbours of a square and the distance to each.
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];
const DIST = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];

/**
 * The water cycle. Water is in three places, and the total never changes
 * (except when the player's Rain / Dryer tools add or remove it):
 *
 *  - surface: water standing on a square (lakes, ponds, streams), in height units.
 *  - soil: a column of `TERRAIN.soilLayers` layers under every square, each
 *    holding up to soilCap. Layer 0 is the top.
 *  - cloud: one pool, drawn as drifting Perlin-noise clouds.
 *
 * There is nothing special about any height: every square follows the same rules.
 *
 *  - Surface water flows to lower neighbours, compared by ground height plus
 *    water depth. More goes toward the steepest drop, so run-off gathers into
 *    channels on slopes, while a lake's flat surface barely moves and stays
 *    level. Lakes are just where water has collected.
 *  - Evaporation is the same from every square: from surface water if there
 *    is any, otherwise from the top soil layer.
 *  - Surface water soaks into the top soil layer.
 *  - Within a column, water seeps down slowly under gravity. Capillary
 *    pressure pulls it back up toward drier layers above. The deepest layer
 *    is groundwater and flows slowly toward lower ground. When a column is
 *    full, extra water pushes up and comes out as surface water (a spring).
 *  - Rain starts at random, more likely the fuller the clouds are, and falls
 *    where the clouds are thickest. Each event builds up gradually, holds,
 *    and tails off (or fades out if the clouds run thin).
 *
 * The world's shape never changes, so each square's neighbours are worked
 * out once. Each tick is then a few flat passes over typed arrays.
 */
export class Hydrology {
  readonly surface = new Float64Array(CELL_COUNT);
  /** Soil water, layer-major: soil[layer * CELL_COUNT + square]. */
  readonly soil: Float64Array;
  readonly layers: number;
  cloud = 0;
  raining = false;
  /**
   * How hard it's raining, 0..1 of the full rate (for the look and sound of
   * rain): it follows the rain actually falling, which builds up, holds and
   * tapers off over each rain event.
   */
  rainFade = 0;
  /** Cloud level at which the current rain event ends. */
  private rainTarget = 0;
  /** Cloud water when the current rain event began (its size is this minus rainTarget). */
  private rainFrom = 0;
  /** Ticks since the current rain event began. */
  private rainAge = 0;
  /** Fading out: from strength rainEndFrom, rainEndAge ticks ago. */
  private rainEnding = false;
  private rainEndFrom = 0;
  private rainEndAge = 0;
  private readonly rng: Rng;
  /** Size of the coarse cloud grid (the world size in CLOUD_CELL blocks, edge blocks may be partial). */
  readonly cloudW = Math.ceil(GRID_W / CLOUD_CELL);
  readonly cloudH = Math.ceil(GRID_H / CLOUD_CELL);
  /** Cloud density 0..1 on the coarse cloud grid. */
  readonly cloudDensity = new Float32Array(this.cloudW * this.cloudH);
  /** Total water in the world (surface + soil + cloud); only the tools change it. */
  total: number;
  /** Manual rain mode: automatic rain is off and `manualRain` decides. */
  manual = false;
  manualRain = false;
  /** Water rained this tick (for stats). */
  lastRain = 0;
  /** Per-square flags / top-soil saturation, refreshed at the end of every step. */
  readonly wet = new Uint8Array(CELL_COUNT);
  readonly sat = new Float32Array(CELL_COUNT);

  private cloudTime = 0;
  private cloudTick = 0;
  /** Sum of rain weights (density squared x squares covered) over the cloud grid. */
  private cloudWeight = 0;
  private readonly perlin: Perlin;
  /** Neighbour index for each square and direction (-1 off the map): nbr[i * 8 + d]. */
  private readonly nbr = new Int32Array(CELL_COUNT * 8);
  /** Change in surface water this tick (flow is computed from the old state, then applied). */
  private readonly delta = new Float64Array(CELL_COUNT);
  private readonly gwFlux = new Float64Array(CELL_COUNT * 2);
  /** 1 unless the square is in the last / first column (avoids % in other modules' hot loops). */
  readonly notLastCol = new Uint8Array(CELL_COUNT);
  readonly notFirstCol = new Uint8Array(CELL_COUNT);

  constructor(private terrain: Terrain, private p: Params, private wind: Wind) {
    this.perlin = new Perlin(mulberry32(terrain.seed + 2));
    this.rng = mulberry32(terrain.seed + 3);
    this.layers = Math.max(1, Math.round(TERRAIN.soilLayers));
    this.soil = new Float64Array(CELL_COUNT * this.layers);

    for (let i = 0; i < CELL_COUNT; i++) {
      const x = i % GRID_W;
      const y = (i / GRID_W) | 0;
      this.notLastCol[i] = x < GRID_W - 1 ? 1 : 0;
      this.notFirstCol[i] = x > 0 ? 1 : 0;
      for (let d = 0; d < 8; d++) {
        const nx = x + DX[d];
        const ny = y + DY[d];
        this.nbr[i * 8 + d] = nx < 0 || ny < 0 || nx >= GRID_W || ny >= GRID_H ? -1 : ny * GRID_W + nx;
      }
    }

    // Starting water: an amount, not a height. Surface water fills the
    // lowest ground first (lakes form wherever the land is lowest). Soil
    // starts partly wet (and full under the lakes). Some starts as cloud.
    const e = terrain.elevation;
    const level = this.fillLevel(p.startingSurfaceWater * CELL_COUNT);
    let ground = 0;
    for (let i = 0; i < CELL_COUNT; i++) {
      const depth = Math.max(0, level - e[i]);
      this.surface[i] = depth;
      ground += depth;
      for (let l = 0; l < this.layers; l++) {
        const w = depth > 0 ? p.soilCap : p.soilCap * Math.min(1, p.initialSoilWetness);
        this.soil[l * CELL_COUNT + i] = w;
        ground += w;
      }
    }
    this.cloud = (ground * p.initialCloud) / (1 - p.initialCloud);
    this.total = ground + this.cloud;
    this.updateClouds(0);
    this.refresh();
  }

  /** The water level that holds `volume` of surface water, filling the lowest ground first. */
  private fillLevel(volume: number): number {
    const e = this.terrain.elevation;
    if (volume <= 0) return -Infinity;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < CELL_COUNT; i++) {
      if (e[i] < lo) lo = e[i];
      if (e[i] > hi) hi = e[i];
    }
    hi += volume / CELL_COUNT;
    for (let k = 0; k < 50; k++) {
      const mid = (lo + hi) / 2;
      let v = 0;
      for (let i = 0; i < CELL_COUNT; i++) if (mid > e[i]) v += mid - e[i];
      if (v > volume) hi = mid;
      else lo = mid;
    }
    return (lo + hi) / 2;
  }

  /** A square counts as water (algae can live, grass can't) above this depth. */
  isWater(i: number): boolean {
    return this.wet[i] === 1;
  }

  /** Top-soil saturation 0..1 (1 under standing water). */
  saturation(i: number): number {
    return this.sat[i];
  }

  /** All the soil water in square i's column. */
  soilColumn(i: number): number {
    let w = 0;
    for (let l = 0; l < this.layers; l++) w += this.soil[l * CELL_COUNT + i];
    return w;
  }

  private refresh(): void {
    const { surface, soil, wet, sat } = this;
    const min = this.p.waterDepthMin;
    const inv = 1 / this.p.soilCap;
    for (let i = 0; i < CELL_COUNT; i++) {
      const w = surface[i] >= min;
      wet[i] = w ? 1 : 0;
      sat[i] = w ? 1 : Math.min(1, soil[i] * inv); // top layer
    }
  }

  /** Cloud density at a grid square, bilinearly interpolated. */
  cloudAt(x: number, y: number): number {
    const fx = Math.min(this.cloudW - 1.001, Math.max(0, (x + 0.5) / CLOUD_CELL - 0.5));
    const fy = Math.min(this.cloudH - 1.001, Math.max(0, (y + 0.5) / CLOUD_CELL - 0.5));
    const x0 = fx | 0;
    const y0 = fy | 0;
    const tx = fx - x0;
    const ty = fy - y0;
    const d = this.cloudDensity;
    const a = d[y0 * this.cloudW + x0];
    const b = d[y0 * this.cloudW + x0 + 1];
    const c = d[(y0 + 1) * this.cloudW + x0];
    const e = d[(y0 + 1) * this.cloudW + x0 + 1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + e * tx) * ty;
  }

  step(tick: number): void {
    if (tick % CLOUD_UPDATE_EVERY === 0) this.updateClouds(tick);
    this.rain();
    // Follow the rain that's falling (lightly smoothed).
    const full = this.p.rainRate * this.total;
    const now = full > 0 ? Math.min(1, this.lastRain / full) : 0;
    this.rainFade += (now - this.rainFade) * 0.05;
    this.evaporateAndSoak();
    this.soilColumns();
    // Groundwater moves slowly; every other tick is plenty.
    if ((tick & 1) === 0) this.groundwater();
    this.flowSurface();
    this.refresh();
  }

  /**
   * Surface water runs to lower neighbours (by ground height + water depth).
   * A square sends out part of its water, at most half its biggest drop so
   * levels never overshoot, split between the downhill neighbours in
   * proportion to slope^flowFocus. Higher focus makes water pick the
   * steepest way, which carves channels. Dry squares are skipped.
   */
  private flowSurface(): void {
    const { surface, nbr, delta } = this;
    const e = this.terrain.elevation;
    const rate = this.p.flowRate;
    const focus = this.p.flowFocus;
    const slopes = new Float64Array(8);
    delta.fill(0);
    for (let i = 0; i < CELL_COUNT; i++) {
      const s = surface[i];
      if (s < 1e-6) continue;
      const level = e[i] + s;
      let maxDrop = 0;
      let wsum = 0;
      for (let d = 0; d < 8; d++) {
        const j = nbr[i * 8 + d];
        let w = 0;
        if (j >= 0) {
          const drop = level - e[j] - surface[j];
          if (drop > 0) {
            if (drop > maxDrop) maxDrop = drop;
            w = focus === 1 ? drop / DIST[d] : (drop / DIST[d]) ** focus;
          }
        }
        slopes[d] = w;
        wsum += w;
      }
      if (wsum <= 0) continue;
      const out = rate * Math.min(s, 0.5 * maxDrop);
      if (out <= 0) continue;
      delta[i] -= out;
      const k = out / wsum;
      for (let d = 0; d < 8; d++) if (slopes[d] > 0) delta[nbr[i * 8 + d]] += slopes[d] * k;
    }
    for (let i = 0; i < CELL_COUNT; i++) surface[i] += delta[i];
  }

  /**
   * Evaporation, the same from every square: from standing water if there
   * is any, otherwise from the top soil layer. Then standing water soaks into
   * the top layer, more slowly as it fills.
   */
  private evaporateAndSoak(): void {
    const { surface, soil } = this;
    const { evaporation, soilCap, infiltration } = this.p;
    const inv = 1 / soilCap;
    let up = 0;
    for (let i = 0; i < CELL_COUNT; i++) {
      let s = surface[i];
      let top = soil[i];
      if (s > 0) {
        const ev = s < evaporation ? s : evaporation;
        s -= ev;
        up += ev;
        const room = soilCap - top;
        if (room > 0 && s > 0) {
          const m = Math.min(s, infiltration * room * inv);
          s -= m;
          top += m;
        }
        surface[i] = s;
      } else if (top > 0) {
        const ev = top < evaporation ? top : evaporation;
        top -= ev;
        up += ev;
      }
      soil[i] = top;
    }
    this.cloud += up;
  }

  /**
   * Water moving up and down each soil column. It seeps down under gravity
   * (faster the wetter the layer above and the drier the one below), and
   * capillary pressure pulls it up toward a drier layer above. Water over a
   * layer's capacity is pushed up, and out of the top as a spring.
   */
  private soilColumns(): void {
    const { soil, surface, layers } = this;
    const { soilCap, percolation, capillary } = this.p;
    if (layers < 2) {
      for (let i = 0; i < CELL_COUNT; i++) {
        if (soil[i] > soilCap) {
          surface[i] += soil[i] - soilCap;
          soil[i] = soilCap;
        }
      }
      return;
    }
    const inv = 1 / soilCap;
    const N = CELL_COUNT;
    for (let i = 0; i < N; i++) {
      for (let l = 0; l < layers - 1; l++) {
        const a = l * N + i;
        const b = a + N;
        const sa = soil[a] * inv;
        const sb = soil[b] * inv;
        let f = percolation * sa * Math.max(0, 1 - sb) * soilCap; // down
        if (sb > sa) f -= capillary * (sb - sa) * soilCap; // up
        if (f > 0) f = Math.min(f, soil[a]);
        else f = Math.max(f, -soil[b]);
        soil[a] -= f;
        soil[b] += f;
      }
      // Anything over capacity is pushed upward; out of the top it's a spring.
      for (let l = layers - 1; l > 0; l--) {
        const a = l * N + i;
        if (soil[a] > soilCap) {
          soil[a - N] += soil[a] - soilCap;
          soil[a] = soilCap;
        }
      }
      if (soil[i] > soilCap) {
        surface[i] += soil[i] - soilCap;
        soil[i] = soilCap;
      }
    }
  }

  /**
   * Groundwater (the deepest layer) flows sideways toward lower ground,
   * driven by its head: the ground height plus how full the layer is. Water
   * gathers under valleys, fills their columns and comes up as springs.
   */
  private groundwater(): void {
    const { soil, gwFlux, layers } = this;
    const e = this.terrain.elevation;
    const k = this.p.groundFlow;
    if (k <= 0) return;
    const base = (layers - 1) * CELL_COUNT;
    const inv = 1 / this.p.soilCap;
    const W = GRID_W;
    for (let i = 0; i < CELL_COUNT; i++) {
      const wa = soil[base + i];
      const ha = e[i] + wa * inv;
      const x = i % W;
      // Right and down neighbours (each edge once).
      for (let d = 0; d < 2; d++) {
        const j = d === 0 ? (x < W - 1 ? i + 1 : -1) : (i + W < CELL_COUNT ? i + W : -1);
        let f = 0;
        if (j >= 0) {
          const wb = soil[base + j];
          f = k * (ha - e[j] - wb * inv);
          if (f > 0) f = Math.min(f, wa * 0.24);
          else f = Math.max(f, -wb * 0.24);
        }
        gwFlux[i * 2 + d] = f;
      }
    }
    for (let i = 0; i < CELL_COUNT; i++) {
      let v = soil[base + i] - gwFlux[i * 2] - gwFlux[i * 2 + 1];
      if (i % W > 0) v += gwFlux[(i - 1) * 2];
      if (i >= W) v += gwFlux[(i - W) * 2 + 1];
      soil[base + i] = v;
    }
  }

  /**
   * Clouds are 3D Perlin noise: carried along by the wind (x, y) and slowly
   * changing shape as they go (time on the third axis). More cloud water
   * means more coverage.
   */
  private updateClouds(tick: number): void {
    const { cloudScale, cloudMorph } = this.p;
    const ox = this.wind.offsetX;
    const oy = this.wind.offsetY;
    // Shape-change progress accumulates, so changing cloudMorph never jumps.
    this.cloudTime += cloudMorph * (tick - this.cloudTick);
    this.cloudTick = tick;
    const z = this.cloudTime;
    const frac = this.cloud / this.total;
    const threshold = 0.3 - 1.8 * frac;
    let weight = 0;
    for (let cy = 0; cy < this.cloudH; cy++) {
      for (let cx = 0; cx < this.cloudW; cx++) {
        const x = cx * CLOUD_CELL;
        const y = cy * CLOUD_CELL;
        const n = this.perlin.fbm3((x - ox) * cloudScale, (y - oy) * cloudScale, z, 4);
        // Wide ramp so only the cores reach full thickness.
        const d = Math.max(0, Math.min(1, (n - threshold) / CLOUD_RAMP));
        this.cloudDensity[cy * this.cloudW + cx] = d;
        // Weight by the squares the block really covers (edge blocks can be partial).
        const bw = Math.min(CLOUD_CELL, GRID_W - x);
        const bh = Math.min(CLOUD_CELL, GRID_H - y);
        weight += d * d * bw * bh;
      }
    }
    this.cloudWeight = weight;
  }

  /**
   * Rain falls in proportion to cloud density squared, so it is heaviest
   * under the thickest cloud. Each event drops a random share of the cloud
   * water: mostly showers, occasionally a deluge that empties the sky. Its
   * rate builds up gradually from nothing to rainRate of all water per tick
   * (over rainRampTicks), and tapers off again over the last rainTaperShare
   * of what the event will drop. Thin clouds can only drop so much per
   * square, so rain also tapers as they vanish.
   */
  private rain(): void {
    const p = this.p;
    if (this.manual) {
      // Player-controlled: rain builds up when switched on and fades out when
      // switched off (or when the clouds run dry).
      if (this.manualRain && this.cloud > 0 && (!this.raining || this.rainEnding)) {
        this.raining = true;
        this.rainEnding = false;
        this.rainAge = Math.round(this.rainFade * p.rainRampTicks); // pick up from how hard it's raining now
        this.rainFrom = this.cloud;
      } else if (this.raining && !this.rainEnding && (!this.manualRain || this.cloud <= 0)) this.endRain();
      this.rainTarget = 0;
    } else if (!this.raining) {
      // The fuller the clouds, the more likely rain is to start this tick.
      const frac = this.cloud / this.total;
      const x = (frac - p.rainMinCloud) / Math.max(0.01, p.rainStart - p.rainMinCloud);
      if (x > 0 && this.rng() < p.rainChance * x * x) {
        const u = this.rng();
        // Skewed: typically 15-40% of the clouds, about 1 in 12 empties them.
        const share = Math.min(1, p.rainMinShare + u * u);
        this.rainTarget = this.cloud * (1 - share);
        this.rainFrom = this.cloud;
        this.rainAge = 0;
        this.rainEnding = false;
        this.raining = true;
      }
    }
    this.lastRain = 0;
    if (!this.raining) return;

    const full = p.rainRate * this.total;
    const left = Math.max(0, this.cloud - this.rainTarget);
    let strength: number;
    if (this.rainEnding) {
      // Fading out from wherever it was, over half the build-up time.
      const fade = Math.max(1, p.rainRampTicks / 2);
      strength = this.rainEndFrom * Math.max(0, 1 - this.rainEndAge / fade);
      if (++this.rainEndAge >= fade || left <= 1e-9) {
        this.raining = this.rainEnding = false;
        return;
      }
    } else {
      // Building up at the start, tapering off over the last part of the event.
      this.rainAge++;
      const rampUp = Math.min(1, this.rainAge / Math.max(1, p.rainRampTicks));
      const size = Math.max(1e-9, this.rainFrom - this.rainTarget);
      const taper = this.manual ? 1 : Math.min(1, left / Math.max(1e-9, p.rainTaperShare * size));
      strength = rampUp * taper;
    }
    const want = full * strength;
    const amount = Math.min(want, left);
    const perCell = this.cloudWeight > 0 ? amount / this.cloudWeight : 0;
    const cap = p.rainMaxPerSquare;
    let fallen = 0;
    for (let cy = 0; cy < this.cloudH; cy++) {
      for (let cx = 0; cx < this.cloudW; cx++) {
        const d = this.cloudDensity[cy * this.cloudW + cx];
        if (d <= 0) continue;
        // Density squared: rain is concentrated under the thickest cloud.
        const r = Math.min(perCell, cap) * d * d;
        const bw = Math.min(CLOUD_CELL, GRID_W - cx * CLOUD_CELL);
        const bh = Math.min(CLOUD_CELL, GRID_H - cy * CLOUD_CELL);
        for (let dy = 0; dy < bh; dy++) {
          const row = (cy * CLOUD_CELL + dy) * GRID_W + cx * CLOUD_CELL;
          for (let dx = 0; dx < bw; dx++) this.surface[row + dx] += r;
        }
        fallen += r * bw * bh;
      }
    }
    this.cloud -= fallen;
    this.lastRain = fallen;
    // Near the end of the event, or once the clouds are too thin to keep it
    // up, it fades out (rather than stopping dead). The fade is time-limited,
    // so evaporation can't sustain an endless drizzle.
    if (!this.manual && !this.rainEnding && this.rainAge > 1 &&
        (strength < 0.05 && this.rainAge >= p.rainRampTicks || fallen < 0.5 * amount)) this.endRain();
  }

  /** Starts the rain fading out from how hard it's falling now. */
  private endRain(): void {
    const full = this.p.rainRate * this.total;
    this.rainEnding = true;
    this.rainEndAge = 0;
    this.rainEndFrom = full > 0 ? Math.min(1, this.lastRain / full) : 0;
  }


  /**
   * Rain tool: adds new water to the world, `amount` per square at the
   * centre of a circle of `radius` squares, falling off toward the edge.
   */
  addWater(cx: number, cy: number, radius: number, amount: number): void {
    this.brush(cx, cy, radius, (i, w) => {
      const a = amount * w;
      this.surface[i] += a;
      return a;
    }, 1);
  }

  /**
   * Dryer tool: removes water from the world under a circle: standing water
   * first, then the soil from the top layer down, up to `amount` per square
   * at the centre.
   */
  removeWater(cx: number, cy: number, radius: number, amount: number): void {
    this.brush(cx, cy, radius, (i, w) => {
      let want = amount * w;
      let got = Math.min(this.surface[i], want);
      this.surface[i] -= got;
      want -= got;
      for (let l = 0; l < this.layers && want > 0; l++) {
        const a = l * CELL_COUNT + i;
        const t = Math.min(this.soil[a], want);
        this.soil[a] -= t;
        want -= t;
        got += t;
      }
      return got;
    }, -1);
  }

  private brush(cx: number, cy: number, radius: number, f: (i: number, weight: number) => number, sign: 1 | -1): void {
    const r = Math.max(1, radius);
    let changed = 0;
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(GRID_H - 1, Math.ceil(cy + r)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(GRID_W - 1, Math.ceil(cx + r)); x++) {
        const d2 = ((x - cx) ** 2 + (y - cy) ** 2) / (r * r);
        if (d2 >= 1) continue;
        const i = y * GRID_W + x;
        changed += f(i, 1 - d2);
        const w = this.surface[i] >= this.p.waterDepthMin;
        this.wet[i] = w ? 1 : 0;
        this.sat[i] = w ? 1 : Math.min(1, this.soil[i] / this.p.soilCap);
      }
    }
    this.total += sign * changed;
  }

  /** Sum of surface, soil and cloud water (should always equal `total`). */
  measure(): { surface: number; soil: number; cloud: number; total: number } {
    let s = 0;
    let g = 0;
    for (let i = 0; i < CELL_COUNT; i++) s += this.surface[i];
    for (let k = 0; k < this.soil.length; k++) g += this.soil[k];
    return { surface: s, soil: g, cloud: this.cloud, total: s + g + this.cloud };
  }
}
