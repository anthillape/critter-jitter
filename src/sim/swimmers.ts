import { GRID_H, GRID_W, type Params } from "./config";
import type { Rng } from "./rng";

/**
 * Swimmers: the first critters. Small fish that live in the water, eat
 * algae, store fat, find mates and breed. Each one has a genome of genes;
 * every gene nudges a handful of traits up or down on top of editable
 * defaults.
 */

export interface TraitDef {
  key: string;
  label: string;
  tip: string;
  /** Editable default (the value with no gene effects). */
  def: number;
  min: number;
  max: number;
  /** "mul": genes scale the default (by e^(sum*spread)); "add": genes add sum*spread. */
  mode: "mul" | "add";
  spread: number;
  /** Wraps around instead of clamping (hue). */
  wrap?: boolean;
}

export const SWIMMER_TRAITS: TraitDef[] = [
  { key: "maxFat", label: "Fat store max", tip: "Most energy a swimmer can keep as fat.", def: 2, min: 0.1, max: 20, mode: "mul", spread: 0.8 },
  { key: "fatTendency", label: "Fat storing", tip: "Share of spare energy turned into fat each tick. High = stores fat eagerly.", def: 0.05, min: 0.002, max: 0.5, mode: "mul", spread: 0.8 },
  { key: "minSpeed", label: "Minimum speed", tip: "Slowest a swimmer moves when it's going anywhere, in squares per tick.", def: 0.01, min: 0.001, max: 0.2, mode: "mul", spread: 0.6 },
  { key: "maxSpeed", label: "Top speed", tip: "Speed while chasing food or a mate, in squares per tick.", def: 0.07, min: 0.01, max: 0.5, mode: "mul", spread: 0.6 },
  { key: "hue", label: "Colour hue", tip: "Hue of the swimmer's colour, in degrees.", def: 200, min: 0, max: 360, mode: "add", spread: 140, wrap: true },
  { key: "sat", label: "Colour saturation", tip: "Saturation of the swimmer's colour.", def: 0.65, min: 0.1, max: 1, mode: "add", spread: 0.35 },
  { key: "lum", label: "Colour lightness", tip: "Lightness of the swimmer's colour.", def: 0.62, min: 0.3, max: 0.9, mode: "add", spread: 0.25 },
  { key: "breedAge", label: "Breeding age", tip: "Age (ticks) from which a swimmer starts prioritising breeding.", def: 900, min: 60, max: 20000, mode: "mul", spread: 0.6 },
  { key: "breedFat", label: "Fat needed to breed", tip: "Fat a swimmer needs before it starts looking for a mate.", def: 0.8, min: 0, max: 20, mode: "mul", spread: 0.6 },
  { key: "hungerFat", label: "Hunger threshold", tip: "When fat falls below this, the swimmer actively hunts for algae.", def: 0.6, min: 0, max: 20, mode: "mul", spread: 0.7 },
  { key: "lifespan", label: "Lifespan", tip: "Age (ticks) at which a swimmer dies of old age.", def: 7000, min: 300, max: 60000, mode: "mul", spread: 0.4 },
  { key: "parentShare", label: "Share given to each child", tip: "Share of its own nutrients and energy a parent gives each child.", def: 0.2, min: 0.02, max: 0.6, mode: "add", spread: 0.12 },
  { key: "litterSize", label: "Preferred litter size", tip: "How many children a swimmer would like per mating (if parents can afford them).", def: 2, min: 1, max: 12, mode: "mul", spread: 0.5 },
  { key: "mutation", label: "Mutation size", tip: "How much inherited genes change, randomly, in each child.", def: 0.15, min: 0.005, max: 1, mode: "mul", spread: 0.6 },
  { key: "bodySize", label: "Body size", tip: "Body mass: bigger swimmers cost more to move and to keep alive.", def: 1, min: 0.3, max: 4, mode: "mul", spread: 0.35 },
  { key: "roamSpeed", label: "Roaming speed", tip: "Speed while roaming randomly (with nothing in sight), in squares per tick. Kept between the minimum and top speeds.", def: 0.025, min: 0.001, max: 0.3, mode: "mul", spread: 0.6 },
];

