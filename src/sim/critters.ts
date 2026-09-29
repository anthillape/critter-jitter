import { GRID_H, GRID_W, type Params } from "./config";
import type { Rng } from "./rng";

/**
 * Critters: creatures that move freely through the water, with genomes.
 *
 * - Swimmers are small fish that eat algae.
 * - Sharks are bigger and eat swimmers. They can boost after spotting prey.
 *
 * Both share one lifecycle. They store fat, hunt when hungry, find a ready
 * partner to breed, grow old, and die, leaving rotting bodies. Each has a
 * genome of genes, and every gene nudges a third of the species' traits up
 * or down on top of editable defaults.
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

// Trait indices shared by every species (sharks add two more at the end).
export const T_MAX_FAT = 0, T_FAT_TEND = 1, T_MIN_SPEED = 2, T_MAX_SPEED = 3, T_HUE = 4, T_SAT = 5, T_LUM = 6,
  T_BREED_AGE = 7, T_BREED_FAT = 8, T_HUNGER_FAT = 9, T_LIFESPAN = 10, T_PARENT_SHARE = 11, T_LITTER = 12,
  T_MUTATION = 13, T_BODY = 14, T_ROAM_SPEED = 15, T_BOOST_CHANCE = 16, T_BOOST_POWER = 17;

type TraitDefaults = Partial<Record<string, Partial<TraitDef>>>;

/** The traits every critter has, with the given per-species defaults. */
function baseTraits(o: TraitDefaults): TraitDef[] {
  const t: TraitDef[] = [
    { key: "maxFat", label: "Fat store max", tip: "Most energy it can keep as fat.", def: 2, min: 0.1, max: 40, mode: "mul", spread: 0.8 },
    { key: "fatTendency", label: "Fat storing", tip: "Share of spare energy turned into fat each tick. High = stores fat eagerly.", def: 0.05, min: 0.002, max: 0.5, mode: "mul", spread: 0.8 },
    { key: "minSpeed", label: "Minimum speed", tip: "Slowest it moves when it's going anywhere, in squares per tick.", def: 0.01, min: 0.001, max: 0.2, mode: "mul", spread: 0.6 },
    { key: "maxSpeed", label: "Top speed", tip: "Speed while chasing food or a mate, in squares per tick.", def: 0.07, min: 0.01, max: 0.5, mode: "mul", spread: 0.6 },
    { key: "hue", label: "Colour hue", tip: "Hue of its colour, in degrees.", def: 200, min: 0, max: 360, mode: "add", spread: 140, wrap: true },
    { key: "sat", label: "Colour saturation", tip: "Saturation of its colour.", def: 0.65, min: 0.05, max: 1, mode: "add", spread: 0.35 },
    { key: "lum", label: "Colour lightness", tip: "Lightness of its colour.", def: 0.62, min: 0.3, max: 0.9, mode: "add", spread: 0.25 },
    { key: "breedAge", label: "Breeding age", tip: "Age (ticks) from which it starts prioritising breeding.", def: 900, min: 60, max: 40000, mode: "mul", spread: 0.6 },
    { key: "breedFat", label: "Fat needed to breed", tip: "Fat it needs before it starts looking for a mate.", def: 0.8, min: 0, max: 40, mode: "mul", spread: 0.6 },
    { key: "hungerFat", label: "Hunger threshold", tip: "When fat falls below this, it actively hunts for food.", def: 0.6, min: 0, max: 40, mode: "mul", spread: 0.7 },
    { key: "lifespan", label: "Lifespan", tip: "Age (ticks) at which it dies of old age.", def: 7000, min: 300, max: 100000, mode: "mul", spread: 0.4 },
    { key: "parentShare", label: "Share given to each child", tip: "Share of its own nutrients and energy a parent gives each child.", def: 0.2, min: 0.02, max: 0.6, mode: "add", spread: 0.12 },
    { key: "litterSize", label: "Preferred litter size", tip: "How many children it would like per mating (if the parents can afford them).", def: 2, min: 1, max: 12, mode: "mul", spread: 0.5 },
    { key: "mutation", label: "Mutation size", tip: "How much inherited genes change, randomly, in each child.", def: 0.15, min: 0.005, max: 1, mode: "mul", spread: 0.6 },
    { key: "bodySize", label: "Body size", tip: "Body mass: bigger critters cost more to move and to keep alive.", def: 1, min: 0.3, max: 12, mode: "mul", spread: 0.35 },
    { key: "roamSpeed", label: "Roaming speed", tip: "Speed while roaming randomly (with nothing in sight), in squares per tick. Kept between the minimum and top speeds.", def: 0.025, min: 0.001, max: 0.3, mode: "mul", spread: 0.6 },
  ];
  for (const d of t) Object.assign(d, o[d.key] ?? {});
  return t;
}

