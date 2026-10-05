import { GRID_H, GRID_W } from "./config";
import { CritterSystem, T_MAX_SPEED, type Critter } from "./critters";
import { NAV_CELL, Navigator, type Waypoint } from "./navigate";
import type { SeedPack, World } from "./world";
import { DIET, foodIn, predatorsOf, SPECIES_NAMES, suits, survey, type Region, type SpeciesName, type Survey } from "./survey";

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

/** How the gardener rates a population, from what they've seen of it. */
export type Judgement = "gone" | "rare" | "ok" | "plentiful" | "too many";

/** How a population is doing, by the gardener's reckoning. */
export interface Outlook {
  n: number;
  judgement: Judgement;
  /** Change per 1,000 ticks as a share of its recent average (-0.3 = falling 30%). */
  trend: number;
  /** Ticks until it's gone at its current rate, if it's falling (else Infinity). */
  goneIn: number;
  /** How badly it needs help: 0 not at all, up to about 5 when it's nearly gone and falling fast. */
  urgency: number;
  /** Doing well enough to spare some, to eat or cull (never rocs). */
  spare: boolean;
}

/**
 * What the gardener remembers of a population (a species, grass or algae):
 * the most they've seen (slowly forgotten), the usual number (a long
 * running average), recent counts (for its trend), and its usual food per
 * head world-wide (species only).
 */
interface Memory {
  peak: number;
  usual: number;
  food: number;
  history: number[];
}

const OBSERVE_EVERY = 100; // ticks between looking over the world
const PEAK_FADE = 0.995; // per look: the remembered peak fades by half in about 14,000 ticks
const USUAL_RATE = 0.02; // per look: the usual number follows the count over about 5,000 ticks
const HISTORY_LOOKS = 40; // counts remembered per population
const TREND_LOOKS = 20; // the trend is taken over the last 2,000 ticks

/** One route planner per world, shared by its gardeners (its water map is read at most once a tick). */
const navs = new WeakMap<World, Navigator>();
function sharedNavigator(w: World): Navigator {
  let n = navs.get(w);
  if (!n) {
    n = new Navigator((i) => w.water.isWater(i));
    navs.set(w, n);
  }
  return n;
}

