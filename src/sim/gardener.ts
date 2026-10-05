import { GRID_H, GRID_W } from "./config";
import { CritterSystem, type Critter } from "./critters";
import { NAV_CELL, Navigator, type Waypoint } from "./navigate";
import type { SeedPack, World } from "./world";

/**
 * The gardener: a person who roams the world trying to keep every species
 * alive. They see the whole map and every population, and every so often
 * choose what to do next from a short list of concrete options the game
 * works out for them (eat, cull a predator or an over-abundant species,
 * move an animal to safety or to a mate, carry seeds to bare ground,
 * wander). They judge for themselves which populations are rare, from
 * what they've seen of each over time. Rocs are sacred: they never hunt,
 * cull or handle them (though they'll cull cats to protect them). The choice is made either by built-in rules (scoring each
 * option) or by a tiny language model running in the browser (see
 * brain.worker.ts), which gets the same situation and options as text.
 *
 * They walk fast on land, row a boat on water (leaving it on the shore when
 * they land), and can carry the boat over land, slowly. They eat anything
 * but spores: plants, seeds, algae, or animals they spear. They burn fat
 * walking and living, and die if it runs out.
 */

export type Task =
  | { kind: "goto"; x: number; y: number }
  | { kind: "eatPlants"; x: number; y: number }
  | { kind: "hunt"; sys: CritterSystem; target: Critter }
  | { kind: "cull"; sys: CritterSystem; target: Critter }
  | { kind: "move"; sys: CritterSystem; target: Critter; tx: number; ty: number }
  | { kind: "sow"; fx: number; fy: number; tx: number; ty: number };

export interface GardenerOption {
  text: string;
  /** How good the built-in rules think it is. */
  utility: number;
  task: Task;
}

/** What a language-model brain is asked: a system message, the situation and the numbered options. */
export interface GardenerPrompt {
  system: string;
  user: string;
  count: number;
}

/** Asks an outside brain to pick an option (1-based answer), or null if it can't. */
export type Chooser = (p: GardenerPrompt) => Promise<number | null>;

interface Species {
  name: string;
  plural: string;
  sys: CritterSystem;
  water: boolean;
  /** Never hunted, culled or carried (rocs are sacred). */
  sacred: boolean;
}

/** How the gardener rates a population, from what they've seen of it. */
export type Judgement = "gone" | "rare" | "ok" | "plentiful" | "too many";

/**
 * What the gardener remembers of a population (a species, grass or algae):
 * the most they've seen (slowly forgotten), the usual number (a long
 * running average), and the usual food per head.
 */
interface Memory {
  peak: number;
  usual: number;
  food: number;
  n: number;
  foodNow: number;
}

const OBSERVE_EVERY = 100; // ticks between looking over the populations
const PEAK_FADE = 0.995; // per look: the remembered peak fades by half in about 14,000 ticks
const USUAL_RATE = 0.02; // per look: the usual number follows the count over about 5,000 ticks

const BLOCK = 20; // squares per side of the blocks the gardener judges the map by

export class Gardener {
  x: number;
  y: number;
  heading = 0;
  fat: number;
  nutrients: number;
  alive = true;
  age = 0;
  /** The boat is with them (being rowed or carried); otherwise it lies at (boatX, boatY). */
  hasBoat = false;
  boatX: number;
  boatY: number;
  boatHeading = 0;
  task: Task | null = null;
  /** Stage within a task: e.g. catching then carrying, collecting then sowing. */
  stage = 0;
  /** What they're doing right now, in words. */
  status = "looking around";
  /** The current task's description (the chosen option's text). */
  doing = "";
  carried: { sys: CritterSystem; c: Critter } | null = null;
  seeds: SeedPack[] = [];
  carcass: { x: number; y: number; fat: number; nutrients: number } | null = null;
  /** A spear in flight (for drawing), and ticks before the next throw. */
  spear: { x0: number; y0: number; x1: number; y1: number; t: number; hit: boolean } | null = null;
  private spearRest = 0;
  private route: Waypoint[] = [];
  private routeGoal = { x: -1, y: -1 };
  private replanIn = 0;
  private decideIn = 0;
  private taskAge = 0;
  /** How pressing the current task seemed when they took it on. */
  private current = 0;
  /** Animals that got away from them (by species and id), with when they'll try again. */
  private escaped = new Map<string, number>();
  /** Places (route cells) they recently found no way to reach, with when they'll try again. */
  private unreachable = new Map<number, number>();
  private pending = false;
  private nav: Navigator;
  /** An outside brain (the language model); null means the built-in rules decide. */
  chooser: Chooser | null = null;
  /** What they remember of each population (fish, shark, sheep, cat, roc, grass, algae). */
  readonly memory = new Map<string, Memory>();
  /** Recent decisions, newest last. */
  log: Array<{ tick: number; text: string; by: string }> = [];

