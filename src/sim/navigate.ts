import { GRID_H, GRID_W } from "./config";

/**
 * Route planning for the gardener, who walks on land, rows a boat on water,
 * and can carry the boat over land (slowly). The map is planned on a coarse
 * grid of NAV_CELL-square cells, in two layers: without the boat (land
 * only) and with it (land, carried, or water, rowed). The boat can only be
 * picked up in the cell where it lies, and can be put down on any land
 * cell. A shortest-time search over both layers finds routes like "walk to
 * the boat, carry it to the lake, row across, leave it on the far shore,
 * walk on".
 */
export const NAV_CELL = 3;

export interface Speeds {
  walk: number;
  row: number;
  carry: number;
  /** Swimming, without the boat: only to get out of water it's caught in. */
  swim: number;
}

/** One step of a route: a point to head for, and whether the boat comes along. */
export interface Waypoint {
  x: number;
  y: number;
  boat: boolean;
}

export class Navigator {
  readonly cw = Math.ceil(GRID_W / NAV_CELL);
  readonly ch = Math.ceil(GRID_H / NAV_CELL);
  /** 1 where a cell is mostly water. */
  private water = new Uint8Array(this.cw * this.ch);
  private dist = new Float64Array(this.cw * this.ch * 2);
  private prev = new Int32Array(this.cw * this.ch * 2);

  constructor(private isWater: (i: number) => boolean) {}

  /** Re-reads which cells are water (water levels change with rain). */
  refresh(): void {
    for (let cy = 0; cy < this.ch; cy++) {
      for (let cx = 0; cx < this.cw; cx++) {
        let wet = 0;
        let all = 0;
        for (let y = cy * NAV_CELL; y < Math.min(GRID_H, (cy + 1) * NAV_CELL); y++) {
          for (let x = cx * NAV_CELL; x < Math.min(GRID_W, (cx + 1) * NAV_CELL); x++) {
            all++;
            if (this.isWater(y * GRID_W + x)) wet++;
          }
        }
        this.water[cy * this.cw + cx] = wet * 2 > all ? 1 : 0;
      }
    }
  }

  cellOf(x: number, y: number): number {
    const cx = Math.max(0, Math.min(this.cw - 1, Math.floor(x / NAV_CELL)));
    const cy = Math.max(0, Math.min(this.ch - 1, Math.floor(y / NAV_CELL)));
    return cy * this.cw + cx;
  }

  isWaterCell(c: number): boolean {
    return this.water[c] === 1;
  }

  /**
   * Fastest route from (x, y) to (gx, gy). `hasBoat`: the boat is with it
   * now; otherwise it lies at (bx, by). Returns the waypoints (each saying
   * whether the boat comes along to it), or null if there's no way there.
   */
  plan(x: number, y: number, hasBoat: boolean, bx: number, by: number, gx: number, gy: number, sp: Speeds): Waypoint[] | null {
    const n = this.cw * this.ch;
    const dist = this.dist;
    const prev = this.prev;
    dist.fill(Infinity);
    prev.fill(-1);
    const start = this.cellOf(x, y) + (hasBoat ? n : 0);
    const boatCell = this.cellOf(bx, by);
    const goal = this.cellOf(gx, gy);
    const goalWater = this.water[goal] === 1;
    dist[start] = 0;
    const heap = new MinHeap();
    heap.push(start, 0);
    let found = -1;
    while (heap.size) {
      const [node, d] = heap.pop();
      if (d > dist[node]) continue;
      const withBoat = node >= n;
      const c = withBoat ? node - n : node;
      if (c === goal && (withBoat || !goalWater)) {
        found = node;
        break;
      }
      // Pick the boat up (only where it lies, and only if it wasn't with us to begin with).
      if (!withBoat && !hasBoat && c === boatCell) relax(node, c + n, d);
      // Put the boat down (on land).
      if (withBoat && this.water[c] === 0) relax(node, c, d);
      const cx = c % this.cw;
      const cy = (c / this.cw) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= this.cw || ny >= this.ch) continue;
          const nc = ny * this.cw + nx;
          const len = (dx && dy ? Math.SQRT2 : 1) * NAV_CELL;
          const wet = this.water[nc] === 1;
          if (!withBoat) {
            // Can't walk on water; caught in it (only ever at the start), it swims out.
            if (this.water[c] === 1) relax(node, nc, d + len / sp.swim);
            else if (!wet) relax(node, nc, d + len / sp.walk);
          } else {
            // Rowing over water; carrying the boat over land.
            const speed = wet && this.water[c] === 1 ? sp.row : wet || this.water[c] === 1 ? (sp.row + sp.carry) / 2 : sp.carry;
            relax(node, nc + n, d + len / speed);
          }
        }
      }
    }
    if (found < 0) return null;
    // Walk back from the goal to the start.
    const nodes: number[] = [];
    for (let k = found; k >= 0; k = prev[k]) nodes.push(k);
    nodes.reverse();
    const out: Waypoint[] = [];
    for (let k = 1; k < nodes.length; k++) {
      const node = nodes[k];
      const withBoat = node >= n;
      const c = withBoat ? node - n : node;
      out.push({ x: (c % this.cw) * NAV_CELL + NAV_CELL / 2, y: ((c / this.cw) | 0) * NAV_CELL + NAV_CELL / 2, boat: withBoat });
    }
    out.push({ x: gx, y: gy, boat: found >= n });
    return out;

    function relax(from: number, to: number, d: number): void {
      if (d < dist[to]) {
        dist[to] = d;
        prev[to] = from;
        heap.push(to, d);
      }
    }
  }
}

/** A small binary min-heap of (node, priority). */
class MinHeap {
  private nodes: number[] = [];
  private pri: number[] = [];
  get size(): number {
    return this.nodes.length;
  }
  push(node: number, p: number): void {
    const a = this.nodes;
    const b = this.pri;
    a.push(node);
    b.push(p);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (b[parent] <= b[i]) break;
      [a[i], a[parent]] = [a[parent], a[i]];
      [b[i], b[parent]] = [b[parent], b[i]];
      i = parent;
    }
  }
  pop(): [number, number] {
    const a = this.nodes;
    const b = this.pri;
    const top: [number, number] = [a[0], b[0]];
    const lastN = a.pop()!;
    const lastP = b.pop()!;
    if (a.length) {
      a[0] = lastN;
      b[0] = lastP;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && b[l] < b[m]) m = l;
        if (r < a.length && b[r] < b[m]) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        [b[i], b[m]] = [b[m], b[i]];
        i = m;
      }
    }
    return top;
  }
}