export interface SpeciesDef {
  key: "swimmer" | "shark";
  /** Singular / plural names for the UI. */
  name: string;
  plural: string;
  /** Prefix of this species' settings in PARAMS (e.g. "swim" -> swimMoveCost). */
  prefix: "swim" | "shark";
  /** What it eats: algae on the grid, or the prey species. */
  diet: "algae" | "prey";
  traits: TraitDef[];
}

export const SWIMMER: SpeciesDef = {
  key: "swimmer", name: "swimmer", plural: "swimmers", prefix: "swim", diet: "algae",
  traits: baseTraits({}),
};

export const SHARK: SpeciesDef = {
  key: "shark", name: "shark", plural: "sharks", prefix: "shark", diet: "prey",
  traits: [
    ...baseTraits({
      maxFat: { def: 6 },
      minSpeed: { def: 0.012 },
      maxSpeed: { def: 0.06 },
      roamSpeed: { def: 0.03 },
      hue: { def: 215, spread: 60 },
      sat: { def: 0.18, spread: 0.2 },
      lum: { def: 0.6, spread: 0.15 },
      breedAge: { def: 2500 },
      breedFat: { def: 3 },
      hungerFat: { def: 2 },
      lifespan: { def: 15000 },
      litterSize: { def: 1.5 },
      bodySize: { def: 6, max: 20, tip: "Adult body mass (babies start small and grow into it). Bigger sharks cost more to move and to keep alive." },
    }),
    { key: "boostChance", label: "Boost likelihood", tip: "Chance a shark bursts into a boost when it spots a fish.", def: 0.5, min: 0, max: 1, mode: "add", spread: 0.3 },
    { key: "boostPower", label: "Boost power", tip: "Boost speed as a multiple of top speed.", def: 2, min: 1, max: 5, mode: "mul", spread: 0.3 },
  ],
};

export const SPECIES = [SWIMMER, SHARK];

export const GENE_COUNT_CRITTER = 23;
/** Genes taken from each parent (the child also gets one brand-new gene). */
export const GENES_FROM_EACH_PARENT = (GENE_COUNT_CRITTER - 1) / 2;

/** A gene: which traits it touches and by how much (roughly -1..1 each, scaled by gene strength). */
export interface Gene {
  traits: Uint8Array;
  deltas: Float32Array;
}

export const enum Mode { Wander, Hungry, Mating, Stranded }
export const MODE_NAMES = ["roaming", "hunting for food", "looking for a mate", "stranded on land"];