export const T_MAX_FAT = 0, T_FAT_TEND = 1, T_MIN_SPEED = 2, T_MAX_SPEED = 3, T_HUE = 4, T_SAT = 5, T_LUM = 6,
  T_BREED_AGE = 7, T_BREED_FAT = 8, T_HUNGER_FAT = 9, T_LIFESPAN = 10, T_PARENT_SHARE = 11, T_LITTER = 12,
  T_MUTATION = 13, T_BODY = 14, T_ROAM_SPEED = 15;
export const TRAIT_COUNT = SWIMMER_TRAITS.length;
export const GENE_COUNT_SWIM = 23;
/** Each gene affects a third of the traits. */
export const TRAITS_PER_GENE = Math.round(TRAIT_COUNT / 3);
/** Genes taken from each parent (the child also gets one brand-new gene). */
export const GENES_FROM_EACH_PARENT = (GENE_COUNT_SWIM - 1) / 2;

/** A gene: which traits it touches and by how much (roughly -1..1 each, scaled by gene strength). */
export interface Gene {
  traits: Uint8Array;
  deltas: Float32Array;
}

export const enum Mode { Wander, Hungry, Mating, Stranded }

export interface Swimmer {
  id: number;
  x: number;
  y: number;
  heading: number;
  speed: number;
  energy: number;
  fat: number;
  nutrients: number;
  age: number;
  cooldown: number;
  parents: [number, number];
  genes: Gene[];
  traits: Float32Array;
  mode: Mode;
  targetX: number;
  targetY: number;
  hasTarget: boolean;
  mate: Swimmer | null;
  phase: number;
  alive: boolean;
  /** CSS colour from the hue / saturation / lightness traits. */
  colour: string;
}

export interface Corpse {
  x: number;
  y: number;
  nutrients: number;
}

/** Accessors the swimmers need from the world (kept narrow on purpose). */
export interface SwimmerHost {
  p: Params;
  rng: Rng;
  kind: Uint8Array;
  floraN: Float64Array;
  floraE: Float32Array;
  nutrients: Float64Array;
  isWater(i: number): boolean;
  /** Removes the algae on square i (it's been eaten). */
  clearFlora(i: number): void;
}

const ALGAE_KIND = 3;

export function colourOf(t: Float32Array): string {
  return `hsl(${t[T_HUE].toFixed(0)} ${(t[T_SAT] * 100).toFixed(0)}% ${(t[T_LUM] * 100).toFixed(0)}%)`;
}

export const MODE_NAMES = ["roaming", "hungry", "looking for a mate", "stranded on land"];

export function randomGene(rng: Rng, strength: number): Gene {
  const traits = new Uint8Array(TRAITS_PER_GENE);
  const chosen = new Set<number>();
  for (let k = 0; k < TRAITS_PER_GENE; k++) {
    let t: number;
    do t = Math.floor(rng() * TRAIT_COUNT); while (chosen.has(t));
    chosen.add(t);
    traits[k] = t;
  }
  const deltas = new Float32Array(TRAITS_PER_GENE);
  for (let k = 0; k < TRAITS_PER_GENE; k++) deltas[k] = (rng() * 2 - 1) * strength;
  return { traits, deltas };
}

/** Works out a swimmer's traits: defaults plus the summed effect of all its genes. */
export function expressTraits(genes: Gene[]): Float32Array {
  const sum = new Float32Array(TRAIT_COUNT);
  for (const g of genes) for (let k = 0; k < g.traits.length; k++) sum[g.traits[k]] += g.deltas[k];
  const out = new Float32Array(TRAIT_COUNT);
  for (let t = 0; t < TRAIT_COUNT; t++) {
    const d = SWIMMER_TRAITS[t];
    let v = d.mode === "mul" ? d.def * Math.exp(sum[t] * d.spread) : d.def + sum[t] * d.spread;
    if (d.wrap) v = ((v % d.max) + d.max) % d.max;
    else v = Math.max(d.min, Math.min(d.max, v));
    out[t] = v;
  }
  if (out[T_MAX_SPEED] < out[T_MIN_SPEED]) out[T_MAX_SPEED] = out[T_MIN_SPEED];
  out[T_ROAM_SPEED] = Math.max(out[T_MIN_SPEED], Math.min(out[T_MAX_SPEED], out[T_ROAM_SPEED]));
  return out;
}

