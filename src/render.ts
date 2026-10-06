import { CELL_COUNT, GRID_H, GRID_W, MAX_HEIGHT, MIN_HEIGHT, PARAMS } from "./sim/config";
import { G_HUE, G_WATER_PREF, GENE_COUNT } from "./sim/genes";
import { ALGAE, GRASS, SEED, type World } from "./sim/world";

export type View = "normal" | "nutrients" | "energy" | "moisture" | "height" | "waterpref";

// Water opacity at the minimum water depth and at depth >= WATER_ALPHA_DEPTH.
const WATER_ALPHA_SHALLOW = 0.3;
const WATER_ALPHA_DEEP = 0.85;
const WATER_ALPHA_DEPTH = 6;

/**
 * Draws the world at one pixel per grid square into an offscreen canvas;
 * the caller scales it up 2x (nearest neighbour) onto the visible canvas.
 */
export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private image: ImageData;
  private pixels: Uint32Array;
  // Static per-square ground colours (dry), computed once from the terrain.
  private groundR = new Float32Array(CELL_COUNT);
  private groundG = new Float32Array(CELL_COUNT);
  private groundB = new Float32Array(CELL_COUNT);

  constructor(private world: World) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = GRID_W;
    this.canvas.height = GRID_H;
    this.ctx = this.canvas.getContext("2d")!;
    this.image = this.ctx.createImageData(GRID_W, GRID_H);
    this.pixels = new Uint32Array(this.image.data.buffer);
    this.precompute();
  }

  private precompute(): void {
    const { height } = this.world.terrain;
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
      this.groundR[i] = r;
      this.groundG[i] = g;
      this.groundB[i] = b;
    }
  }

  draw(view: View): void {
    const w = this.world;
    const px = this.pixels;
    const { height } = w.terrain;
    const { surface, sat, wet, cloudDensity } = w.water;
    const p = PARAMS;
    const minDepth = p.waterDepthMin;
    const rainFade = w.water.rainFade;

    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        const i = y * GRID_W + x;
        let r: number, g: number, b: number;
        const k = w.kind[i];

        if (view === "normal" || view === "waterpref") {
          // Ground, darker the more saturated it is.
          const dark = 1 - 0.45 * sat[i];
          r = this.groundR[i] * dark; g = this.groundG[i] * dark; b = this.groundB[i] * dark;
          const depth = surface[i];
          if (wet[i]) {
            const a = WATER_ALPHA_SHALLOW + (WATER_ALPHA_DEEP - WATER_ALPHA_SHALLOW)
              * Math.min(1, (depth - minDepth) / (WATER_ALPHA_DEPTH - minDepth));
            r = r * (1 - a) + 28 * a;
            g = g * (1 - a) + 92 * a;
            b = b * (1 - a) + 178 * a;
            if (k === ALGAE) {
              // A cast of its inherited colour (dark green to burnt orange), stronger for bigger algae.
              const s = 0.08 + 0.22 * (w.floraN[i] / p.algaeMaxN);
              const hue = w.genes[i * GENE_COUNT + G_HUE];
              r = r * (1 - s) + (30 + 170 * hue) * s;
              g = g * (1 - s) + (110 - 20 * hue) * s;
              b = b * (1 - s) + (50 - 25 * hue) * s;
            }
          } else {
            if (k === GRASS) {
              const s = Math.min(1, w.floraN[i] / p.grassMaxN);
              const pref = w.genes[i * GENE_COUNT + G_WATER_PREF];
              if (view === "waterpref") {
                // Dry-lovers yellow/orange through to wet-lovers blue.
                r = 230 - 200 * pref; g = 170 + 40 * s - 40 * pref; b = 40 + 200 * pref;
              } else {
                // Its inherited colour: light orange through yellow and green
                // to turquoise; young plants paler, full-grown deeper, and a
                // little darker on wet ground.
                const shade = 1 - 0.2 * sat[i];
                const hue = 30 + 145 * w.genes[i * GENE_COUNT + G_HUE];
                [r, g, b] = hsl(hue, 0.55, 0.7 - 0.32 * s);
                r *= shade; g *= shade; b *= shade;
              }
            } else if (k === SEED) {
              r = r * 0.6 + 230 * 0.4;
              g = g * 0.6 + 210 * 0.4;
              b = b * 0.6 + 120 * 0.4;
            }
            if (depth > 0.003) {
              // Shallow running water (streams, run-off, puddles), over grass too.
              const a = Math.min(0.85, 0.45 + 0.4 * depth / minDepth);
              r = r * (1 - a) + 55 * a;
              g = g * (1 - a) + 125 * a;
              b = b * (1 - a) + 225 * a;
            }
          }
          // Clouds on top: white translucent, bilinear from the coarse cloud grid.
          if (view === "normal") {
            const c = cloudDensity.length ? w.water.cloudAt(x, y) : 0;
            if (c > 0.01) {
              const a = 0.65 * c; // thicker cloud is more opaque (and rains more)
              // Rain clouds grey gradually, most where they are thickest
              // (where the rain is heaviest).
              const shade = 245 - 80 * rainFade * c * c;
              r = r * (1 - a) + shade * a;
              g = g * (1 - a) + shade * a;
              b = b * (1 - a) + (shade + 8) * a;
            }
          }
        } else if (view === "nutrients") {
          const n = w.nutrients[i] + w.floraN[i];
          const v = Math.min(1, n / (wet[i] ? 0.5 : 1.2));
          r = 255 * v; g = 200 * v * v; b = wet[i] ? 120 : 20;
        } else if (view === "energy") {
          // Energy stored in the plant or algae on each square.
          const k2 = w.kind[i];
          const maxE = k2 === ALGAE ? p.algaeMaxE : p.grassMaxE;
          const v = k2 === 0 ? 0 : Math.min(1, w.floraE[i] / maxE);
          r = 40 + 215 * v; g = 35 + 195 * v; b = wet[i] ? 90 : 30;
        } else if (view === "moisture") {
          if (wet[i]) {
            const v = Math.min(1, surface[i] / WATER_ALPHA_DEPTH);
            r = 20; g = 90 - 60 * v; b = 200 - 80 * v;
          } else {
            const v = sat[i];
            r = 200 - 180 * v; g = 170 - 90 * v; b = 120 + 120 * v;
          }
        } else {
          const v = (height[i] - MIN_HEIGHT) / (MAX_HEIGHT - MIN_HEIGHT);
          r = g = b = 30 + 225 * v;
          if (wet[i]) b = 255;
        }

        px[i] = 0xff000000 | (clamp(b) << 16) | (clamp(g) << 8) | clamp(r);
      }
    }
    this.ctx.putImageData(this.image, 0, 0);
  }
}

function clamp(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

/** HSL (hue in degrees, saturation and lightness 0..1) to RGB 0..255. */
function hsl(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  return [(r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255];
}
