import {
  CELL_COUNT, GRID_H, GRID_W, MAX_HEIGHT, MIN_HEIGHT, TERRAIN,
} from "./config";
import { Perlin } from "./perlin";
import { mulberry32 } from "./rng";

/** Static terrain: generated once from Perlin noise and never changed. */
export interface Terrain {
  seed: number;
  /** Ground height 1..16 per square. */
  height: Uint8Array;
  /**
   * The same height before rounding to whole levels (1 <= e < 17, with
   * floor(e) = height). Water follows this, so it collects in valleys and
   * channels instead of spreading across flat terraces.
   */
  elevation: Float32Array;
  /** Neighbour (of 8) that run-off drains toward, or -1 in the starting lakes. */
  downhill: Int32Array;
  /**
   * Starting soil saturation 0..1: 1 in the initial lakes, falling off to 0
   * at TERRAIN.irrigationRange. After that the water cycle (hydrology.ts) takes over.
   */
  moisture: Float32Array;
  /** Relative starting fertility (~0.2..1.8), used only to seed initial nutrients. */
  fertility: Float32Array;
}

export function generateTerrain(seed: number): Terrain {
  const { waterLevel, irrigationRange, octaves } = TERRAIN;
  const scale = 1 / TERRAIN.landScale;
  const perlin = new Perlin(mulberry32(seed));
  const raw = new Float32Array(CELL_COUNT);
  let lo = Infinity;
  let hi = -Infinity;
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const v = perlin.fbm(x * scale, y * scale, octaves);
      raw[y * GRID_W + x] = v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }

  const height = new Uint8Array(CELL_COUNT);
  const elevation = new Float32Array(CELL_COUNT);
  const water = new Uint8Array(CELL_COUNT);
  const span = MAX_HEIGHT - MIN_HEIGHT + 1;
  for (let i = 0; i < CELL_COUNT; i++) {
    const t = (raw[i] - lo) / (hi - lo);
    const e = Math.min(MAX_HEIGHT + 0.999, MIN_HEIGHT + t * span);
    const h = Math.floor(e);
    elevation[i] = e;
    height[i] = h;
    if (h <= waterLevel) water[i] = 1;
  }

  const waterDist = distanceToWater(water);
  const moisture = new Float32Array(CELL_COUNT);
  for (let i = 0; i < CELL_COUNT; i++) {
    const d = waterDist[i];
    const t = d > irrigationRange ? 0 : 1 - d / (irrigationRange + 1);
    moisture[i] = t * t; // falls off quickly near the shore, trickles out to 60 squares
  }

  const fertNoise = new Perlin(mulberry32(seed + 1));
  const fertility = new Float32Array(CELL_COUNT);
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const v = fertNoise.fbm(x * scale * 2, y * scale * 2, 3);
      fertility[y * GRID_W + x] = Math.max(0.2, Math.min(1.8, 1 + v * 2));
    }
  }

  return { seed, height, elevation, downhill: drainage(elevation, water), moisture, fertility };
}

/**
 * Drainage directions for run-off. A priority flood from the lakes visits
 * land in order of rising elevation. Each square drains toward the
 * neighbour it was reached from, so every square has a route to a lake. The
 * routes merge into a branching network through the valleys, and small
 * hollows are crossed rather than trapping water.
 */
function drainage(elevation: Float32Array, lake: Uint8Array): Int32Array {
  const down = new Int32Array(CELL_COUNT).fill(-1);
  const seen = new Uint8Array(CELL_COUNT);
  const heap = new MinHeap();
  for (let i = 0; i < CELL_COUNT; i++) {
    if (lake[i]) {
      seen[i] = 1;
      heap.push(i, elevation[i]);
    }
  }
  while (heap.size > 0) {
    const [c, level] = heap.pop();
    const cx = c % GRID_W;
    const cy = (c / GRID_W) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx;
        const ny = cy + dy;
        if ((dx === 0 && dy === 0) || nx < 0 || ny < 0 || nx >= GRID_W || ny >= GRID_H) continue;
        const n = ny * GRID_W + nx;
        if (seen[n]) continue;
        seen[n] = 1;
        down[n] = c;
        // Filled level: never below the square it drains into.
        heap.push(n, Math.max(elevation[n], level + 1e-4));
      }
    }
  }
  return down;
}

/** Binary min-heap of square indices keyed by a float level. */
class MinHeap {
  private idx = new Int32Array(CELL_COUNT);
  private key = new Float32Array(CELL_COUNT);
  size = 0;
  push(i: number, k: number): void {
    let n = this.size++;
    while (n > 0) {
      const parent = (n - 1) >> 1;
      if (this.key[parent] <= k) break;
      this.idx[n] = this.idx[parent];
      this.key[n] = this.key[parent];
      n = parent;
    }
    this.idx[n] = i;
    this.key[n] = k;
  }
  pop(): [number, number] {
    const top: [number, number] = [this.idx[0], this.key[0]];
    const lastI = this.idx[--this.size];
    const lastK = this.key[this.size];
    let n = 0;
    for (;;) {
      let c = 2 * n + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.key[c + 1] < this.key[c]) c++;
      if (this.key[c] >= lastK) break;
      this.idx[n] = this.idx[c];
      this.key[n] = this.key[c];
      n = c;
    }
    this.idx[n] = lastI;
    this.key[n] = lastK;
    return top;
  }
}

/** Two-pass chamfer distance transform (approximately Euclidean). */
function distanceToWater(water: Uint8Array): Float32Array {
  const W = GRID_W;
  const H = GRID_H;
  const D = Math.SQRT2;
  const dist = new Float32Array(CELL_COUNT);
  for (let i = 0; i < CELL_COUNT; i++) dist[i] = water[i] ? 0 : 1e9;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let d = dist[i];
      if (x > 0) d = Math.min(d, dist[i - 1] + 1);
      if (y > 0) {
        d = Math.min(d, dist[i - W] + 1);
        if (x > 0) d = Math.min(d, dist[i - W - 1] + D);
        if (x < W - 1) d = Math.min(d, dist[i - W + 1] + D);
      }
      dist[i] = d;
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x;
      let d = dist[i];
      if (x < W - 1) d = Math.min(d, dist[i + 1] + 1);
      if (y < H - 1) {
        d = Math.min(d, dist[i + W] + 1);
        if (x < W - 1) d = Math.min(d, dist[i + W + 1] + D);
        if (x > 0) d = Math.min(d, dist[i + W - 1] + D);
      }
      dist[i] = d;
    }
  }
  return dist;
}
