import { GRID_H, GRID_W, type Params } from "./config";
import type { Critter } from "./critters";
import { G_GERM } from "./genes";
import type { Rng } from "./rng";

/**
 * Algae spores: how algae breed. A spore drifts slowly through the water in
 * a wandering direction, bouncing off land, using no energy. Fish can't eat
 * it. When its genetic spore time (the algae's G_GERM gene) runs out it
 * settles as a new algae cell if its square is free water; if not, it dies
 * and its nutrients go back to the water. Spores near a shark get caught in its wake: their
 * direction swings toward the way the shark is heading.
 */
export interface Spore {
  x: number;
  y: number;
  heading: number;
  /** Ticks of drifting left before it settles (or dies). */
  left: number;
  /** Its genetic spore time, in ticks. */
  time: number;
  /** Nutrients and energy it carries into the new cell. */
  n: number;
  e: number;
  /** Genes of the algae it will grow into (already mutated from the parent's). */
  genes: Float32Array;
}

export interface SporeHost {
  p: Params;
  rng: Rng;
  nutrients: Float64Array;
  /** 1 where a square is water (read directly: it's checked several times per spore per tick). */
  wet: Uint8Array;
  /** Grows the spore into algae on square i if it's free water; false if not. */
  settle(i: number, s: Spore): boolean;
  sharks(): readonly Critter[];
}

/** Shark lookup grid cell size, in squares. */
const CELL = 8;

export class SporeSystem {
  spores: Spore[] = [];
  private sharkCells = new Map<number, Critter[]>();
  /** Per CELL×CELL block: 1 if a shark is close enough to affect spores there. */
  private near = new Uint8Array(0);

  constructor(private host: SporeHost) {}

  release(x: number, y: number, genes: Float32Array, n: number, e: number): void {
    const time = Math.max(1, Math.round(genes[G_GERM]));
    this.spores.push({ x, y, heading: this.host.rng() * Math.PI * 2, left: time, time, n, e, genes });
  }

  step(): void {
    const h = this.host;
    const p = h.p;
    const rng = h.rng;
    this.bucketSharks();
    const speed = p.algaeSporeSpeed;
    const drift = p.algaeSporeDrift;
    const R = p.algaeSporeSharkRadius;
    const wet = h.wet;
    const W = GRID_W;
    const H = GRID_H;
    const water = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && wet[(y | 0) * W + (x | 0)] === 1;
    const list = this.spores;
    let kept = 0;
    for (let k = 0; k < list.length; k++) {
      const s = list[k];
      const here = (s.y | 0) * W + (s.x | 0);
      // Stranded by falling water: it dies where it lies.
      if (wet[here] !== 1) {
        h.nutrients[here] += s.n;
        continue;
      }
      // Wander, and swing toward the heading of a nearby shark (more strongly the closer it is).
      s.heading += (rng() - 0.5) * 2 * drift;
      if (R > 0) {
        const shark = this.nearestShark(s.x, s.y, R);
        if (shark) {
          const closeness = 1 - Math.hypot(shark.x - s.x, shark.y - s.y) / R;
          const d = Math.atan2(Math.sin(shark.heading - s.heading), Math.cos(shark.heading - s.heading));
          s.heading += d * p.algaeSporeSharkPull * closeness;
        }
      }
      // Move, bouncing off land (and the edges) one axis at a time.
      let vx = Math.cos(s.heading) * speed;
      let vy = Math.sin(s.heading) * speed;
      let bounced = false;
      if (!water(s.x + vx, s.y)) {
        vx = -vx;
        bounced = true;
      }
      if (water(s.x + vx, s.y)) s.x += vx;
      if (!water(s.x, s.y + vy)) {
        vy = -vy;
        bounced = true;
      }
      if (water(s.x, s.y + vy)) s.y += vy;
      if (bounced) s.heading = Math.atan2(vy, vx);

      // Time's up: settle as algae if the square is free water; otherwise it
      // dies (like a seed landing on an occupied square), its nutrients
      // going back to the water.
      if (--s.left <= 0) {
        const i = (s.y | 0) * W + (s.x | 0);
        if (!h.settle(i, s)) h.nutrients[i] += s.n;
        continue;
      }
      list[kept++] = s;
    }
    list.length = kept;
  }

  /** Destructor tool: removes spores within r of (x, y), returning their nutrients to the water. */
  removeWithin(x: number, y: number, r: number): void {
    const r2 = r * r;
    this.spores = this.spores.filter((s) => {
      if ((s.x - x) ** 2 + (s.y - y) ** 2 > r2) return true;
      this.host.nutrients[Math.floor(s.y) * GRID_W + Math.floor(s.x)] += s.n;
      return false;
    });
  }

  energyTotal(): number {
    let e = 0;
    for (const s of this.spores) e += s.e;
    return e;
  }

  nutrientTotal(): number {
    let n = 0;
    for (const s of this.spores) n += s.n;
    return n;
  }

  private bucketSharks(): void {
    this.sharkCells.clear();
    const cw = Math.ceil(GRID_W / CELL);
    const ch = Math.ceil(GRID_H / CELL);
    if (this.near.length !== cw * ch) this.near = new Uint8Array(cw * ch);
    else this.near.fill(0);
    const reach = Math.ceil(this.host.p.algaeSporeSharkRadius / CELL);
    for (const c of this.host.sharks()) {
      if (!c.alive) continue;
      const bx = Math.floor(c.x / CELL);
      const by = Math.floor(c.y / CELL);
      const key = bx * 4096 + by;
      let b = this.sharkCells.get(key);
      if (!b) this.sharkCells.set(key, (b = []));
      b.push(c);
      // Mark the cells whose spores could be within reach of this shark.
      for (let y = Math.max(0, by - reach); y <= Math.min(ch - 1, by + reach); y++) {
        for (let x = Math.max(0, bx - reach); x <= Math.min(cw - 1, bx + reach); x++) this.near[y * cw + x] = 1;
      }
    }
  }

  private nearestShark(x: number, y: number, r: number): Critter | null {
    // Most spores are nowhere near a shark: one array read rules them out.
    if (!this.near[Math.floor(y / CELL) * Math.ceil(GRID_W / CELL) + Math.floor(x / CELL)]) return null;
    const reach = Math.ceil(r / CELL);
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    let best: Critter | null = null;
    let bestD = r * r;
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dy = -reach; dy <= reach; dy++) {
        const b = this.sharkCells.get((cx + dx) * 4096 + cy + dy);
        if (!b) continue;
        for (const c of b) {
          const d = (c.x - x) ** 2 + (c.y - y) ** 2;
          if (d < bestD) {
            bestD = d;
            best = c;
          }
        }
      }
    }
    return best;
  }
}