  constructor(private w: World, x: number, y: number, nutrients: number) {
    this.x = x;
    this.y = y;
    this.boatX = x;
    this.boatY = y;
    this.fat = w.p.gardenerStartFat;
    this.nutrients = nutrients;
    this.nav = new Navigator((i) => w.water.isWater(i));
    this.nav.refresh();
    this.observe();
  }

  // ---------------------------------------------------------------------
  // Each tick

  step(): void {
    if (!this.alive) return;
    const p = this.w.p;
    this.age++;
    if (this.age % OBSERVE_EVERY === 0) this.observe();
    if (this.spear && --this.spear.t <= 0) this.spear = null;
    if (this.spearRest > 0) this.spearRest--;
    if (this.hasBoat) {
      this.boatX = this.x;
      this.boatY = this.y;
      this.boatHeading = this.heading;
    }

    // A boat left where the water has risen floats off and washes up on the nearest shore.
    if (!this.hasBoat && this.age % 20 === 0 && this.nav.isWaterCell(this.nav.cellOf(this.boatX, this.boatY))) {
      const shore = this.nearestLand(this.boatX, this.boatY);
      if (shore) {
        this.boatX = shore.x;
        this.boatY = shore.y;
      }
    }

    // Living costs fat; it sheds a little of its nutrients like any animal.
    this.fat -= p.gardenerUpkeep;
    const here = this.square();
    const shed = this.nutrients * 0.0002;
    this.nutrients -= shed;
    this.w.nutrients[here] += shed;
    if (this.fat <= 0) {
      this.die();
      return;
    }

    // Caught in water without the boat and with nowhere to go (a flood): swim for the nearest land.
    if (!this.hasBoat && this.inWater() && !this.task) {
      this.status = "swimming for the shore";
      const shore = this.nearestLand();
      if (shore) this.moveToward(shore.x, shore.y, p.gardenerSwimSpeed);
      return;
    }

    // Starving: drop whatever it's doing to eat (letting go of anything it carries).
    if (this.fat < 0.15 * p.gardenerMaxFat && this.task && this.task.kind !== "eatPlants" && this.task.kind !== "hunt") {
      this.dropEverything();
      this.task = null;
    }

    // A task that drags on too long is given up; a chase sooner (the animal
    // got away, and they'll leave it be for a while).
    if (this.task) {
      this.taskAge++;
      const t = this.task;
      const chasing = "target" in t && !this.carried && !this.carcass;
      if (chasing && this.taskAge > 0.4 * p.gardenerGiveUp) {
        this.log.push({ tick: this.w.tick, text: `The ${t.sys.species.name} got away; gave up the chase.`, by: "" });
        this.escaped.set(`${t.sys.species.name}#${t.target.id}`, this.w.tick + 3000);
        this.finish();
      } else if (this.taskAge > p.gardenerGiveUp) {
        this.log.push({ tick: this.w.tick, text: "Took too long; gave up.", by: "" });
        this.dropEverything();
        this.finish();
      }
    }
    // Decide what to do next: when idle, or every so often while wandering. In
    // the middle of something else (hands free), they still look up every so
    // often and change plans if something much more pressing has come up.
    this.decideIn--;
    if (!this.pending && this.decideIn <= 0) {
      if (!this.task || this.task.kind === "goto") this.decide();
      else if (!this.carried && !this.carcass) this.decide(this.current * 1.5 + 0.5);
      else this.decideIn = p.gardenerDecideInterval;
    }

    if (this.task) this.perform(this.task);
    else this.status = this.pending ? "thinking" : "looking around";
  }

