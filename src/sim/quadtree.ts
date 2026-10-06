/**
 * A point quadtree for finding things near a position (used for sheep
 * collisions). Build it once a tick with `insert`, then `query` a circle.
 * Each node holds up to CAPACITY items before splitting into four.
 */
export interface Point {
  x: number;
  y: number;
}

const CAPACITY = 8;
const MAX_DEPTH = 10;

export class QuadTree<T extends Point> {
  private items: T[] = [];
  private kids: QuadTree<T>[] | null = null;

  constructor(
    private readonly x0: number,
    private readonly y0: number,
    private readonly x1: number,
    private readonly y1: number,
    private readonly depth = 0,
  ) {}

  insert(p: T): void {
    if (this.kids) {
      this.child(p).insert(p);
      return;
    }
    this.items.push(p);
    if (this.items.length > CAPACITY && this.depth < MAX_DEPTH) this.split();
  }

  /** Calls `f` for every item within `r` of (x, y). */
  query(x: number, y: number, r: number, f: (p: T) => void): void {
    // Skip this node if the circle's bounding box misses it.
    if (x + r < this.x0 || x - r > this.x1 || y + r < this.y0 || y - r > this.y1) return;
    if (this.kids) {
      for (const k of this.kids) k.query(x, y, r, f);
      return;
    }
    const r2 = r * r;
    for (const p of this.items) if ((p.x - x) ** 2 + (p.y - y) ** 2 <= r2) f(p);
  }

  private split(): void {
    const mx = (this.x0 + this.x1) / 2;
    const my = (this.y0 + this.y1) / 2;
    const d = this.depth + 1;
    this.kids = [
      new QuadTree<T>(this.x0, this.y0, mx, my, d),
      new QuadTree<T>(mx, this.y0, this.x1, my, d),
      new QuadTree<T>(this.x0, my, mx, this.y1, d),
      new QuadTree<T>(mx, my, this.x1, this.y1, d),
    ];
    for (const p of this.items) this.child(p).insert(p);
    this.items = [];
  }

  private child(p: Point): QuadTree<T> {
    const mx = (this.x0 + this.x1) / 2;
    const my = (this.y0 + this.y1) / 2;
    return this.kids![(p.x >= mx ? 1 : 0) + (p.y >= my ? 2 : 0)];
  }
}