export interface Critter {
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
  mate: Critter | null;
  /** Prey being chased (sharks). */
  prey: Critter | null;
  /** Ticks of boost left (sharks). */
  boostLeft: number;
  /** Direction it's turning toward (it turns gradually, at the species' turn rate). */
  desired: number;
  /** How grown it is: its current size as a share of its genetic adult body size (0..1). */
  grown: number;
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

/** Accessors critters need from the world (kept narrow on purpose). */
export interface CritterHost {
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

/** Current body mass: the genetic adult body size scaled by how grown it is. */
export function bodyMass(c: Critter): number {
  return c.traits[T_BODY] * c.grown;
}

export function colourOf(t: Float32Array): string {
  return `hsl(${t[T_HUE].toFixed(0)} ${(t[T_SAT] * 100).toFixed(0)}% ${(t[T_LUM] * 100).toFixed(0)}%)`;
}

export function randomGene(rng: Rng, strength: number, traitCount: number): Gene {
  const perGene = Math.round(traitCount / 3);
  const traits = new Uint8Array(perGene);
  const chosen = new Set<number>();
  for (let k = 0; k < perGene; k++) {
    let t: number;
    do t = Math.floor(rng() * traitCount); while (chosen.has(t));
    chosen.add(t);
    traits[k] = t;
  }
  const deltas = new Float32Array(perGene);
  for (let k = 0; k < perGene; k++) deltas[k] = (rng() * 2 - 1) * strength;
  return { traits, deltas };
}

/** Works out traits: the species defaults plus the summed effect of all genes. */
export function expressTraits(genes: Gene[], defs: TraitDef[]): Float32Array {
  const n = defs.length;
  const sum = new Float32Array(n);
  for (const g of genes) for (let k = 0; k < g.traits.length; k++) sum[g.traits[k]] += g.deltas[k];
  const out = new Float32Array(n);
  for (let t = 0; t < n; t++) {
    const d = defs[t];
    let v = d.mode === "mul" ? d.def * Math.exp(sum[t] * d.spread) : d.def + sum[t] * d.spread;
    if (d.wrap) v = ((v % d.max) + d.max) % d.max;
    else v = Math.max(d.min, Math.min(d.max, v));
    out[t] = v;
  }
  if (out[T_MAX_SPEED] < out[T_MIN_SPEED]) out[T_MAX_SPEED] = out[T_MIN_SPEED];
  out[T_ROAM_SPEED] = Math.max(out[T_MIN_SPEED], Math.min(out[T_MAX_SPEED], out[T_ROAM_SPEED]));
  return out;
}

/** The per-species settings, read live from PARAMS by prefix. */
const PARAM_NAMES = [
  "MoveCost", "Metabolism", "FatMass", "EnergyMax", "NutrientLoss", "MinNutrients", "FoodRadius", "MateRadius",
  "FoodInterval", "MateInterval", "BreedCooldown", "MinChildEnergy", "MinChildNutrients", "RotRate",
  "GeneStrength", "StartEnergy", "StartNutrients",
  "TurnRate", "Accel", "WanderTurnChance", "WanderTurnSize", "LookAhead",
  "BirthSize", "GrowthRate", "GrowthCost",
] as const;
type ParamName = (typeof PARAM_NAMES)[number];

export class CritterSystem {
  critters: Critter[] = [];
  corpses: Corpse[] = [];
  births = 0;
  deaths = 0;
  starved = 0;
  oldAge = 0;
  /** Killed and eaten by a predator. */
  eaten = 0;
  private nextId = 1;
  private tick = 0;
  /** Mate-search buckets: ready critters by coarse cell. */
  private buckets = new Map<number, Critter[]>();
  /** Prey-search buckets (predators only): living prey by coarse cell. */
  private preyBuckets = new Map<number, Critter[]>();
  private keys: Record<ParamName, keyof Params>;

  constructor(
    private host: CritterHost,
    readonly species: SpeciesDef,
    /** For predators: the species they eat. */
    private prey: CritterSystem | null = null,
  ) {
    this.keys = Object.fromEntries(PARAM_NAMES.map((n) => [n, `${species.prefix}${n}` as keyof Params])) as Record<ParamName, keyof Params>;
  }

  /** This species' setting `name` (e.g. "MoveCost"), read live. */
  private sp(name: ParamName): number {
    return this.host.p[this.keys[name]];
  }

  /**
   * Adds a founder with a random genome at (x, y), in water only. Its body
   * nutrients are gathered from the water around it (up to 4 squares away),
   * so nutrients stay conserved; it isn't created if there aren't enough.
   */
  spawnRandom(x: number, y: number): boolean {
    const h = this.host;
    const i = Math.floor(y) * GRID_W + Math.floor(x);
    const n = this.sp("StartNutrients");
    if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H || !h.isWater(i)) return false;
    if (!this.gatherNutrients(Math.floor(x), Math.floor(y), n)) return false;
    const genes: Gene[] = [];
    for (let g = 0; g < GENE_COUNT_CRITTER; g++) genes.push(randomGene(h.rng, this.sp("GeneStrength"), this.species.traits.length));
    // Starting energy beyond the short-term store goes into fat.
    const e = this.sp("StartEnergy");
    const eMax = this.sp("EnergyMax");
    const c = this.add(x, y, genes, [0, 0], Math.min(e, eMax), n, 0);
    c.fat = Math.min(Math.max(0, e - eMax), c.traits[T_MAX_FAT]);
    return true;
  }