  private perform(t: Task): void {
    const p = this.w.p;
    switch (t.kind) {
      case "goto": {
        this.status = "walking";
        if (this.travel(t.x, t.y)) this.finish();
        return;
      }
      case "eatPlants": {
        if (this.fat > 0.9 * p.gardenerMaxFat) return this.finish();
        if (this.stage === 0) {
          this.status = "going to eat";
          if (!this.travel(t.x, t.y, 3)) return;
          this.stage = 1;
        }
        // Graze from plant to plant around there.
        const i = this.nearestFlora(BLOCK / 2);
        if (i < 0) return this.finish();
        const px = (i % GRID_W) + 0.5;
        const py = Math.floor(i / GRID_W) + 0.5;
        if (Math.hypot(px - this.x, py - this.y) > 1.5) {
          this.status = "walking to the next plant";
          this.travel(px, py, 1.5);
          return;
        }
        this.status = "eating plants";
        const got = this.w.eatFlora(i);
        if (got) this.eat(got.e, got.n);
        return;
      }
      case "hunt":
      case "cull": {
        if (this.carcass) {
          // Go and eat what it speared.
          this.status = "going to eat its catch";
          if (this.travel(this.carcass.x, this.carcass.y, 1.5)) {
            this.eat(this.carcass.fat, this.carcass.nutrients);
            this.carcass = null;
            this.finish();
          }
          return;
        }
        const c = t.target;
        if (!c.alive) return this.finish();
        const d = Math.hypot(c.x - this.x, c.y - this.y);
        if (d <= p.gardenerSpearRange && !c.flying) {
          this.status = t.kind === "hunt" ? "throwing a spear (to eat)" : "throwing a spear (to cull)";
          if (this.spearRest === 0) this.throwSpear(t);
          return;
        }
        this.status = t.kind === "hunt" ? "hunting" : "stalking to cull";
        this.travel(c.x, c.y, Math.max(1, p.gardenerSpearRange * 0.7));
        return;
      }
      case "move": {
        if (!this.carried) {
          const c = t.target;
          if (!c.alive) return this.finish();
          this.status = `catching a ${t.sys.species.name}`;
          if (Math.hypot(c.x - this.x, c.y - this.y) < 1.5 && !c.flying) {
            t.sys.lift(c);
            this.carried = { sys: t.sys, c };
          } else this.travel(c.x, c.y, 1);
          return;
        }
        this.status = `carrying a ${t.sys.species.name}`;
        if (this.travel(t.tx, t.ty, 1.5)) {
          this.releaseCarried();
          this.finish();
        }
        return;
      }
      case "sow": {
        if (this.stage === 0) {
          this.status = "collecting seeds";
          if (!this.travel(t.fx, t.fy, 2)) return;
          const i = this.nearestKind(6, (k) => k === 1);
          const pack = i >= 0 && this.seeds.length < 25 ? this.w.takeSeed(i) : null;
          if (pack) this.seeds.push(pack);
          else if (!this.seeds.length) return this.finish();
          else this.stage = 1;
          return;
        }
        this.status = "sowing seeds";
        if (!this.travel(t.tx, t.ty, 2)) return;
        const pack = this.seeds[this.seeds.length - 1];
        const i = this.nearestKind(5, (k, j) => k === 0 && !this.w.water.isWater(j));
        if (i >= 0 && this.w.plantSeed(i, pack)) this.seeds.pop();
        else {
          // Nowhere left to sow: the rest go back into the ground here.
          for (const s of this.seeds) this.w.nutrients[this.square()] += s.n;
          this.seeds = [];
        }
        if (!this.seeds.length) this.finish();
        return;
      }
    }
  }

  private throwSpear(t: Extract<Task, { kind: "hunt" | "cull" }>): void {
    const p = this.w.p;
    const c = t.target;
    const hit = this.w.rng() < p.gardenerSpearHit;
    this.spear = { x0: this.x, y0: this.y, x1: c.x, y1: c.y, t: 12, hit };
    this.spearRest = 60;
    if (!hit) return;
    if (t.kind === "cull") {
      t.sys.cull(c);
      this.finish();
    } else {
      const got = t.sys.take(c);
      this.carcass = { x: c.x, y: c.y, fat: got.fat, nutrients: got.nutrients };
    }
  }

  private eat(e: number, n: number): void {
    const p = this.w.p;
    this.fat = Math.min(p.gardenerMaxFat, this.fat + e * p.gardenerEfficiency);
    this.nutrients += n;
  }

  private finish(): void {
    this.task = null;
    this.stage = 0;
    this.route = [];
    this.decideIn = 0;
  }

  /** Sows the seeds they carry on empty land nearby; any left over go back into the ground. */
  private scatterSeeds(): void {
    while (this.seeds.length) {
      const i = this.nearestKind(6, (k, j) => k === 0 && !this.w.water.isWater(j));
      if (i < 0 || !this.w.plantSeed(i, this.seeds[this.seeds.length - 1])) break;
      this.seeds.pop();
    }
    for (const s of this.seeds) this.w.nutrients[this.square()] += s.n;
    this.seeds = [];
  }

  /** Puts down whatever it carries: the animal goes free, seeds back into the ground, the catch is left. */
  private dropEverything(): void {
    if (this.carried) this.releaseCarried();
    for (const s of this.seeds) this.w.nutrients[this.square()] += s.n;
    this.seeds = [];
    if (this.carcass) {
      this.w.nutrients[Math.floor(this.carcass.y) * GRID_W + Math.floor(this.carcass.x)] += this.carcass.nutrients;
      this.carcass = null;
    }
  }