const PLURAL: Record<SpeciesName, string> = { fish: "fish", shark: "sharks", sheep: "sheep", cat: "cats", roc: "rocs" };

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
  /** How their chases of each species have gone (caught or got away), to judge their odds. */
  private chases = new Map<string, { got: number; lost: number }>();
  /** Places (route cells) they recently found no way to reach, with when they'll try again. */
  private unreachable = new Map<number, number>();
  private pending = false;
  private nav: Navigator;
  /** An outside brain (the language model); null means the built-in rules decide. */
  chooser: Chooser | null = null;
  /** What they remember of each population (fish, shark, sheep, cat, roc, grass, algae). */
  readonly memory = new Map<string, Memory>();
  /** Their latest survey of the land masses and lakes. */
  view!: Survey;
  /** Recent decisions, newest last. */
  log: Array<{ tick: number; text: string; by: string }> = [];

  constructor(private w: World, x: number, y: number, nutrients: number, readonly name = "Gardener") {
    this.x = x;
    this.y = y;
    this.boatX = x;
    this.boatY = y;
    this.fat = w.p.gardenerStartFat;
    this.nutrients = nutrients;
    this.nav = sharedNavigator(w);
    this.nav.refresh(w.tick);
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
        this.chased(t.sys, false);
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
            this.chased(t.sys, true);
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
    this.chased(t.sys, true);
    if (t.kind === "cull") {
      t.sys.cull(c);
      this.finish();
    } else {
      const got = t.sys.take(c);
      this.carcass = { x: c.x, y: c.y, fat: got.fat, nutrients: got.nutrients };
    }
  }

  /** Remembers how a chase went (older chases count for less). */
  private chased(sys: CritterSystem, caught: boolean): void {
    const r = this.chases.get(sys.species.name) ?? { got: 0, lost: 0 };
    r.got = r.got * 0.9 + (caught ? 1 : 0);
    r.lost = r.lost * 0.9 + (caught ? 0 : 1);
    this.chases.set(sys.species.name, r);
  }

  /**
   * Their odds of catching (or getting a spear into) an animal: half from
   * how their own speed there (walking on land, rowing on water) compares
   * with its top speed, half from how their chases of its kind have gone.
   */
  odds(sys: CritterSystem, c: Critter): number {
    const p = this.w.p;
    const mine = sys.species.habitat === "water" ? p.gardenerRowSpeed : p.gardenerWalkSpeed;
    const speed = Math.max(0.1, Math.min(1, mine / (1.5 * c.traits[T_MAX_SPEED])));
    const r = this.chases.get(sys.species.name) ?? { got: 0, lost: 0 };
    return 0.5 * speed + 0.5 * ((r.got + 1) / (r.got + r.lost + 2));
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
      this.nav.refresh(this.w.tick);
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
    const cur = this.task;
    const same = (t: Task) => {
      if (!cur || t.kind !== cur.kind) return false;
      if ("target" in t && "target" in cur) return t.target === cur.target;
      const a = this.aimOf(t), b = this.aim();
      return !!a && !!b && Math.hypot(a.x - b.x, a.y - b.y) < 25;
    };
    const opts = this.options().filter((o) => o.utility > min && !(midTask && same(o.task)));
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

  /** Each species' critter system. */
  private sys(): Record<SpeciesName, CritterSystem> {
    const w = this.w;
    return { fish: w.fish, shark: w.sharks, sheep: w.sheep, cat: w.cats, roc: w.rocs };
  }

  /**
   * Every OBSERVE_EVERY ticks: counts every population, remembers it (the
   * most they've seen, the usual number, recent counts for the trend, the
   * usual food per head), and surveys the land masses and lakes.
   */
  private observe(): void {
    const w = this.w;
    this.view = survey(w, this.nav);
    let grass = 0, algae = 0;
    for (const r of this.view.regions) (grass += r.grass), (algae += r.algae);
    const n = (s: CritterSystem) => s.critters.length;
    const counts: Array<[string, number, number]> = [
      // name, count, food per head world-wide
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
        this.memory.set(name, { peak: count, usual: count, food, history: [count] });
        continue;
      }
      m.peak = Math.max(count, m.peak * PEAK_FADE);
      m.usual += (count - m.usual) * USUAL_RATE;
      if (count > 0) m.food += (food - m.food) * USUAL_RATE;
      m.history.push(count);
      if (m.history.length > HISTORY_LOOKS) m.history.shift();
    }
  }

  /**
   * How a population is doing, by their own reckoning: its trend (a
   * straight line through the last TREND_LOOKS counts), when it would be
   * gone at that rate, how rare it is against the most they remember, and
   * from that how urgently it needs help and whether it can spare some.
   */
  outlook(name: string): Outlook {
    const m = this.memory.get(name);
    if (!m) return { n: 0, judgement: "ok", trend: 0, goneIn: Infinity, urgency: 0, spare: false };
    const h = m.history.slice(-TREND_LOOKS);
    const n = h[h.length - 1];
    let slope = 0, mean = n;
    if (h.length >= 4) {
      const k = h.length;
      const mx = (k - 1) / 2;
      mean = h.reduce((a, b) => a + b, 0) / k;
      let num = 0, den = 0;
      for (let i = 0; i < k; i++) (num += (i - mx) * (h[i] - mean)), (den += (i - mx) ** 2);
      slope = num / den; // per look
    }
    const trend = (slope * (1000 / OBSERVE_EVERY)) / Math.max(1, mean);
    const goneIn = slope < 0 && n > 0 ? (n / -slope) * OBSERVE_EVERY : Infinity;
    const share = this.w.p.gardenerRareShare;
    const plant = name === "grass" || name === "algae";
    const foodNow = this.view ? this.foodPerHead(name) : m.food;
    let judgement: Judgement = "ok";
    if (n === 0) judgement = "gone";
    else if (n < share * m.peak || (!plant && n <= 3)) judgement = "rare";
    else if (!plant && foodNow < 0.5 * m.food && (n > 2 * m.usual || trend > 0.5)) judgement = "too many";
    else if (n >= Math.min(1, 2 * share) * m.peak) judgement = "plentiful";
    const rarity = m.peak > 0 ? Math.max(0, Math.min(1, 1 - n / Math.max(4, share * m.peak))) : 0;
    const urgency = n === 0 ? 0
      : 2 * rarity + (trend < 0 ? Math.min(2, -trend * 3) : 0) + (goneIn < 4000 ? 1.5 : goneIn < 10000 ? 0.7 : 0);
    const spare = name !== "roc" && (judgement === "plentiful" || judgement === "too many") && trend > -0.15 && goneIn > 15000;
    return { n, judgement, trend, goneIn, urgency, spare };
  }

  /** Food per head world-wide right now (species only). */
  private foodPerHead(name: string): number {
    const v = this.view;
    let food = 0, n = 0;
    for (const r of v.regions) {
      if (!(name in r.animals)) return 0;
      n += r.animals[name as SpeciesName];
      food += foodIn(r, name as SpeciesName);
    }
    return food / Math.max(1, n);
  }

  /** A population's state in words, e.g. "23, rare, falling 30% per 1,000 ticks (gone in ~3,000)". */
  outlookText(name: string): string {
    const o = this.outlook(name);
    if (o.n === 0) return "gone";
    const pct = Math.round(Math.abs(o.trend) * 100);
    const way = pct < 5 ? "steady" : o.trend < 0 ? `falling ${pct}% per 1,000 ticks` : `rising ${pct}% per 1,000 ticks`;
    const gone = o.goneIn < 20000 ? ` (gone in ~${(Math.round(o.goneIn / 500) * 500).toLocaleString()} ticks)` : "";
    return `${o.n.toLocaleString()}, ${o.judgement}, ${way}${gone}`;
  }

  /** The major land masses and lakes and what's in each, one line each. */
  regionLines(): string[] {
    if (!this.view) return [];
    return this.view.major.map((r) => {
      const life = SPECIES_NAMES.filter((s) => r.animals[s] > 0).map((s) => `${r.animals[s]} ${PLURAL[s]}`);
      const plants = r.water ? `${r.algae.toLocaleString()} algae` : `${r.grass.toLocaleString()} grass, ${r.seeds.toLocaleString()} seeds`;
      return `${r.name}, ${r.size.toLocaleString()} squares: ${[plants, ...life].join(", ")}`;
    });
  }

  /**
   * The options open to them now, each with a plain description, a score
   * for the built-in rules, and the task that carries it out. Worked out
   * from each population's total and trend, who eats what, and how plants
   * and animals are spread over the separate land masses and lakes.
   */
  options(): GardenerOption[] {
    const w = this.w;
    const p = w.p;
    this.view = survey(w, this.nav);
    const v = this.view;
    const others = w.gardeners.filter((g) => g !== this && g.alive);
    const out: GardenerOption[] = [];
    const sys = this.sys();
    const look = {} as Record<string, Outlook>;
    for (const k of [...SPECIES_NAMES, "grass", "algae"]) look[k] = this.outlook(k);
    const distTo = (x: number, y: number) => Math.hypot(x - this.x, y - this.y);
    const usualFood = (s: SpeciesName) => Math.max(1e-6, this.memory.get(s)!.food);
    /** Food per head in r (with `extra` more of s there), relative to what's usual world-wide. */
    const relFood = (r: Region, s: SpeciesName, extra = 0) => foodIn(r, s) / Math.max(1, r.animals[s] + extra) / usualFood(s);
    /** Hunters of s in r. */
    const threats = (r: Region, s: SpeciesName) => predatorsOf(s).reduce((a, q) => a + r.animals[q], 0);
    // Not flying, not one that got away lately, not one another gardener is after.
    const free = (s: SpeciesName, c: Critter) =>
      !c.flying && (this.escaped.get(`${sys[s].species.name}#${c.id}`) ?? 0) <= w.tick && !others.some((g) => g.quarry() === c);
    /** The catchable s in r nearest (x, y). */
    const pick = (s: SpeciesName, r: Region | null, x: number, y: number) => {
      let best: Critter | null = null;
      let bd = Infinity;
      for (const c of sys[s].critters) {
        if (!free(s, c) || (r && v.of(c) !== r)) continue;
        const d = (c.x - x) ** 2 + (c.y - y) ** 2;
        if (d < bd) (bd = d), (best = c);
      }
      return best;
    };
    /** Where the s in r gather (their mean position). */
    const groups = new Map<string, { x: number; y: number; k: number }>();
    for (const s of SPECIES_NAMES) {
      for (const c of sys[s].critters) {
        const key = `${s}@${v.of(c).id}`;
        const g = groups.get(key) ?? { x: 0, y: 0, k: 0 };
        (g.x += c.x), (g.y += c.y), g.k++;
        groups.set(key, g);
      }
    }
    const groupOf = (s: SpeciesName, r: Region) => {
      const g = groups.get(`${s}@${r.id}`);
      return g ? { x: g.x / g.k, y: g.y / g.k } : r.foodSpot;
    };
    const how = (s: string) => `${PLURAL[s as SpeciesName] ?? s}: ${this.outlookText(s)}`;
    const home = (s: SpeciesName) => v.regions.filter((r) => r.animals[s] > 0 && suits(r, s));

    // 1. Eat: plants where they're plentiful for their grazers, or a spare animal from where its kind is crowded.
    const share = this.fat / p.gardenerMaxFat;
    if (share < 0.7) {
      const need = share < 0.25 ? 8 : (0.7 - share) * 6;
      let best: Region | null = null, bv = 0;
      for (const r of v.regions) {
        const s: SpeciesName = r.water ? "fish" : "sheep";
        const plant = r.water ? "algae" : "grass";
        if (r.water && !this.hasBoat && distTo(this.boatX, this.boatY) > 60) continue;
        const food = r.water ? r.algae : r.grass + r.seeds;
        if (food < 10) continue;
        const val = (food / (1 + r.animals[s] * 20)) * (look[plant].urgency > 0.5 ? 0.3 : 1) / (1 + distTo(r.foodSpot.x, r.foodSpot.y) / 40);
        if (val > bv) (bv = val), (best = r);
      }
      if (best) {
        const food = best.water ? `${best.algae} algae` : `${best.grass + best.seeds} grass and seeds`;
        out.push({ text: `Eat plants in ${best.name}: ${food}, plenty for its grazers`, utility: need, task: { kind: "eatPlants", x: best.foodSpot.x, y: best.foodSpot.y } });
      }
      for (const s of SPECIES_NAMES) {
        if (!look[s].spare) continue; // never rocs, never what can't be spared
        let br: Region | null = null, bv2 = 0;
        for (const r of home(s)) {
          const g = groupOf(s, r);
          const val = (1 / Math.max(0.05, relFood(r, s))) / (1 + distTo(g.x, g.y) / 60);
          if (val > bv2) (bv2 = val), (br = r);
        }
        if (!br) continue;
        const c = pick(s, br, this.x, this.y);
        if (!c) continue;
        out.push({ text: `Hunt a ${s} in ${br.name} to eat (${how(s)}; ${br.animals[s]} there)`, utility: need * 0.9, task: { kind: "hunt", sys: sys[s], target: c } });
      }
    }

    // 2. Protect a species in trouble by culling its hunters where it lives.
    for (const s of [...SPECIES_NAMES]) {
      const os = look[s];
      if (os.urgency < 0.5) continue;
      for (const r of v.regions) {
        const k = r.animals[s];
        if (k === 0) continue;
        for (const q of predatorsOf(s)) {
          if (q === "roc") continue; // rocs are sacred, whatever they eat
          const nq = r.animals[q];
          const oq = look[q];
          if (nq === 0 || oq.judgement === "rare" || oq.judgement === "gone" || oq.urgency >= os.urgency) continue;
          // Hunters per head of prey here, against what the hunters usually have world-wide.
          const pressure = (nq / k) * usualFood(q);
          const g = groupOf(s, r);
          const c = pick(q, r, g.x, g.y);
          if (!c) continue;
          out.push({
            text: `Cull a ${q} in ${r.name}: ${how(s)}; the ${nq} ${PLURAL[q]} there hunt its ${k} ${PLURAL[s]}`,
            utility: 1 + os.urgency * (0.4 + k / os.n) * (0.5 + Math.min(2, pressure) / 2),
            task: { kind: "cull", sys: sys[q], target: c },
          });
        }
      }
    }

    // 3. Move animals out of a land mass or lake that can't feed them (or, for one in trouble, that's too dangerous) to one that can.
    for (const s of SPECIES_NAMES) {
      if (s === "roc") continue;
      const os = look[s];
      if (os.n === 0) continue;
      for (const r of home(s)) {
        const k = r.animals[s];
        const hungry = relFood(r, s) < 0.35;
        const unsafe = os.urgency > 1 && threats(r, s) > k;
        if (!hungry && !unsafe) continue;
        let best: Region | null = null, bv = 0;
        for (const r2 of v.major) {
          if (r2 === r || !suits(r2, s)) continue;
          const f = relFood(r2, s, 1);
          const t = threats(r2, s);
          if (f < 1 || t > threats(r, s)) continue;
          // Hunters only go where their prey can spare it.
          if (DIET[s].prey && !DIET[s].prey!.some((q) => look[q].spare && r2.animals[q] > 0)) continue;
          const val = Math.min(4, f) / (1 + t);
          if (val > bv) (bv = val), (best = r2);
        }
        if (!best) continue;
        const c = pick(s, r, groupOf(s, r).x, groupOf(s, r).y);
        if (!c) continue;
        const why = hungry ? `its ${k} ${PLURAL[s]} are short of food` : `its ${k} ${PLURAL[s]} are outnumbered by hunters`;
        const there = `${foodIn(best, s).toLocaleString()} ${DIET[s].plant ?? "prey"}, ${threats(best, s)} hunters`;
        out.push({
          text: `Move a ${s} from ${r.name}, where ${why}, to ${best.name} (${there})`,
          utility: 0.8 + os.urgency * 0.6 + 1.5 * (k / os.n),
          task: { kind: "move", sys: sys[s], target: c, tx: best.foodSpot.x, ty: best.foodSpot.y },
        });
      }
    }

    // 4. Bring a lone animal and others of its kind together, so they can breed.
    for (const s of SPECIES_NAMES) {
      if (s === "roc") continue;
      const os = look[s];
      if (os.n < 2 || os.n > 40) continue;
      const homes = home(s);
      const biggest = homes.reduce<Region | null>((a, r) => (!a || r.animals[s] > a.animals[s] ? r : a), null);
      for (const r of homes) {
        if (r.animals[s] !== 1 || r === biggest || !biggest) continue;
        const goodHere = relFood(r, s, 1) >= 1 && threats(r, s) <= threats(biggest, s);
        if (goodHere) {
          // Bring it a mate.
          const g = groupOf(s, biggest);
          const c = pick(s, biggest, g.x, g.y);
          if (c) out.push({ text: `Carry a ${s} from ${biggest.name} to the lone ${s} in ${r.name}, which has food and few hunters (${how(s)})`, utility: 1 + os.urgency + (os.n <= 10 ? 1.5 : 0), task: { kind: "move", sys: sys[s], target: c, tx: groupOf(s, r).x, ty: groupOf(s, r).y } });
        } else {
          const c = pick(s, r, this.x, this.y);
          const g = groupOf(s, biggest);
          if (c) out.push({ text: `Carry the lone ${s} in ${r.name} to the ${biggest.animals[s]} in ${biggest.name} (${how(s)})`, utility: 1 + os.urgency + (os.n <= 10 ? 1.5 : 0), task: { kind: "move", sys: sys[s], target: c, tx: g.x, ty: g.y } });
        }
      }
      // A handful left, spread far apart in one place: bring two together.
      if (os.n <= 6) {
        let pair: [Critter, Critter] | null = null, pd = Infinity;
        for (const a of sys[s].critters) for (const b of sys[s].critters) {
          if (a === b || !free(s, a)) continue;
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < pd) (pd = d), (pair = [a, b]);
        }
        if (pair && pd >= 25 && v.at(pair[0].x, pair[0].y) === v.at(pair[1].x, pair[1].y)) {
          out.push({ text: `Carry a ${s} to the nearest other one, ${pd | 0} squares away (${how(s)})`, utility: 3 + os.urgency, task: { kind: "move", sys: sys[s], target: pair[0], tx: pair[1].x, ty: pair[1].y } });
        }
      }
    }

    // 5. Spread a species to good, empty land or water, so one disaster can't end it.
    for (const s of SPECIES_NAMES) {
      if (s === "roc") continue;
      const os = look[s];
      if (os.n < 6) continue;
      const homes = home(s);
      const from = homes.reduce<Region | null>((a, r) => (!a || r.animals[s] > a.animals[s] ? r : a), null);
      if (!from || from.animals[s] < 4) continue;
      const crowded = relFood(from, s) < 0.5;
      if (os.urgency < 0.3 && !crowded) continue;
      for (const r2 of v.major) {
        if (!suits(r2, s) || r2.animals[s] > 1 || r2 === from) continue;
        if (relFood(r2, s, 2) < 1.5 || threats(r2, s) > 1) continue;
        if (DIET[s].prey && !DIET[s].prey!.some((q) => look[q].spare && r2.animals[q] >= 10)) continue;
        const g = groupOf(s, from);
        const c = pick(s, from, g.x, g.y);
        if (!c) continue;
        out.push({
          text: `Start a new group: carry a ${s} from ${from.name} (${from.animals[s]} there${crowded ? ", crowded" : ""}) to ${r2.name}, which has ${foodIn(r2, s).toLocaleString()} ${DIET[s].plant ?? "prey"} and ${r2.animals[s] ? "one" : "no"} ${PLURAL[s]}`,
          utility: 0.6 + os.urgency * 0.7 + (crowded ? 0.8 : 0),
          task: { kind: "move", sys: sys[s], target: c, tx: r2.foodSpot.x, ty: r2.foodSpot.y },
        });
      }
    }

    // 6. Thin out grazers that are stripping their plants, or any species that has outgrown its food.
    for (const s of ["fish", "sheep"] as const) {
      const plant = DIET[s].plant!;
      if (!look[s].spare) continue;
      for (const r of home(s)) {
        const k = r.animals[s];
        const rf = relFood(r, s);
        if (k < 4 || rf > 0.4 || look[plant].urgency < 0.3) continue;
        const c = pick(s, r, groupOf(s, r).x, groupOf(s, r).y);
        if (c) out.push({ text: `Cull a ${s} in ${r.name}: its ${k} ${PLURAL[s]} are stripping the ${plant} there (${foodIn(r, s)} left; ${plant}: ${this.outlookText(plant)})`, utility: 0.8 + look[plant].urgency + (0.4 - rf) * 2, task: { kind: "cull", sys: sys[s], target: c } });
      }
    }
    for (const s of SPECIES_NAMES) {
      if (!look[s].spare || look[s].judgement !== "too many") continue;
      let worst: Region | null = null, wv = Infinity;
      for (const r of home(s)) if (relFood(r, s) < wv && r.animals[s] >= 3) (wv = relFood(r, s)), (worst = r);
      if (!worst) continue;
      const c = pick(s, worst, this.x, this.y);
      if (c) out.push({ text: `Cull a ${s} in ${worst.name}: ${how(s)}, more than their food can support`, utility: 1 + Math.min(1.5, look[s].trend), task: { kind: "cull", sys: sys[s], target: c } });
    }

    // 7. Carry seeds to bare, damp land that has little grass, especially where sheep go hungry.
    {
      let from: Region | null = null, fv = 0;
      for (const r of v.regions) {
        if (r.water || r.seeds < 10) continue;
        const d = distTo(r.seedSpot.x, r.seedSpot.y);
        if (d > 100) continue;
        const val = r.seeds / (1 + d / 30);
        if (val > fv) (fv = val), (from = r);
      }
      if (from) {
        for (const r of v.major) {
          if (r.water || r.bare < 30) continue;
          const cover = (r.grass + r.seeds) / r.size;
          if (cover > 0.15) continue;
          const d = Math.hypot(r.bareSpot.x - from.seedSpot.x, r.bareSpot.y - from.seedSpot.y);
          if (d > 150) continue;
          const hungrySheep = r.animals.sheep > 0 && relFood(r, "sheep") < 0.5;
          out.push({
            text: `Carry seeds from ${from.name} to bare damp ground in ${r.name} (${Math.round(cover * 100)}% grass cover${hungrySheep ? `, ${r.animals.sheep} hungry sheep` : ""}; grass: ${this.outlookText("grass")})`,
            utility: 0.5 + look.grass.urgency + (hungrySheep ? 1 : 0) + (r.animals.sheep === 0 && look.sheep.urgency > 0.5 ? 0.3 : 0),
            task: { kind: "sow", fx: from.seedSpot.x, fy: from.seedSpot.y, tx: r.bareSpot.x, ty: r.bareSpot.y },
          });
        }
      }
    }

    // 8. Wander and keep watch.
    {
      let x = 0, y = 0;
      for (let k = 0; k < 20; k++) {
        x = Math.floor(w.rng() * GRID_W);
        y = Math.floor(w.rng() * GRID_H);
        if (!w.water.isWater(y * GRID_W + x)) break;
      }
      out.push({ text: `Wander over to ${v.at(x, y).name} and keep watch`, utility: 0.3, task: { kind: "goto", x, y } });
    }

    // Further away is less attractive; leave out anything they've lately found no way to reach.
    for (const [cell, until] of this.unreachable) if (until <= w.tick) this.unreachable.delete(cell);
    const reachable = (x: number, y: number) => !this.unreachable.has(this.nav.cellOf(x, y));
    const ok = out.filter((o) => {
      const t = o.task;
      let x0: number, y0: number, fine: boolean;
      switch (t.kind) {
        case "goto":
        case "eatPlants":
          (x0 = t.x), (y0 = t.y), (fine = reachable(t.x, t.y));
          break;
        case "hunt":
        case "cull":
          (x0 = t.target.x), (y0 = t.target.y), (fine = reachable(x0, y0));
          break;
        case "move":
          (x0 = t.target.x), (y0 = t.target.y), (fine = reachable(x0, y0) && reachable(t.tx, t.ty));
          break;
        case "sow":
          (x0 = t.fx), (y0 = t.fy), (fine = reachable(t.fx, t.fy) && reachable(t.tx, t.ty));
          break;
      }
      if (t.kind !== "eatPlants" && t.kind !== "goto") {
        o.utility /= 1 + distTo(x0, y0) / 400;
        // Leave a job another gardener is already on to them: spread out.
        if (others.some((g) => { const a = g.aim(); return a && Math.hypot(a.x - x0, a.y - y0) < 30; })) o.utility *= 0.5;
      }
      if ("target" in t) {
        const odds = this.odds(t.sys, t.target);
        o.utility *= odds;
        o.text += ` [my odds of catching it: ${Math.round(odds * 100)}%]`;
      }
      return fine;
    });
    ok.sort((a, b) => b.utility - a.utility);
    return ok.slice(0, 6);
  }

  /** The situation and options as text, for a language model. */
  prompt(opts: GardenerOption[]): GardenerPrompt {
    const p = this.w.p;
    const pops = ["grass", "algae", ...SPECIES_NAMES]
      .map((s) => `- ${PLURAL[s as SpeciesName] ?? s}: ${this.outlookText(s)}${s === "roc" ? " (sacred: never harm them)" : ""}`).join("\n");
    const places = this.regionLines().slice(0, 6).map((l) => `- ${l}`).join("\n");
    const fatPct = Math.round((100 * this.fat) / p.gardenerMaxFat);
    const me = `My fat: ${fatPct}% (${fatPct < 25 ? "starving - must eat" : fatPct < 50 ? "hungry" : "fine"}). I'm in ${this.view.at(this.x, this.y).name}. Walking is fast; rowing is slower; carrying the boat over land is slow.`;
    return {
      system: "You are a gardener looking after a small world. Fish eat algae; sheep eat grass; sharks eat fish and swimming sheep; cats eat sheep and landed rocs; rocs eat fish and sheep. Your goal: keep every species alive (none may die out) and stay alive yourself by eating. Rocs are sacred: never harm them. Pick the best next action. Reply with only its number.",
      user: `${me}\nPopulations:\n${pops}\nPlaces:\n${places}\nOptions:\n${opts.map((o, k) => `${k + 1}. ${o.text}`).join("\n")}\nBest option number:`,
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

  /** The animal they're after or carrying, if any. */
  quarry(): Critter | null {
    if (this.carried) return this.carried.c;
    return this.task && "target" in this.task ? this.task.target : null;
  }

  /** Where the current task is heading (for drawing), or null. */
  aim(): { x: number; y: number } | null {
    if (this.carcass) return this.carcass;
    return this.aimOf(this.task);
  }

  private aimOf(t: Task | null): { x: number; y: number } | null {
    if (!t) return null;
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
