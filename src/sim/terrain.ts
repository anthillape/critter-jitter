import {
  CELL_COUNT, GRID_H, GRID_W, IRRIGATION_RANGE, MAX_HEIGHT, MIN_HEIGHT,
  NOISE_OCTAVES, NOISE_SCALE, WATER_LEVEL,
} from "./config";
import { Perlin } from "./perlin";
import { mulberry32 } from "./rng";

/** Static terrain: generated once from Perlin noise and never changed. */
export interface Terrain {
  seed: number;
  /** Ground height 1..16 per square. */
  height: Uint8Array;
  /**
   * Starting soil saturation 0..1: 1 in the initial lakes, falling off to 0
   * at IRRIGATION_RANGE. After that the water cycle (hydrology.ts) takes over.
   */
  moisture: Float32Array;
  /** Relative starting fertility (~0.2..1.8), used only to seed initial nutrients. */
  fertility: Float32Array;
}

export function generateTerrain(seed: number): Terrain {
  const perlin = new Perlin(mulberry32(seed));
  const raw = new Float32Array(CELL_COUNT);
  let lo = Infinity;
  let hi = -Infinity;
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const v = perlin.fbm(x * NOISE_SCALE, y * NOISE_SCALE, NOISE_OCTAVES);
      raw[y * GRID_W + x] = v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }

  const height = new Uint8Array(CELL_COUNT);
  const water = new Uint8Array(CELL_COUNT);
  const span = MAX_HEIGHT - MIN_HEIGHT + 1;
  for (let i = 0; i < CELL_COUNT; i++) {
    const t = (raw[i] - lo) / (hi - lo);
    const h = Math.min(MAX_HEIGHT, MIN_HEIGHT + Math.floor(t * span));
    height[i] = h;
    if (h <= WATER_LEVEL) water[i] = 1;
  }

  const waterDist = distanceToWater(water);
  const moisture = new Float32Array(CELL_COUNT);
  for (let i = 0; i < CELL_COUNT; i++) {
    const d = waterDist[i];
    const t = d > IRRIGATION_RANGE ? 0 : 1 - d / (IRRIGATION_RANGE + 1);
    moisture[i] = t * t; // falls off quickly near the shore, trickles out to 60 squares
  }

  const fertNoise = new Perlin(mulberry32(seed + 1));
  const fertility = new Float32Array(CELL_COUNT);
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const v = fertNoise.fbm(x * NOISE_SCALE * 2, y * NOISE_SCALE * 2, 3);
      fertility[y * GRID_W + x] = Math.max(0.2, Math.min(1.8, 1 + v * 2));
    }
  }

  return { seed, height, moisture, fertility };
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