  /** Lets the carried animal go at the nearest square of its habitat. */
  private releaseCarried(): void {
    const { sys, c } = this.carried!;
    this.carried = null;
    const water = sys.species.habitat === "water";
    let best: { x: number; y: number } | null = null;
    for (let r = 0; r <= 8 && !best; r++) {
      for (let k = 0; k < 16 && !best; k++) {
        const a = (k / 16) * Math.PI * 2;
        const x = this.x + Math.cos(a) * r;
        const y = this.y + Math.sin(a) * r;
        if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) continue;
        if (this.w.water.isWater(Math.floor(y) * GRID_W + Math.floor(x)) === water) best = { x, y };
      }
    }
    sys.release(c, best?.x ?? this.x, best?.y ?? this.y);
  }

  private die(): void {
    this.dropEverything();
    this.w.nutrients[this.square()] += this.nutrients;
    this.nutrients = 0;
    this.alive = false;
    this.task = null;
    this.status = "died of hunger";
    this.log.push({ tick: this.w.tick, text: "Died of hunger.", by: "" });
  }

  // ---------------------------------------------------------------------
  // Getting around

  /**
   * Heads for (gx, gy) along a planned route (replanned now and then, and
   * when the goal moves). True once within `near` squares.
   */
  private travel(gx: number, gy: number, near = 1): boolean {
    if (Math.hypot(gx - this.x, gy - this.y) <= near) return true;
    const p = this.w.p;
    const moved = Math.hypot(gx - this.routeGoal.x, gy - this.routeGoal.y) > 3;
    if (!this.route.length || moved || --this.replanIn <= 0) {
      this.nav.refresh();
      const route = this.nav.plan(this.x, this.y, this.hasBoat, this.boatX, this.boatY, gx, gy, this.speeds());
      if (!route) {
        this.log.push({ tick: this.w.tick, text: "Couldn't find a way there; gave up.", by: "" });
        // Remember not to try for there again for a while.
        this.unreachable.set(this.nav.cellOf(gx, gy), this.w.tick + 1500);
        this.finish();
        this.decideIn = 60;
        return false;
      }
      this.route = route;
      this.routeGoal = { x: gx, y: gy };
      this.replanIn = 90;
    }
    const wp = this.route[0];
    // Boarding or leaving the boat as the route says.
    if (wp.boat && !this.hasBoat) {
      if (Math.hypot(this.boatX - this.x, this.boatY - this.y) < NAV_CELL * 2.5) this.hasBoat = true;
      else {
        this.route = [];
        return false;
      }
    } else if (!wp.boat && this.hasBoat && !this.w.water.isWater(this.square())) {
      this.hasBoat = false;
      this.boatX = this.x;
      this.boatY = this.y;
    }
    const onWater = this.w.water.isWater(this.square());
    const speed = this.hasBoat ? (onWater ? p.gardenerRowSpeed : p.gardenerCarrySpeed) : this.inWater() ? p.gardenerSwimSpeed : p.gardenerWalkSpeed;
    if (this.moveToward(wp.x, wp.y, speed)) this.route.shift();
    return Math.hypot(gx - this.x, gy - this.y) <= near;
  }

  /** One tick of movement toward (x, y) at `speed`, paying for it in fat. True on arrival. */
  private moveToward(x: number, y: number, speed: number): boolean {
    const p = this.w.p;
    const dx = x - this.x;
    const dy = y - this.y;
    const d = Math.hypot(dx, dy);
    const step = Math.min(d, speed);
    if (d > 1e-6) {
      this.heading = Math.atan2(dy, dx);
      this.x += (dx / d) * step;
      this.y += (dy / d) * step;
    }
    // ½·m·v², more when carrying the boat; swimming is hard work for its speed.
    const mass = p.gardenerMass * (this.hasBoat ? (this.w.water.isWater(this.square()) ? 1 : 2) : this.inWater() ? 20 : 1);
    this.fat -= p.gardenerMoveCost * 0.5 * mass * step * step;
    if (this.hasBoat) {
      this.boatX = this.x;
      this.boatY = this.y;
    }
    return d <= speed;
  }

  private speeds() {
    const p = this.w.p;
    return { walk: p.gardenerWalkSpeed, row: p.gardenerRowSpeed, carry: p.gardenerCarrySpeed, swim: p.gardenerSwimSpeed };
  }

  /** In open water (not just wading through a puddle or a stream). */
  private inWater(): boolean {
    return this.w.water.isWater(this.square()) && this.nav.isWaterCell(this.nav.cellOf(this.x, this.y));
  }

  private square(): number {
    return squareAt(this.x, this.y);
  }

  private nearestLand(fx = this.x, fy = this.y): { x: number; y: number } | null {
    for (let r = 1; r <= 40; r++) {
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        const x = fx + Math.cos(a) * r;
        const y = fy + Math.sin(a) * r;
        if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) continue;
        if (!this.w.water.isWater(squareAt(x, y))) return { x, y };
      }
    }
    return null;
  }

  /** Nearest square within r with something it can eat (grass, seed, or algae if it has its boat there). */
  private nearestFlora(r: number): number {
    return this.nearestKind(r, (k) => k === 1 || k === 2 || (k === 3 && this.hasBoat));
  }

  private nearestKind(r: number, ok: (kind: number, i: number) => boolean): number {
    const cx = Math.floor(this.x);
    const cy = Math.floor(this.y);
    let best = -1;
    let bestD = Infinity;
    for (let y = Math.max(0, cy - r); y <= Math.min(GRID_H - 1, cy + r); y++) {
      for (let x = Math.max(0, cx - r); x <= Math.min(GRID_W - 1, cx + r); x++) {
        const i = y * GRID_W + x;
        if (!ok(this.w.kind[i], i)) continue;
        const d = (x + 0.5 - this.x) ** 2 + (y + 0.5 - this.y) ** 2;
        if (d < bestD && d <= r * r) {
          bestD = d;
          best = i;
        }
      }
    }
    return best;
  }

  // ---------------------------------------------------------------------
  // Deciding

  /**
   * Works out the options and picks one (or asks the outside brain to).
   * Mid-task, only options more pressing than `min` are considered; with
   * none, they carry on.
   */
  decide(min = -Infinity): void {
    const midTask = min > -Infinity;
    const opts = this.options().filter((o) => o.utility > min);
    this.decideIn = this.w.p.gardenerDecideInterval;
    if (!opts.length) return;
    if (midTask) for (const o of opts) o.text = `Change of plan: ${o.text[0].toLowerCase()}${o.text.slice(1)}`;
    // While the outside brain thinks, it carries on with what it was doing (or stands still).
    let best = 0;
    for (let k = 1; k < opts.length; k++) if (opts[k].utility > opts[best].utility) best = k;
    if (!this.chooser) {
      this.assign(opts[best], "rules");
      return;
    }
    this.pending = true;
    const prompt = this.prompt(opts);
    this.chooser(prompt).then(
      (k) => {
        this.pending = false;
        if (!this.alive) return;
        if (k !== null && k >= 1 && k <= opts.length) this.assign(opts[k - 1], "model");
        else this.assign(opts[best], "rules (the model gave no usable answer)");
      },
      () => {
        this.pending = false;
        if (this.alive) this.assign(opts[best], "rules (the model failed)");
      },
    );
  }

  private assign(o: GardenerOption, by: string): void {
    // A stale choice (its target has since died or been taken) is skipped.
    if ("target" in o.task && !o.task.target.alive) {
      this.decideIn = 0;
      return;
    }
    if (this.carried || this.carcass) return; // picked something up while the model thought
    if (this.seeds.length) this.scatterSeeds(); // changing plans: sow what they carry where they stand
    this.task = o.task;
    this.current = o.utility;
    this.taskAge = 0;
    this.stage = 0;
    this.route = [];
    this.doing = o.text;
    this.log.push({ tick: this.w.tick, text: o.text, by });
    if (this.log.length > 30) this.log.shift();
  }

  private species(): Species[] {
    const w = this.w;
    return [
      { name: "fish", plural: "fish", sys: w.fish, water: true, sacred: false },
      { name: "shark", plural: "sharks", sys: w.sharks, water: true, sacred: false },
      { name: "sheep", plural: "sheep", sys: w.sheep, water: false, sacred: false },
      { name: "cat", plural: "cats", sys: w.cats, water: false, sacred: false },
      { name: "roc", plural: "rocs", sys: w.rocs, water: false, sacred: true },
    ];
  }

  /**
   * Looks over every population and updates what they remember of it: the
   * most they've seen, the usual number, and the usual food per head.
   */
  private observe(): void {
    const w = this.w;
    let grass = 0, algae = 0;
    for (let i = 0; i < w.kind.length; i++) {
      if (w.kind[i] === 2) grass++;
      else if (w.kind[i] === 3) algae++;
    }
    const n = (s: CritterSystem) => s.critters.length;
    const counts: Array<[string, number, number]> = [
      // name, count, food in sight per head
      ["grass", grass, 0],
      ["algae", algae, 0],
      ["fish", n(w.fish), algae / Math.max(1, n(w.fish))],
      ["shark", n(w.sharks), (n(w.fish) + n(w.sheep)) / Math.max(1, n(w.sharks))],
      ["sheep", n(w.sheep), grass / Math.max(1, n(w.sheep))],
      ["cat", n(w.cats), (n(w.sheep) + n(w.rocs)) / Math.max(1, n(w.cats))],
      ["roc", n(w.rocs), (n(w.fish) + n(w.sheep)) / Math.max(1, n(w.rocs))],
    ];
    for (const [name, count, food] of counts) {
      const m = this.memory.get(name);
      if (!m) {
        this.memory.set(name, { peak: count, usual: count, food, n: count, foodNow: food });
        continue;
      }
      m.peak = Math.max(count, m.peak * PEAK_FADE);
      m.usual += (count - m.usual) * USUAL_RATE;
      m.food += (food - m.food) * USUAL_RATE;
      m.n = count;
      m.foodNow = food;
    }
  }

  /**
   * Their own view of a population: rare when it has fallen well below the
   * most they remember (or there are only a handful left), plentiful when
   * it's near that, too many when it's well above its usual number and its
   * food per head has fallen to under half of usual.
   */
  judge(name: string): Judgement {
    const m = this.memory.get(name);
    if (!m) return "ok";
    const share = this.w.p.gardenerRareShare;
    if (m.n === 0) return "gone";
    const plants = name === "grass" || name === "algae";
    if (m.n < share * m.peak || (!plants && m.n <= 3)) return "rare";
    if (!plants && m.n > 2 * m.usual && m.foodNow < 0.5 * m.food) return "too many";
    if (m.n >= Math.min(1, 2 * share) * m.peak) return "plentiful";
    return "ok";
  }

  /** How rare (0 = only just, 1 = nearly gone), by their own reckoning. */
  private rarity(name: string): number {
    const m = this.memory.get(name);
    if (!m || m.peak <= 0) return 0;
    return Math.max(0, Math.min(1, 1 - m.n / Math.max(4, this.w.p.gardenerRareShare * m.peak)));
  }

  /**
   * The options open to it now, each with a plain description, a score for
   * the built-in rules, and the task that carries it out. Uses what it can
   * see: every population, where each lives (by 20x20 blocks), and its own
   * fat and position.
   */
  options(): GardenerOption[] {
    const w = this.w;
    const p = w.p;
    const out: GardenerOption[] = [];
    const sp = this.species();
    const count = (s: Species) => s.sys.critters.length;
    const bw = Math.ceil(GRID_W / BLOCK);
    const bh = Math.ceil(GRID_H / BLOCK);
    const blocks = bw * bh;
    const blockOf = (x: number, y: number) => Math.min(bh - 1, Math.floor(y / BLOCK)) * bw + Math.min(bw - 1, Math.floor(x / BLOCK));
    const centre = (b: number) => ({ x: (b % bw) * BLOCK + BLOCK / 2, y: Math.floor(b / bw) * BLOCK + BLOCK / 2 });
    const distTo = (x: number, y: number) => Math.hypot(x - this.x, y - this.y);
    // Plants per block.
    const grass = new Float32Array(blocks), seeds = new Float32Array(blocks), algae = new Float32Array(blocks);
    const land = new Float32Array(blocks), wet = new Float32Array(blocks);
    let grassAll = 0, algaeAll = 0;
    for (let i = 0; i < w.kind.length; i++) {
      const b = blockOf(i % GRID_W, (i / GRID_W) | 0);
      const k = w.kind[i];
      if (k === 2) (grass[b]++, grassAll++);
      else if (k === 1) seeds[b]++;
      else if (k === 3) (algae[b]++, algaeAll++);
      if (!w.water.isWater(i)) {
        land[b]++;
        wet[b] += w.water.saturation(i);
      }
    }
    // Animals per block.
    const per = new Map<CritterSystem, Float32Array>();
    for (const s of sp) {
      const a = new Float32Array(blocks);
      for (const c of s.sys.critters) a[blockOf(c.x, c.y)]++;
      per.set(s.sys, a);
    }
    const byName = (n: string) => sp.find((s) => s.name === n)!;
    const nearestOf = (s: Species, x: number, y: number, ok: (c: Critter) => boolean = () => true) => {
      let best: Critter | null = null;
      let bd = Infinity;
      for (const c of s.sys.critters) {
        if (!ok(c) || (this.escaped.get(`${s.sys.species.name}#${c.id}`) ?? 0) > w.tick) continue;
        const d = (c.x - x) ** 2 + (c.y - y) ** 2;
        if (d < bd) (bd = d), (best = c);
      }
      return best;
    };
    const grounded = (c: Critter) => !c.flying;

    // 1. Eat.
    const share = this.fat / p.gardenerMaxFat;
    if (share < 0.7) {
      const need = share < 0.25 ? 8 : (0.7 - share) * 6;
      let bestB = -1, bestV = 0;
      for (let b = 0; b < blocks; b++) {
        const v = (grass[b] + seeds[b]) / (1 + distTo(centre(b).x, centre(b).y) / 40);
        if (v > bestV) (bestV = v), (bestB = b);
      }
      if (bestB >= 0) {
        const c = centre(bestB);
        out.push({ text: `Eat grass and seeds near (${c.x}, ${c.y}): ${grass[bestB] + seeds[bestB]} plants there`, utility: need, task: { kind: "eatPlants", x: c.x, y: c.y } });
      }
      for (const s of sp) {
        if (s.sacred || this.judge(s.name) !== "plentiful" && this.judge(s.name) !== "too many") continue; // never rocs, never what isn't plentiful
        const c = nearestOf(s, this.x, this.y, grounded);
        if (!c || distTo(c.x, c.y) > 100) continue;
        out.push({ text: `Hunt a ${s.name} near (${c.x | 0}, ${c.y | 0}) to eat (${s.plural} are plentiful: ${count(s)})`, utility: need * 0.9, task: { kind: "hunt", sys: s.sys, target: c } });
      }
    }

    // 2. Protect rare prey by culling what eats them (or, for rare plants, what grazes them).
    const eatenBy: Record<string, string[]> = { fish: ["shark", "roc"], sheep: ["cat", "roc"], roc: ["cat"] };
    for (const s of sp) {
      const n = count(s);
      if (this.judge(s.name) !== "rare") continue;
      for (const q of eatenBy[s.name] ?? []) {
        const pred = byName(q);
        if (pred.sacred) continue; // rocs are never touched, whatever they eat
        const pj = this.judge(pred.name);
        if (pj === "rare" || pj === "gone") continue;
        // The predator nearest to the rare species' biggest group.
        const dens = per.get(s.sys)!;
        let b = 0;
        for (let k = 1; k < blocks; k++) if (dens[k] > dens[b]) b = k;
        const c = nearestOf(pred, centre(b).x, centre(b).y, grounded);
        if (!c) continue;
        out.push({ text: `Cull a ${pred.name}: ${s.plural} are rare (${n}) and ${pred.plural} (${count(pred)}) eat them`, utility: 2 + 3 * this.rarity(s.name), task: { kind: "cull", sys: pred.sys, target: c } });
      }
    }
    const fishOk = ["plentiful", "too many"].includes(this.judge("fish"));
    const sheepOk = ["plentiful", "too many"].includes(this.judge("sheep"));
    if (this.judge("algae") === "rare" && fishOk) {
      const c = nearestOf(byName("fish"), this.x, this.y);
      if (c) out.push({ text: `Cull a fish: algae is rare (${algaeAll}) and fish (${count(byName("fish"))}) graze it`, utility: 1.5 + 2 * this.rarity("algae"), task: { kind: "cull", sys: byName("fish").sys, target: c } });
    }
    if (this.judge("grass") === "rare" && sheepOk) {
      const c = nearestOf(byName("sheep"), this.x, this.y);
      if (c) out.push({ text: `Cull a sheep: grass is rare (${grassAll}) and sheep (${count(byName("sheep"))}) graze it`, utility: 1.5 + 2 * this.rarity("grass"), task: { kind: "cull", sys: byName("sheep").sys, target: c } });
    }

    // 3. Curb a species that has outgrown its food.
    for (const s of sp) {
      const n = count(s);
      if (s.sacred || this.judge(s.name) !== "too many") continue;
      const usual = this.memory.get(s.name)!.usual;
      const c = nearestOf(s, this.x, this.y, grounded);
      if (c) out.push({ text: `Cull a ${s.name}: there are ${n}, far more than usual (${Math.round(usual)}), and too little food for them`, utility: 1 + Math.min(2, n / usual / 2 - 1), task: { kind: "cull", sys: s.sys, target: c } });
    }

    // 4. Bring lonely animals together so they can breed.
    for (const s of sp) {
      const n = count(s);
      if (s.sacred || n < 2 || n > 6) continue;
      let pair: [Critter, Critter] | null = null;
      let pd = Infinity;
      for (const a of s.sys.critters) {
        for (const b of s.sys.critters) {
          if (a === b || a.flying) continue;
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < pd) (pd = d), (pair = [a, b]);
        }
      }
      if (!pair || pd < 25) continue;
      const [a, b] = pair;
      out.push({ text: `Carry a lonely ${s.name} to another (only ${n} ${s.plural} left, ${pd | 0} squares apart)`, utility: 4.5, task: { kind: "move", sys: s.sys, target: a, tx: b.x, ty: b.y } });
    }

    // 5. Move a rare animal somewhere with food and no hunters.
    for (const s of sp) {
      const n = count(s);
      if (s.sacred || this.judge(s.name) !== "rare") continue;
      const hunters = (eatenBy[s.name] ?? []).map((q) => per.get(byName(q).sys)!);
      let bestB = -1, bestV = 0;
      for (let b = 0; b < blocks; b++) {
        if (hunters.some((h) => h[b] > 0)) continue;
        const habitat = s.water ? BLOCK * BLOCK - land[b] : land[b];
        if (habitat < BLOCK * BLOCK * 0.3) continue;
        const food = s.name === "fish" ? algae[b] : s.name === "sheep" ? grass[b] : s.name === "shark" ? per.get(byName("fish").sys)![b] * 20 : per.get(byName("sheep").sys)![b] * 20;
        if (food > bestV) (bestV = food), (bestB = b);
      }
      if (bestB < 0) continue;
      const dest = centre(bestB);
      const c = nearestOf(s, this.x, this.y, grounded);
      if (!c || Math.hypot(c.x - dest.x, c.y - dest.y) < BLOCK) continue;
      out.push({ text: `Move a ${s.name} to safer ground with food at (${dest.x}, ${dest.y}) (${s.plural}: ${n}, rare)`, utility: 1.5 + 2 * this.rarity(s.name), task: { kind: "move", sys: s.sys, target: c, tx: dest.x, ty: dest.y } });
    }

    // 6. Carry seeds from a seedy spot to bare, damp ground.
    {
      let from = -1, to = -1, fv = 4, tv = 0;
      // Within a morning's walk: both ends no more than 80 squares away.
      for (let b = 0; b < blocks; b++) {
        if (distTo(centre(b).x, centre(b).y) > 80) continue;
        if (seeds[b] > fv) (fv = seeds[b]), (from = b);
        if (land[b] > BLOCK * BLOCK * 0.6 && grass[b] < 5) {
          const v = wet[b] / land[b];
          if (v > tv) (tv = v), (to = b);
        }
      }
      if (from >= 0 && to >= 0 && from !== to) {
        const f = centre(from), t = centre(to);
        out.push({ text: `Carry seeds from (${f.x}, ${f.y}) to bare damp ground at (${t.x}, ${t.y}) (grass: ${grassAll})`, utility: 0.8 + (this.judge("grass") === "rare" ? 3 * this.rarity("grass") : 0), task: { kind: "sow", fx: f.x, fy: f.y, tx: t.x, ty: t.y } });
      }
    }

    // 7. Wander and watch.
    {
      // Somewhere on land (water only if it's easy to get to the boat).
      let x = 0, y = 0;
      for (let k = 0; k < 20; k++) {
        x = Math.floor(w.rng() * GRID_W);
        y = Math.floor(w.rng() * GRID_H);
        if (!w.water.isWater(y * GRID_W + x)) break;
      }
      out.push({ text: `Wander to (${x}, ${y}) and keep watch`, utility: 0.3, task: { kind: "goto", x, y } });
    }

    // Leave out anything they've lately found no way to reach.
    for (const [cell, until] of this.unreachable) if (until <= w.tick) this.unreachable.delete(cell);
    const reachable = (x: number, y: number) => !this.unreachable.has(this.nav.cellOf(x, y));
    const ok = out.filter(({ task: t }) => {
      switch (t.kind) {
        case "goto":
        case "eatPlants":
          return reachable(t.x, t.y);
        case "hunt":
        case "cull":
          return reachable(t.target.x, t.target.y);
        case "move":
          return reachable(t.target.x, t.target.y) && reachable(t.tx, t.ty);
        case "sow":
          return reachable(t.fx, t.fy) && reachable(t.tx, t.ty);
      }
    });
    ok.sort((a, b) => b.utility - a.utility);
    return ok.slice(0, 6);
  }

  /** The situation and options as text, for a language model. */
  prompt(opts: GardenerOption[]): GardenerPrompt {
    const p = this.w.p;
    const sp = this.species();
    const label = (name: string) => this.judge(name).toUpperCase();
    let grass = 0, algae = 0;
    for (const k of this.w.kind) {
      if (k === 2) grass++;
      else if (k === 3) algae++;
    }
    const pops = [`grass ${grass} (${label("grass")})`, `algae ${algae} (${label("algae")})`]
      .concat(sp.map((s) => `${s.plural} ${s.sys.critters.length} (${label(s.name)}${s.sacred ? ", sacred: never harm them" : ""})`)).join(", ");
    const fatPct = Math.round((100 * this.fat) / p.gardenerMaxFat);
    const me = `My fat: ${fatPct}% (${fatPct < 25 ? "starving - must eat" : fatPct < 50 ? "hungry" : "fine"}). Walking is cheap and fast; rowing is slower; carrying the boat over land is slow.`;
    return {
      system: "You are a gardener looking after a small world of grass, algae, fish, sharks, sheep, cats and rocs. Your goal: keep every species alive (none may die out) and stay alive yourself by eating. Rocs are sacred: never harm them. Pick the best next action. Reply with only its number.",
      user: `${me}\nPopulations: ${pops}.\nOptions:\n${opts.map((o, k) => `${k + 1}. ${o.text}`).join("\n")}\nBest option number:`,
      count: opts.length,
    };
  }

  /** Nutrients it holds, including anything it's carrying. */
  nutrientTotal(): number {
    let n = this.nutrients + (this.carcass ? this.carcass.nutrients : 0);
    for (const s of this.seeds) n += s.n;
    if (this.carried) n += CritterSystem.nutrientsIn(this.carried.c);
    return n;
  }

  /** Energy it holds (fat, plus a catch or seeds it carries). */
  energyTotal(): number {
    let e = Math.max(0, this.fat) + (this.carcass ? this.carcass.fat : 0);
    for (const s of this.seeds) e += s.e;
    return e;
  }

  /** Where the current task is heading (for drawing), or null. */
  aim(): { x: number; y: number } | null {
    const t = this.task;
    if (!t) return null;
    if (this.carcass) return this.carcass;
    switch (t.kind) {
      case "goto":
      case "eatPlants":
        return t;
      case "hunt":
      case "cull":
        return t.target;
      case "move":
        return this.carried ? { x: t.tx, y: t.ty } : t.target;
      case "sow":
        return this.stage === 0 ? { x: t.fx, y: t.fy } : { x: t.tx, y: t.ty };
    }
  }

  /** In words: walking, rowing, or carrying the boat. */
  mode(): string {
    if (!this.alive) return "dead";
    const onWater = this.w.water.isWater(this.square());
    if (onWater) return this.hasBoat ? "rowing" : this.inWater() ? "swimming" : "wading";
    return this.hasBoat ? "carrying the boat" : "on foot";
  }
}

function squareAt(x: number, y: number): number {
  const sx = Math.max(0, Math.min(GRID_W - 1, Math.floor(x)));
  const sy = Math.max(0, Math.min(GRID_H - 1, Math.floor(y)));
  return sy * GRID_W + sx;
}
