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
  /** Relative starting fertility (~0.2..1.8), used only to seed initial nutrients. */
  fertility: Float32Array;
}

export function generateTerrain(seed: number): Terrain {
  const { octaves } = TERRAIN;
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
  const span = MAX_HEIGHT - MIN_HEIGHT + 1;
  for (let i = 0; i < CELL_COUNT; i++) {
    const t = (raw[i] - lo) / (hi - lo);
    const e = Math.min(MAX_HEIGHT + 0.999, MIN_HEIGHT + t * span);
    const h = Math.floor(e);
    elevation[i] = e;
    height[i] = h;
  }

  const fertNoise = new Perlin(mulberry32(seed + 1));
  const fertility = new Float32Array(CELL_COUNT);
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const v = fertNoise.fbm(x * scale * 2, y * scale * 2, 3);
      fertility[y * GRID_W + x] = Math.max(0.2, Math.min(1.8, 1 + v * 2));
    }
  }

  return { seed, height, elevation, fertility };
}