export class SwimmerSystem {
  swimmers: Swimmer[] = [];
  corpses: Corpse[] = [];
  births = 0;
  deaths = 0;
  starved = 0;
  oldAge = 0;
  private nextId = 1;
  private tick = 0;
  /** Mate-search buckets: ready swimmers by coarse cell. */
  private buckets = new Map<number, Swimmer[]>();

  constructor(private host: SwimmerHost) {}

  /** Adds a founding swimmer with a random genome at (x, y), taking its nutrients from that square. */
  spawnRandom(x: number, y: number): boolean {
    const h = this.host;
    const p = h.p;
    const i = Math.floor(y) * GRID_W + Math.floor(x);
    if (!h.isWater(i) || h.nutrients[i] < p.swimStartNutrients) return false;
    h.nutrients[i] -= p.swimStartNutrients;
    const genes: Gene[] = [];
    for (let g = 0; g < GENE_COUNT_SWIM; g++) genes.push(randomGene(h.rng, p.swimGeneStrength));
    this.add(x, y, genes, [0, 0], p.swimStartEnergy, p.swimStartNutrients, 0);
    return true;
  }

  private add(x: number, y: number, genes: Gene[], parents: [number, number], energy: number, nutrients: number, fat: number): Swimmer {
    const traits = expressTraits(genes);
    const s: Swimmer = {
      id: this.nextId++, x, y, heading: this.host.rng() * Math.PI * 2, speed: 0,
      energy, fat, nutrients, age: 0, cooldown: 0, parents, genes, traits,
      mode: Mode.Wander, targetX: 0, targetY: 0, hasTarget: false, mate: null,
      phase: this.host.rng() * Math.PI * 2, alive: true, colour: colourOf(traits),
    };
    this.swimmers.push(s);
    return s;
  }

  step(): void {
    this.tick++;
    this.buildBuckets();
    for (const s of this.swimmers) if (s.alive) this.update(s);
    // Drop the dead (their bodies are now corpses).
    if (this.swimmers.some((s) => !s.alive)) this.swimmers = this.swimmers.filter((s) => s.alive);
    this.rot();
  }

  private isReady(s: Swimmer): boolean {
    const t = s.traits;
    return s.alive && s.cooldown === 0 && s.age >= t[T_BREED_AGE] && s.fat >= t[T_BREED_FAT] && s.fat >= t[T_HUNGER_FAT];
  }

  private buildBuckets(): void {
    this.buckets.clear();
    const size = this.host.p.swimMateRadius;
    for (const s of this.swimmers) {
      if (!this.isReady(s)) continue;
      const key = Math.floor(s.x / size) * 1000 + Math.floor(s.y / size);
      let b = this.buckets.get(key);
      if (!b) this.buckets.set(key, (b = []));
      b.push(s);
    }
  }