  /** Takes `amount` nutrients from water squares near (cx, cy), nearest first. False (and nothing taken) if short. */
  private gatherNutrients(cx: number, cy: number, amount: number): boolean {
    const h = this.host;
    const R = 4;
    const cells: number[] = [];
    let available = 0;
    for (let r = 0; r <= R && available < amount; r++) {
      for (let y = cy - r; y <= cy + r; y++) {
        for (let x = cx - r; x <= cx + r; x++) {
          if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r) continue; // ring r only
          if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) continue;
          const i = y * GRID_W + x;
          if (!h.isWater(i) || h.nutrients[i] <= 0) continue;
          cells.push(i);
          available += h.nutrients[i];
        }
      }
    }
    if (available < amount) return false;
    let need = amount;
    for (const i of cells) {
      const t = Math.min(h.nutrients[i], need);
      h.nutrients[i] -= t;
      need -= t;
      if (need <= 0) break;
    }
    return true;
  }

  private add(x: number, y: number, genes: Gene[], parents: [number, number], energy: number, nutrients: number, fat: number): Critter {
    const traits = expressTraits(genes, this.species.traits);
    const c: Critter = {
      id: this.nextId++, x, y, heading: this.host.rng() * Math.PI * 2, speed: 0,
      energy, fat, nutrients, age: 0, cooldown: 0, parents, genes, traits,
      mode: Mode.Wander, targetX: 0, targetY: 0, hasTarget: false, mate: null, prey: null, boostLeft: 0, desired: 0, grown: 1,
      phase: this.host.rng() * Math.PI * 2, alive: true, colour: colourOf(traits),
    };
    c.desired = c.heading;
    this.critters.push(c);
    return c;
  }

  step(): void {
    this.tick++;
    this.buildBuckets();
    if (this.prey) this.buildPreyBuckets();
    for (const c of this.critters) if (c.alive) this.update(c);
    this.removeDead();
    this.rot();
  }

  /** Drops dead critters from the list (also those eaten by predators). */
  removeDead(): void {
    if (this.critters.some((c) => !c.alive)) this.critters = this.critters.filter((c) => c.alive);
  }

  private isReady(c: Critter): boolean {
    const t = c.traits;
    return c.alive && c.cooldown === 0 && c.grown >= 0.9 && c.age >= t[T_BREED_AGE] && c.fat >= t[T_BREED_FAT] && c.fat >= t[T_HUNGER_FAT];
  }

  private buildBuckets(): void {
    this.buckets.clear();
    const size = this.sp("MateRadius");
    for (const c of this.critters) {
      if (!this.isReady(c)) continue;
      const key = Math.floor(c.x / size) * 1000 + Math.floor(c.y / size);
      let b = this.buckets.get(key);
      if (!b) this.buckets.set(key, (b = []));
      b.push(c);
    }
  }

  private buildPreyBuckets(): void {
    this.preyBuckets.clear();
    const size = this.sp("FoodRadius");
    for (const c of this.prey!.critters) {
      if (!c.alive) continue;
      const key = Math.floor(c.x / size) * 1000 + Math.floor(c.y / size);
      let b = this.preyBuckets.get(key);
      if (!b) this.preyBuckets.set(key, (b = []));
      b.push(c);
    }
  }

  private update(c: Critter): void {
    const h = this.host;
    const t = c.traits;
    c.age++;
    if (c.cooldown > 0) c.cooldown--;
    if (c.age >= t[T_LIFESPAN]) {
      this.oldAge++;
      this.die(c);
      return;
    }

    const here = Math.floor(c.y) * GRID_W + Math.floor(c.x);
    const inWater = h.isWater(here);

    // Choose what to do.
    if (!inWater) {
      c.mode = Mode.Stranded;
    } else if (c.fat < t[T_HUNGER_FAT]) {
      if (c.mode !== Mode.Hungry) this.dropTarget(c);
      c.mode = Mode.Hungry;
    } else if (this.isReady(c)) {
      if (c.mode !== Mode.Mating) this.dropTarget(c);
      c.mode = Mode.Mating;
    } else {
      c.mode = Mode.Wander;
      this.dropTarget(c);
    }

    // Look around (staggered so not everyone searches on the same tick).
    if (c.mode === Mode.Hungry && (this.tick + c.id) % this.sp("FoodInterval") === 0) this.findFood(c);
    if (c.mode === Mode.Mating && (this.tick + c.id) % this.sp("MateInterval") === 0) this.findMate(c);

    // Steer and set speed.
    let speed = 0;
    let boosting = false;
    if (c.mode === Mode.Stranded) {
      speed = 0;
    } else if (c.hasTarget) {
      const other = c.mate ?? c.prey;
      if (other) {
        if (!other.alive) {
          this.dropTarget(c);
        } else {
          c.targetX = other.x;
          c.targetY = other.y;
        }
      }
    }
    // Work out where it wants to head and how fast; it then turns and
    // speeds up or slows down gradually (species turn rate / acceleration).
    let turnRate = this.sp("TurnRate");
    if (c.mode !== Mode.Stranded && c.hasTarget) {
      const dx = c.targetX - c.x;
      const dy = c.targetY - c.y;
      const dist = Math.hypot(dx, dy);
      c.desired = Math.atan2(dy, dx);
      // Close in: turn harder so it doesn't circle what it's chasing.
      if (dist < 3) turnRate *= 3;
      // Heading for something it has spotted: top speed (or boost), easing off at the end.
      let top = t[T_MAX_SPEED];
      if (c.prey && c.boostLeft > 0) {
        top *= t[T_BOOST_POWER];
        boosting = true;
        c.boostLeft--;
      }
      speed = Math.max(Math.min(t[T_MIN_SPEED], dist), Math.min(top, dist));
      if (dist < (c.prey ? 1 : 0.75)) this.arrive(c);
    } else if (c.mode !== Mode.Stranded) {
      // Nothing in sight: roam, picking a new course now and then.
      if (h.rng() < this.sp("WanderTurnChance")) c.desired = c.heading + (h.rng() - 0.5) * this.sp("WanderTurnSize");
      speed = t[T_ROAM_SPEED];
      c.boostLeft = 0;
    }
    if (c.mode !== Mode.Stranded) {
      // Land coming up ahead: pick the nearest clear direction to turn to.
      const look = this.sp("LookAhead");
      if (look > 0 && !this.clearAhead(c.x, c.y, c.heading, look)) {
        for (let k = 1; k <= 6; k++) {
          const off = (k * Math.PI) / 6;
          const side = h.rng() < 0.5 ? 1 : -1;
          if (this.clearAhead(c.x, c.y, c.heading + side * off, look)) { c.desired = c.heading + side * off; break; }
          if (this.clearAhead(c.x, c.y, c.heading - side * off, look)) { c.desired = c.heading - side * off; break; }
        }
      }
      let delta = c.desired - c.heading;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      c.heading += Math.max(-turnRate, Math.min(turnRate, delta));
      const accel = this.sp("Accel");
      speed = c.speed + Math.max(-accel, Math.min(accel, speed - c.speed));
    }

    // Move, but never onto land or off the map.
    if (speed > 0 && c.alive) {
      const nx = c.x + Math.cos(c.heading) * speed;
      const ny = c.y + Math.sin(c.heading) * speed;
      const ni = Math.floor(ny) * GRID_W + Math.floor(nx);
      if (nx >= 0 && ny >= 0 && nx < GRID_W && ny < GRID_H && h.isWater(ni)) {
        c.x = nx;
        c.y = ny;
      } else {
        // Bumped the shore anyway: stop and turn away.
        c.heading += Math.PI * (0.5 + h.rng());
        c.desired = c.heading;
        this.dropTarget(c);
        speed = 0;
      }
    }
    c.speed = speed;
    c.phase += speed * 12; // wiggle only while moving
    if (!c.alive) return;

    // Energy: moving costs ½·m·v² (fat adds mass), living costs energy per unit
    // of mass, and boosting multiplies the living cost while it lasts.
    const mass = bodyMass(c) + c.fat * this.sp("FatMass");
    const upkeep = this.sp("Metabolism") * mass * (boosting ? this.host.p.sharkBoostMetabolism : 1);
    c.energy -= this.sp("MoveCost") * 0.5 * mass * speed * speed + upkeep;
    // Fat: store spare energy, or draw on fat when running low.
    const eMax = this.sp("EnergyMax");
    if (c.energy > 0.7 * eMax && c.fat < t[T_MAX_FAT]) {
      const put = Math.min((c.energy - 0.7 * eMax) * t[T_FAT_TEND], t[T_MAX_FAT] - c.fat);
      c.energy -= put;
      c.fat += put;
    } else if (c.energy < 0.3 * eMax && c.fat > 0) {
      const take = Math.min(0.3 * eMax - c.energy, c.fat);
      c.energy += take;
      c.fat -= take;
    }
    // Growing up: while it has spare energy it grows toward its adult size,
    // paying energy for each unit of body mass it adds.
    if (c.grown < 1 && c.energy > 0.5 * eMax) {
      const step = Math.min(this.sp("GrowthRate"), 1 - c.grown);
      const cost = step * t[T_BODY] * this.sp("GrowthCost");
      if (c.energy - cost > 0.3 * eMax) {
        c.grown += step;
        c.energy -= cost;
      }
    }
    if (c.energy > eMax) c.energy = eMax; // anything beyond both stores is lost

    // Metabolism also sheds a little of the body's nutrients into the water.
    const shed = c.nutrients * this.sp("NutrientLoss");
    c.nutrients -= shed;
    h.nutrients[here] += shed;

    if (c.energy <= 0 || c.nutrients < this.sp("MinNutrients")) {
      this.starved++;
      this.die(c);
    }
  }

  /** Whether the water is clear for `dist` squares ahead along `angle`. */
  private clearAhead(x: number, y: number, angle: number, dist: number): boolean {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    for (let d = 1; d <= dist; d++) {
      const px = x + dx * d;
      const py = y + dy * d;
      if (px < 0 || py < 0 || px >= GRID_W || py >= GRID_H) return false;
      if (!this.host.isWater(Math.floor(py) * GRID_W + Math.floor(px))) return false;
    }
    return true;
  }

  private dropTarget(c: Critter): void {
    c.hasTarget = false;
    c.mate = null;
    c.prey = null;
  }

  private findFood(c: Critter): void {
    if (this.species.diet === "prey") this.findPrey(c);
    else this.findAlgae(c);
  }

  private findAlgae(c: Critter): void {
    const h = this.host;
    const r = this.sp("FoodRadius");
    const minAlgae = h.p.swimMinAlgaeSize * h.p.algaeMaxN;
    const cx = Math.floor(c.x);
    const cy = Math.floor(c.y);
    let best = -1;
    let bestD = Infinity;
    for (let y = Math.max(0, cy - r); y <= Math.min(GRID_H - 1, cy + r); y++) {
      for (let x = Math.max(0, cx - r); x <= Math.min(GRID_W - 1, cx + r); x++) {
        const i = y * GRID_W + x;
        // Only algae grown big enough is worth eating, so young algae can regrow.
        if (h.kind[i] !== ALGAE_KIND || h.floraN[i] < minAlgae) continue;
        const d = (x + 0.5 - c.x) ** 2 + (y + 0.5 - c.y) ** 2;
        if (d < bestD && d <= r * r) {
          bestD = d;
          best = i;
        }
      }
    }
    this.dropTarget(c);
    if (best >= 0) {
      c.targetX = (best % GRID_W) + 0.5;
      c.targetY = Math.floor(best / GRID_W) + 0.5;
      c.hasTarget = true;
    }
  }

  /** Predators: the nearest living prey within sight; maybe boost after it. */
  private findPrey(c: Critter): void {
    const r = this.sp("FoodRadius");
    const best = nearestIn(this.preyBuckets, r, c, () => true);
    const hadPrey = c.prey;
    this.dropTarget(c);
    if (!best) {
      c.boostLeft = 0;
      return;
    }
    c.prey = best;
    c.hasTarget = true;
    c.targetX = best.x;
    c.targetY = best.y;
    // Newly spotted prey: the genetic boost likelihood decides whether to burst.
    if (best !== hadPrey && c.boostLeft <= 0 && this.host.rng() < c.traits[T_BOOST_CHANCE]) {
      c.boostLeft = this.host.p.sharkBoostDuration;
    }
  }

  private findMate(c: Critter): void {
    const best = nearestIn(this.buckets, this.sp("MateRadius"), c, (o) => o !== c && this.canMate(c, o));
    this.dropTarget(c);
    if (best) {
      c.mate = best;
      c.hasTarget = true;
      c.targetX = best.x;
      c.targetY = best.y;
    }
  }

  /** Both must be ready to breed (see isReady); and not with your own parents (or children). */
  private canMate(a: Critter, b: Critter): boolean {
    return a.parents[0] !== b.id && a.parents[1] !== b.id && b.parents[0] !== a.id && b.parents[1] !== a.id;
  }

  private arrive(c: Critter): void {
    const h = this.host;
    if (c.mate) {
      const m = c.mate;
      this.dropTarget(c);
      if (m.alive && this.isReady(c) && this.isReady(m) && this.canMate(c, m) && Math.hypot(m.x - c.x, m.y - c.y) < 1.5) {
        this.breed(c, m);
      }
      return;
    }
    if (c.prey) {
      // Catch: eat the whole fish (its energy, fat and nutrients).
      const p = c.prey;
      this.dropTarget(c);
      c.boostLeft = 0;
      if (!p.alive) return;
      p.alive = false;
      // Its stored energy plus what its body yields when digested.
      c.energy += p.energy + p.fat + bodyMass(p) * this.host.p.sharkPreyEnergy;
      c.nutrients += p.nutrients;
      p.nutrients = 0;
      this.prey!.eaten++;
      this.prey!.deaths++;
      this.storeSurplus(c);
      return;
    }
    // Algae: eat it in one go.
    this.dropTarget(c);
    const i = Math.floor(c.targetY) * GRID_W + Math.floor(c.targetX);
    if (h.kind[i] === ALGAE_KIND) {
      c.energy += h.floraE[i];
      c.nutrients += h.floraN[i];
      h.floraN[i] = 0;
      h.clearFlora(i);
      this.storeSurplus(c);
    }
  }

  /** Energy beyond the short-term store goes straight to fat where there's room. */
  private storeSurplus(c: Critter): void {
    const eMax = this.sp("EnergyMax");
    if (c.energy > eMax) {
      const put = Math.min(c.energy - eMax, c.traits[T_MAX_FAT] - c.fat);
      if (put > 0) {
        c.fat += put;
        c.energy -= put;
      }
    }
  }

  /** Parents make as many children (up to their preferred litter) as they can afford. */
  private breed(a: Critter, b: Critter): void {
    const want = Math.max(1, Math.round((a.traits[T_LITTER] + b.traits[T_LITTER]) / 2));
    const eMax = this.sp("EnergyMax");
    let made = 0;
    for (let k = 0; k < want; k++) {
      const shareA = a.traits[T_PARENT_SHARE];
      const shareB = b.traits[T_PARENT_SHARE];
      const eA = (a.energy + a.fat) * shareA;
      const eB = (b.energy + b.fat) * shareB;
      const nA = a.nutrients * shareA;
      const nB = b.nutrients * shareB;
      if (eA + eB < this.sp("MinChildEnergy") || nA + nB < this.sp("MinChildNutrients")) break;
      take(a, eA);
      take(b, eB);
      a.nutrients -= nA;
      b.nutrients -= nB;
      const e = eA + eB;
      const child = this.add((a.x + b.x) / 2, (a.y + b.y) / 2, this.childGenes(a, b), [a.id, b.id], Math.min(e, eMax), nA + nB, 0);
      child.grown = Math.min(1, this.sp("BirthSize")); // babies start small and grow
      child.fat = Math.min(Math.max(0, e - eMax), child.traits[T_MAX_FAT]); // any remainder beyond fat is lost
      made++;
    }
    if (made > 0) {
      this.births += made;
      a.cooldown = b.cooldown = this.sp("BreedCooldown");
    }
    function take(c: Critter, amount: number): void {
      const fromEnergy = Math.min(c.energy, amount);
      c.energy -= fromEnergy;
      c.fat -= amount - fromEnergy;
    }
  }

  /** 11 random genes from each parent (each slightly mutated) plus one brand-new gene. */
  private childGenes(a: Critter, b: Critter): Gene[] {
    const h = this.host;
    const strength = this.sp("GeneStrength");
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
    while (out.length < GENE_COUNT_CRITTER) out.push(randomGene(h.rng, strength, this.species.traits.length));
    return out;
  }

  /** Death: energy is lost, the body stays and rots, returning its nutrients gradually. */
  private die(c: Critter): void {
    c.alive = false;
    this.deaths++;
    this.corpses.push({ x: c.x, y: c.y, nutrients: c.nutrients });
    c.nutrients = 0;
  }

  private rot(): void {
    if (!this.corpses.length) return;
    const h = this.host;
    const rate = this.sp("RotRate");
    const keep: Corpse[] = [];
    for (const k of this.corpses) {
      const i = Math.floor(k.y) * GRID_W + Math.floor(k.x);
      let r = k.nutrients * rate;
      if (k.nutrients - r < 1e-4) r = k.nutrients;
      k.nutrients -= r;
      h.nutrients[i] += r;
      if (k.nutrients > 0) keep.push(k);
    }
    this.corpses = keep;
  }

  /** Re-applies the (possibly edited) trait defaults to every living critter. */
  reexpress(): void {
    for (const c of this.critters) {
      c.traits = expressTraits(c.genes, this.species.traits);
      c.colour = colourOf(c.traits);
    }
  }

  /** Nearest living critter within `r` squares of (x, y), if any. */
  nearest(x: number, y: number, r: number): Critter | null {
    let best: Critter | null = null;
    let bestD = r * r;
    for (const c of this.critters) {
      if (!c.alive) continue;
      const d = (c.x - x) ** 2 + (c.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  /** Nutrients held in living critters and in their bodies. */
  nutrientTotal(): number {
    let n = 0;
    for (const c of this.critters) n += c.nutrients;
    for (const k of this.corpses) n += k.nutrients;
    return n;
  }

  /** Mean ± sd of each trait over the given critters. */
  static traitStats(list: Critter[], defs: TraitDef[]): Array<{ mean: number; sd: number }> {
    return defs.map((d, t) => {
      if (!list.length) return { mean: NaN, sd: NaN };
      if (d.wrap) {
        // Circular mean for hue.
        let sx = 0, sy = 0;
        for (const c of list) {
          sx += Math.cos((c.traits[t] * Math.PI) / 180);
          sy += Math.sin((c.traits[t] * Math.PI) / 180);
        }
        const m = ((Math.atan2(sy, sx) * 180) / Math.PI + 360) % 360;
        const rlen = Math.hypot(sx, sy) / list.length;
        return { mean: m, sd: (Math.sqrt(-2 * Math.log(Math.max(1e-9, rlen))) * 180) / Math.PI };
      }
      let sum = 0, sq = 0;
      for (const c of list) {
        sum += c.traits[t];
        sq += c.traits[t] ** 2;
      }
      const mean = sum / list.length;
      return { mean, sd: Math.sqrt(Math.max(0, sq / list.length - mean * mean)) };
    });
  }
}

/** Nearest critter to `c` in a bucket map (bucket size = r), within r, passing `ok`. */
function nearestIn(buckets: Map<number, Critter[]>, r: number, c: Critter, ok: (o: Critter) => boolean): Critter | null {
  const bx = Math.floor(c.x / r);
  const by = Math.floor(c.y / r);
  let best: Critter | null = null;
  let bestD = r * r;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const b = buckets.get((bx + dx) * 1000 + by + dy);
      if (!b) continue;
      for (const o of b) {
        if (!o.alive || !ok(o)) continue;
        const d = (o.x - c.x) ** 2 + (o.y - c.y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = o;
        }
      }
    }
  }
  return best;
}
