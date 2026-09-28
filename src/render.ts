import { CELL_COUNT, GRID_W, MAX_HEIGHT, MIN_HEIGHT, PARAMS } from "./sim/config";
import { ALGAE, GRASS, SEED, type World } from "./sim/world";

export type View = "normal" | "nutrients" | "energy" | "moisture" | "height";

/**
 * Draws the world at one pixel per grid square into an offscreen canvas;
 * the caller scales it up 2x (nearest neighbour) onto the visible canvas.
 */
export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private image: ImageData;
  private pixels: Uint32Array;
  // Static per-square colours, computed once from the terrain.
  private groundR = new Float32Array(CELL_COUNT);
  private groundG = new Float32Array(CELL_COUNT);
  private groundB = new Float32Array(CELL_COUNT);
  private waterAlpha = new Float32Array(CELL_COUNT);

  constructor(private world: World) {
    const { width, height } = { width: GRID_W, height: CELL_COUNT / GRID_W };
    this.canvas = document.createElement("canvas");
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext("2d")!;
    this.image = this.ctx.createImageData(width, height);
    this.pixels = new Uint32Array(this.image.data.buffer);
    this.precompute();
  }

  private precompute(): void {
    const { height, water, depth, moisture } = this.world.terrain;
    const span = MAX_HEIGHT - MIN_HEIGHT;
    for (let i = 0; i < CELL_COUNT; i++) {
      const h = height[i];
      const t = (h - MIN_HEIGHT) / span;
      // Earthy brown, lighter on higher ground.
      let r = 88 + t * 110;
      let g = 60 + t * 80;
      let b = 36 + t * 44;
      // Simple relief shading from the north-west neighbour.
      const nw = i - GRID_W - 1;
      if (nw >= 0 && i % GRID_W > 0) {
        const shade = 1 + (h - height[nw]) * 0.06;
        r *= shade; g *= shade; b *= shade;
      }
      // Saturated ground is darker.
      const wet = 1 - 0.45 * moisture[i];
      this.groundR[i] = r * wet;
      this.groundG[i] = g * wet;
      this.groundB[i] = b * wet;
      // Deeper water is more opaque (see WATER_* below to invert).
      this.waterAlpha[i] = water[i] ? WATER_ALPHA_SHALLOW + (WATER_ALPHA_DEEP - WATER_ALPHA_SHALLOW) * (depth[i] - 1) / 5 : 0;
    }
  }

  draw(view: View): void {
    const w = this.world;
    const px = this.pixels;
    const { water, moisture, height } = w.terrain;
    const p = PARAMS;

    for (let i = 0; i < CELL_COUNT; i++) {
      let r: number, g: number, b: number;

      if (view === "normal") {
        r = this.groundR[i]; g = this.groundG[i]; b = this.groundB[i];
        const k = w.kind[i];
        if (water[i]) {
          const a = this.waterAlpha[i];
          r = r * (1 - a) + 28 * a;
          g = g * (1 - a) + 92 * a;
          b = b * (1 - a) + 178 * a;
          if (k === ALGAE) {
            // Subtle green cast, stronger for bigger algae.
            const s = 0.05 + 0.13 * (w.floraN[i] / p.algaeMaxN);
            r = r * (1 - s) + 40 * s;
            g = g * (1 - s) + 150 * s;
            b = b * (1 - s) + 70 * s;
          }
        } else if (k === GRASS) {
          const s = Math.min(1, w.floraN[i] / p.grassMaxN);
          const wet = 1 - 0.2 * moisture[i];
          r = (170 - 130 * s) * wet;
          g = (200 - 70 * s) * wet;
          b = (80 - 50 * s) * wet;
        } else if (k === SEED) {
          r = r * 0.6 + 230 * 0.4;
          g = g * 0.6 + 210 * 0.4;
          b = b * 0.6 + 120 * 0.4;
        }
      } else if (view === "nutrients") {
        const n = w.nutrients[i] + w.floraN[i];
        const v = Math.min(1, n / (water[i] ? 0.5 : 1.2));
        r = 255 * v; g = 200 * v * v; b = water[i] ? 120 : 20;
      } else if (view === "energy") {
        const v = w.energy[i] / p.energyCap;
        r = 255 * v; g = 230 * v; b = water[i] ? 90 : 30;
      } else if (view === "moisture") {
        const v = moisture[i];
        r = water[i] ? 20 : 200 - 180 * v; g = water[i] ? 60 : 170 - 110 * v; b = water[i] ? 160 : 120 + 120 * v;
      } else {
        const v = (height[i] - MIN_HEIGHT) / (MAX_HEIGHT - MIN_HEIGHT);
        r = g = b = 30 + 225 * v;
        if (water[i]) b = 255;
      }

      px[i] = 0xff000000 | (clamp(b) << 16) | (clamp(g) << 8) | clamp(r);
    }
    this.ctx.putImageData(this.image, 0, 0);
  }
}

// Water opacity at depth 1 (shallowest) and depth 6 (deepest). Swap the two
// values to make deeper water *less* opaque instead.
const WATER_ALPHA_SHALLOW = 0.35;
const WATER_ALPHA_DEEP = 0.85;

function clamp(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}