  private update(s: Swimmer): void {
    const h = this.host;
    const p = h.p;
    const t = s.traits;
    s.age++;
    if (s.cooldown > 0) s.cooldown--;
    if (s.age >= t[T_LIFESPAN]) {
      this.oldAge++;
      this.die(s);
      return;
    }

    const cx = Math.floor(s.x);
    const cy = Math.floor(s.y);
    const here = cy * GRID_W + cx;
    const inWater = h.isWater(here);

    // Choose what to do.
    if (!inWater) {
      s.mode = Mode.Stranded;
    } else if (s.fat < t[T_HUNGER_FAT]) {
      if (s.mode !== Mode.Hungry) s.hasTarget = false;
      s.mode = Mode.Hungry;
    } else if (this.isReady(s)) {
      if (s.mode !== Mode.Mating) s.hasTarget = false;
      s.mode = Mode.Mating;
    } else {
      s.mode = Mode.Wander;
      s.hasTarget = false;
    }

    // Look around (staggered so not everyone searches on the same tick).
    if (s.mode === Mode.Hungry && (this.tick + s.id) % p.swimFoodInterval === 0) this.findFood(s);
    if (s.mode === Mode.Mating && (this.tick + s.id) % p.swimMateInterval === 0) this.findMate(s);

    // Steer and set speed.
    let speed = 0;
    if (s.mode === Mode.Stranded) {
      speed = 0;
    } else if (s.hasTarget) {
      if (s.mate) {
        if (!s.mate.alive) {
          s.mate = null;
          s.hasTarget = false;
        } else {
          s.targetX = s.mate.x;
          s.targetY = s.mate.y;
        }
      }
      const dx = s.targetX - s.x;
      const dy = s.targetY - s.y;
      const dist = Math.hypot(dx, dy);
      s.heading = Math.atan2(dy, dx);
      // Heading for something it has spotted: top speed, easing off at the end.
      speed = Math.max(Math.min(t[T_MIN_SPEED], dist), Math.min(t[T_MAX_SPEED], dist));
      if (dist < 0.75) this.arrive(s);
    } else {
      // Nothing in sight: roam randomly at the genetic roaming speed.
      s.heading += (h.rng() - 0.5) * 0.5;
      speed = t[T_ROAM_SPEED];
    }

    // Move, but never onto land or off the map.
    if (speed > 0 && s.alive) {
      const nx = s.x + Math.cos(s.heading) * speed;
      const ny = s.y + Math.sin(s.heading) * speed;
      const ni = Math.floor(ny) * GRID_W + Math.floor(nx);
      if (nx >= 0 && ny >= 0 && nx < GRID_W && ny < GRID_H && h.isWater(ni)) {
        s.x = nx;
        s.y = ny;
      } else {
        s.heading += Math.PI * (0.5 + h.rng());
        s.hasTarget = false;
        s.mate = null;
        speed = 0;
      }
    }
    s.speed = speed;
    s.phase += speed * 12; // wiggle only while moving
    if (!s.alive) return;

    // Energy: moving costs ½·m·v² (fat adds mass), living costs energy per unit of mass.
    const mass = t[T_BODY] + s.fat * p.swimFatMass;
    const cost = p.swimMoveCost * 0.5 * mass * speed * speed + p.swimMetabolism * mass;
    s.energy -= cost;
    // Fat: store spare energy, or draw on fat when running low.
    const eMax = p.swimEnergyMax;
    if (s.energy > 0.7 * eMax && s.fat < t[T_MAX_FAT]) {
      const put = Math.min((s.energy - 0.7 * eMax) * t[T_FAT_TEND], t[T_MAX_FAT] - s.fat);
      s.energy -= put;
      s.fat += put;
    } else if (s.energy < 0.3 * eMax && s.fat > 0) {
      const take = Math.min(0.3 * eMax - s.energy, s.fat);
      s.energy += take;
      s.fat -= take;
    }
    if (s.energy > eMax) s.energy = eMax; // anything beyond both stores is lost

    // Metabolism also sheds a little of the body's nutrients into the water.
    const shed = s.nutrients * p.swimNutrientLoss;
    s.nutrients -= shed;
    h.nutrients[here] += shed;

    if (s.energy <= 0 || s.nutrients < p.swimMinNutrients) {
      this.starved++;
      this.die(s);
    }
  }

  private findFood(s: Swimmer): void {
    const h = this.host;
    const r = h.p.swimFoodRadius;
    const cx = Math.floor(s.x);
    const cy = Math.floor(s.y);
    let best = -1;
    let bestD = Infinity;
    for (let y = Math.max(0, cy - r); y <= Math.min(GRID_H - 1, cy + r); y++) {
      for (let x = Math.max(0, cx - r); x <= Math.min(GRID_W - 1, cx + r); x++) {
        const i = y * GRID_W + x;
        if (h.kind[i] !== ALGAE_KIND) continue;
        const d = (x + 0.5 - s.x) ** 2 + (y + 0.5 - s.y) ** 2;
        if (d < bestD && d <= r * r) {
          bestD = d;
          best = i;
        }
      }
    }
    if (best >= 0) {
      s.targetX = (best % GRID_W) + 0.5;
      s.targetY = Math.floor(best / GRID_W) + 0.5;
      s.hasTarget = true;
      s.mate = null;
    } else {
      s.hasTarget = false;
    }
  }

  private findMate(s: Swimmer): void {
    const r = this.host.p.swimMateRadius;
    const bx = Math.floor(s.x / r);
    const by = Math.floor(s.y / r);
    let best: Swimmer | null = null;
    let bestD = r * r;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const b = this.buckets.get((bx + dx) * 1000 + by + dy);
        if (!b) continue;
        for (const o of b) {
          if (o === s || !this.canMate(s, o)) continue;
          const d = (o.x - s.x) ** 2 + (o.y - s.y) ** 2;
          if (d < bestD) {
            bestD = d;
            best = o;
          }
        }
      }
    }
    s.mate = best;
    s.hasTarget = !!best;
    if (best) {
      s.targetX = best.x;
      s.targetY = best.y;
    }
  }

  /** Both must be ready to breed (see isReady); and not with your own parents (or children). */
  private canMate(a: Swimmer, b: Swimmer): boolean {
    return a.parents[0] !== b.id && a.parents[1] !== b.id && b.parents[0] !== a.id && b.parents[1] !== a.id;
  }

  private arrive(s: Swimmer): void {
    const h = this.host;
    s.hasTarget = false;
    if (s.mate) {
      const m = s.mate;
      s.mate = null;
      if (m.alive && this.isReady(s) && this.isReady(m) && this.canMate(s, m) && Math.hypot(m.x - s.x, m.y - s.y) < 1.5) {
        this.breed(s, m);
      }
      return;
    }
    // Food: eat the algae on this square in one go.
    const i = Math.floor(s.targetY) * GRID_W + Math.floor(s.targetX);
    if (h.kind[i] === ALGAE_KIND) {
      s.energy += h.floraE[i];
      s.nutrients += h.floraN[i];
      h.floraN[i] = 0;
      h.clearFlora(i);
      // Surplus energy goes straight to fat where there's room.
      const eMax = h.p.swimEnergyMax;
      if (s.energy > eMax) {
        const put = Math.min(s.energy - eMax, s.traits[T_MAX_FAT] - s.fat);
        if (put > 0) {
          s.fat += put;
          s.energy -= put;
        }
      }
    }
  }

  /** Parents make as many children (up to their preferred litter) as they can afford. */
  private breed(a: Swimmer, b: Swimmer): void {
    const h = this.host;
    const p = h.p;
    const want = Math.max(1, Math.round((a.traits[T_LITTER] + b.traits[T_LITTER]) / 2));
    let made = 0;
    for (let k = 0; k < want; k++) {
      const shareA = a.traits[T_PARENT_SHARE];
      const shareB = b.traits[T_PARENT_SHARE];
      const eA = (a.energy + a.fat) * shareA;
      const eB = (b.energy + b.fat) * shareB;
      const nA = a.nutrients * shareA;
      const nB = b.nutrients * shareB;
      if (eA + eB < p.swimMinChildEnergy || nA + nB < p.swimMinChildNutrients) break;
      take(a, eA);
      take(b, eB);
      a.nutrients -= nA;
      b.nutrients -= nB;
      const genes = this.childGenes(a, b);
      const e = eA + eB;
      const eMax = p.swimEnergyMax;
      const c = this.add((a.x + b.x) / 2, (a.y + b.y) / 2, genes, [a.id, b.id], Math.min(e, eMax), nA + nB, 0);
      c.fat = Math.min(Math.max(0, e - eMax), c.traits[T_MAX_FAT]); // any remainder beyond fat is lost
      made++;
    }
    if (made > 0) {
      this.births += made;
      a.cooldown = b.cooldown = p.swimBreedCooldown;
    }
    function take(s: Swimmer, amount: number): void {
      const fromEnergy = Math.min(s.energy, amount);
      s.energy -= fromEnergy;
      s.fat -= amount - fromEnergy;
    }
  }

  /** 11 random genes from each parent (each slightly mutated) plus one brand-new gene. */
  private childGenes(a: Swimmer, b: Swimmer): Gene[] {
    const h = this.host;
    const strength = h.p.swimGeneStrength;
    const mutation = ((a.traits[T_MUTATION] + b.traits[T_MUTATION]) / 2) * strength;
    const out: Gene[] = [];
    for (const parent of [a, b]) {
      const pool = parent.genes.slice();
      for (let k = 0; k < GENES_FROM_EACH_PARENT && pool.length; k++) {
        const g = pool.splice(Math.floor(h.rng() * pool.length), 1)[0];
        const deltas = new Float32Array(g.deltas.length);
        for (let j = 0; j < deltas.length; j++) {
          deltas[j] = Math.max(-2 * strength, Math.min(2 * strength, g.deltas[j] + (h.rng() * 2 - 1) * mutation));
        }
        out.push({ traits: g.traits, deltas });
      }
    }
    while (out.length < GENE_COUNT_SWIM) out.push(randomGene(h.rng, strength));
    return out;
  }

  /** Death: energy is lost, the body stays and rots, returning its nutrients gradually. */
  private die(s: Swimmer): void {
    s.alive = false;
    this.deaths++;
    this.corpses.push({ x: s.x, y: s.y, nutrients: s.nutrients });
  }

  private rot(): void {
    if (!this.corpses.length) return;
    const h = this.host;
    const rate = h.p.swimRotRate;
    const keep: Corpse[] = [];
    for (const c of this.corpses) {
      const i = Math.floor(c.y) * GRID_W + Math.floor(c.x);
      let r = c.nutrients * rate;
      if (c.nutrients - r < 1e-4) r = c.nutrients;
      c.nutrients -= r;
      h.nutrients[i] += r;
      if (c.nutrients > 0) keep.push(c);
    }
    this.corpses = keep;
  }

  /** Re-applies the (possibly edited) trait defaults to every living swimmer. */
  reexpress(): void {
    for (const s of this.swimmers) {
      s.traits = expressTraits(s.genes);
      s.colour = colourOf(s.traits);
    }
  }

  /** Nearest living swimmer within `r` squares of (x, y), if any. */
  nearest(x: number, y: number, r: number): Swimmer | null {
    let best: Swimmer | null = null;
    let bestD = r * r;
    for (const s of this.swimmers) {
      const d = (s.x - x) ** 2 + (s.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  /** Nutrients held in living swimmers and in corpses. */
  nutrientTotal(): number {
    let n = 0;
    for (const s of this.swimmers) n += s.nutrients;
    for (const c of this.corpses) n += c.nutrients;
    return n;
  }

  /** Mean ± sd of each trait over the given swimmers. */
  static traitStats(list: Swimmer[]): Array<{ mean: number; sd: number }> {
    return SWIMMER_TRAITS.map((d, t) => {
      if (!list.length) return { mean: NaN, sd: NaN };
      if (d.wrap) {
        // Circular mean for hue.
        let sx = 0, sy = 0;
        for (const s of list) {
          sx += Math.cos((s.traits[t] * Math.PI) / 180);
          sy += Math.sin((s.traits[t] * Math.PI) / 180);
        }
        const m = ((Math.atan2(sy, sx) * 180) / Math.PI + 360) % 360;
        const rlen = Math.hypot(sx, sy) / list.length;
        return { mean: m, sd: (Math.sqrt(-2 * Math.log(Math.max(1e-9, rlen))) * 180) / Math.PI };
      }
      let sum = 0, sq = 0;
      for (const s of list) {
        sum += s.traits[t];
        sq += s.traits[t] ** 2;
      }
      const mean = sum / list.length;
      return { mean, sd: Math.sqrt(Math.max(0, sq / list.length - mean * mean)) };
    });
  }
}
