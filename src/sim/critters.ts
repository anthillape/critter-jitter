import { GRID_H, GRID_W, type Params } from "./config";
import { QuadTree } from "./quadtree";
import type { Rng } from "./rng";

/**
 * Critters: creatures that move freely through the water or over the land,
 * with genomes.
 *
 * - Fish are small and eat algae.
 * - Sharks are bigger and eat fish. They can boost after spotting prey.
 * - Sheep live on land and graze grass, meandering about. Caught in water,
 *   they swim for the shore, and sharks can catch them there.
 * - Cats live on land and hunt sheep: they stalk the nearest one slowly,
 *   then pounce when close enough.
 *
 * All share one lifecycle. They store fat, hunt when hungry, find a ready
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

// Trait indices shared by every species.
export const T_MAX_FAT = 0, T_MIN_SPEED = 1, T_MAX_SPEED = 2, T_HUE = 3,
  T_BREED_AGE = 4, T_BREED_FAT = 5, T_HUNGER_FAT = 6, T_LIFESPAN = 7, T_PARENT_SHARE = 8, T_LITTER = 9,
  T_MUTATION = 10, T_BODY = 11, T_ROAM_SPEED = 12, T_DIGEST = 13;
// Species-specific traits follow the shared ones. Fish and sharks: full
// colour (saturation, lightness); sharks also boosting.
export const T_SAT = 14, T_LUM = 15, T_BOOST_CHANCE = 16, T_BOOST_POWER = 17;
// Land animals (hue-only colour, so no saturation / lightness): meandering and
// swimming; sheep also have grass sight, cats pounce distance, in the same slot.
export const T_WANDER_ARC = 14, T_GRASS_SIGHT = 15, T_POUNCE = 15, T_SWIM = 16;
// Rocs: meandering on foot, then flying preference and flying speed in the same slots.
export const T_FLY_PREF = 15, T_AIR_SPEED = 16;

type TraitDefaults = Partial<Record<string, Partial<TraitDef>>>;

/**
 * The traits every critter has, with the given per-species defaults, then
 * (with `colour`) saturation and lightness, then the species' own extras.
 */
function traitList(o: TraitDefaults, colour: boolean, extras: TraitDef[] = []): TraitDef[] {
  const t: TraitDef[] = [
    { key: "maxFat", label: "Fat store max", tip: "Most fat it can carry. Fat is its only energy store: everything it eats goes into fat, and everything it does is paid from it.", def: 5, min: 0.2, max: 100, mode: "mul", spread: 0.8 },
    { key: "minSpeed", label: "Minimum speed", tip: "Slowest it moves when it's going anywhere, in squares per tick.", def: 0.01, min: 0.001, max: 0.2, mode: "mul", spread: 0.6 },
    { key: "maxSpeed", label: "Top speed", tip: "Speed while chasing food or a mate, in squares per tick.", def: 0.07, min: 0.01, max: 0.5, mode: "mul", spread: 0.6 },
    { key: "hue", label: "Colour hue", tip: "Hue of its colour, in degrees. Founders take it from their genes; children inherit the midpoint of their parents' hues, slightly mutated.", def: 200, min: 0, max: 360, mode: "add", spread: 140, wrap: true },
    { key: "breedAge", label: "Breeding age", tip: "Age (ticks) from which it starts prioritising breeding.", def: 900, min: 60, max: 40000, mode: "mul", spread: 0.6 },
    { key: "breedFat", label: "Fat needed to breed", tip: "Fat it needs before it starts looking for a mate.", def: 2, min: 0, max: 100, mode: "mul", spread: 0.6 },
    { key: "hungerFat", label: "Hunger threshold", tip: "When fat falls below this, it actively hunts for food.", def: 1.5, min: 0, max: 100, mode: "mul", spread: 0.7 },
    { key: "lifespan", label: "Lifespan", tip: "Age (ticks) at which it dies of old age.", def: 7000, min: 300, max: 100000, mode: "mul", spread: 0.4 },
    { key: "parentShare", label: "Share given to each child", tip: "Share of its own nutrients and fat a parent gives each child.", def: 0.2, min: 0.02, max: 0.6, mode: "add", spread: 0.12 },
    { key: "litterSize", label: "Preferred litter size", tip: "How many children it would like per mating (if the parents can afford them).", def: 2, min: 1, max: 12, mode: "mul", spread: 0.5 },
    { key: "mutation", label: "Mutation size", tip: "How much inherited genes change, randomly, in each child.", def: 0.45, min: 0.005, max: 1, mode: "mul", spread: 0.6 },
    { key: "bodySize", label: "Body size", tip: "Body mass: bigger critters cost more to move and to keep alive.", def: 1, min: 0.3, max: 12, mode: "mul", spread: 0.35 },
    { key: "roamSpeed", label: "Roaming speed", tip: "Speed while roaming randomly (with nothing in sight), in squares per tick. Kept between the minimum and top speeds.", def: 0.025, min: 0.001, max: 0.3, mode: "mul", spread: 0.6 },
    { key: "digestRate", label: "Digestion speed", tip: "Share of its stomach's capacity it digests each tick. Faster digestion costs more: the share of the food used up digesting it rises with the speed, so the cost per tick rises with its square.", def: 0.004, min: 0.0002, max: 0.1, mode: "mul", spread: 0.5 },
  ];
  if (colour) {
    t.push(
      { key: "sat", label: "Colour saturation", tip: "Saturation of its colour.", def: 0.65, min: 0.05, max: 1, mode: "add", spread: 0.35 },
      { key: "lum", label: "Colour lightness", tip: "Lightness of its colour.", def: 0.62, min: 0.3, max: 0.9, mode: "add", spread: 0.25 },
    );
  }
  t.push(...extras);
  for (const d of t) Object.assign(d, o[d.key] ?? {});
  return t;
}

export interface SpeciesDef {
  key: "fish" | "shark" | "sheep" | "cat" | "roc";
  /** Singular / plural names for the UI. */
  name: string;
  plural: string;
  /** Prefix of this species' settings in PARAMS (e.g. "fish" -> fishMoveCost). */
  prefix: "fish" | "shark" | "sheep" | "cat" | "roc";
  /** What it eats: algae on the grid, the prey species, or grass (grazed a bite at a time). */
  diet: "algae" | "prey" | "grass";
  /** Where it lives. Land critters caught in water swim for the shore; water critters on land are stuck. */
  habitat: "water" | "land";
  /** Swims in strokes and glides between them (sharks), rather than holding a steady speed. */
  glides?: boolean;
  /** Bumps into others of its kind (sheep): bodies push apart instead of overlapping. */
  collides?: boolean;
  /** Now and then scans the water for the most prey in any direction (sharks). */
  senses?: boolean;
  /** Can fly anywhere over the map as well as walk on land (rocs). */
  flies?: boolean;
  /** Colour comes from hue alone, always a pastel (light) or dark shade. */
  shade?: "pastel" | "dark" | "tawny";
  /** Predators: how they close in, a boost (sharks) or a pounce (cats). */
  hunt?: "boost" | "pounce";
  /** Describes it when it's out of its habitat. */
  stranded: string;
  traits: TraitDef[];
}

/** Prey's wariness: how far off it notices a hunter that could catch it (and runs). */
function wariness(def: number, hunters: string): TraitDef {
  return {
    key: "wariness", label: "Wariness",
    tip: `How far (squares) it notices ${hunters} that could catch it, and runs away at top speed. Warier animals escape more often, but staying alert costs fat (see Cost of staying alert) and running costs fat and feeding time.`,
    def, min: 0, max: 40, mode: "add", spread: 4,
  };
}

export const FISH: SpeciesDef = {
  key: "fish", name: "fish", plural: "fish", prefix: "fish", diet: "algae", habitat: "water", stranded: "stranded on land",
  traits: traitList({}, true, [wariness(6, "sharks and diving rocs")]),
};

export const SHARK: SpeciesDef = {
  key: "shark", name: "shark", plural: "sharks", prefix: "shark", diet: "prey", hunt: "boost", glides: true, senses: true, habitat: "water", stranded: "stranded on land",
  traits: traitList({
      maxFat: { def: 20 },
      minSpeed: { def: 0.02 },
      maxSpeed: { def: 0.13 },
      roamSpeed: { def: 0.06 },
      hue: { def: 215, spread: 60 },
      sat: { def: 0.18, spread: 0.2 },
      lum: { def: 0.6, spread: 0.15 },
      breedAge: { def: 2500 },
      breedFat: { def: 8 },
      hungerFat: { def: 6 },
      lifespan: { def: 15000 },
      litterSize: { def: 1.5 },
      bodySize: { def: 6, max: 20, tip: "Adult body mass (babies start small and grow into it). Bigger sharks cost more to move and to keep alive." },
    }, true, [
    { key: "boostChance", label: "Boost likelihood", tip: "Chance a shark bursts into a boost once it has closed in on the prey it's locked on to.", def: 0.5, min: 0, max: 1, mode: "add", spread: 0.3 },
    { key: "boostPower", label: "Boost power", tip: "Boost speed as a multiple of top speed.", def: 2, min: 1, max: 5, mode: "mul", spread: 0.3 },
  ]),
};

export const SHEEP: SpeciesDef = {
  key: "sheep", name: "sheep", plural: "sheep", prefix: "sheep", diet: "grass", habitat: "land", collides: true, shade: "pastel", stranded: "swimming to shore",
  traits: traitList({
    maxFat: { def: 12 },
    minSpeed: { def: 0.004 },
    maxSpeed: { def: 0.03, tip: "Speed while heading for a mate, in squares per tick." },
    roamSpeed: { def: 0.012, tip: "Walking speed while meandering (including looking for grass), in squares per tick. Kept between the minimum and top speeds." },
    hue: { def: 0, spread: 180, tip: "Hue of its (always pastel) fleece, in degrees. Founders take it from their genes; lambs inherit the midpoint of their parents' hues, slightly mutated." },
    breedAge: { def: 2000 },
    breedFat: { def: 8 },
    hungerFat: { def: 4, tip: "When fat falls below this, it grazes any grass it walks over, and now and then heads for the grassiest direction it can see." },
    lifespan: { def: 12000 },
    litterSize: { def: 1.3 },
    bodySize: { def: 2 },
  }, false, [
    { key: "wanderArc", label: "Meander arc", tip: "Width of the arc (degrees) its path wanders within, around its general direction.", def: 50, min: 20, max: 90, mode: "add", spread: 25 },
    { key: "grassSight", label: "Grass sight", tip: "How far (squares) a hungry sheep looks to find the grassiest direction.", def: 18, min: 10, max: 30, mode: "add", spread: 8 },
    { key: "swimAbility", label: "Swimming ability", tip: "0..1. Better swimmers spend less energy swimming but more walking.", def: 0.3, min: 0, max: 1, mode: "add", spread: 0.3 },
    wariness(8, "cats, diving rocs and (while it swims) sharks"),
  ]),
};

const SWIM_ABILITY: TraitDef = { key: "swimAbility", label: "Swimming ability", tip: "0..1. Better swimmers spend less energy swimming but more walking.", def: 0.3, min: 0, max: 1, mode: "add", spread: 0.3 };

export const CAT: SpeciesDef = {
  key: "cat", name: "cat", plural: "cats", prefix: "cat", diet: "prey", hunt: "pounce", senses: true, habitat: "land", shade: "dark", stranded: "swimming to shore",
  traits: traitList({
    maxFat: { def: 20 },
    minSpeed: { def: 0.004 },
    maxSpeed: { def: 0.02, label: "Stalking speed", tip: "Speed while following the sheep it's locked on to (or heading for a mate), in squares per tick." },
    roamSpeed: { def: 0.01, tip: "Walking speed while meandering, in squares per tick. Kept between the minimum and stalking speeds." },
    hue: { def: 20, spread: 180, tip: "Hue of its (always dark) fur, in degrees. Founders take it from their genes; kittens inherit the midpoint of their parents' hues, slightly mutated." },
    breedAge: { def: 3000 },
    breedFat: { def: 8 },
    hungerFat: { def: 6 },
    lifespan: { def: 15000 },
    litterSize: { def: 1.5 },
    bodySize: { def: 4 },
  }, false, [
    { key: "wanderArc", label: "Meander arc", tip: "Width of the arc (degrees) its path wanders within, around its general direction.", def: 60, min: 20, max: 90, mode: "add", spread: 25 },
    { key: "pounceDistance", label: "Pounce distance", tip: "How close (squares) it stalks a sheep before pouncing at it.", def: 5, min: 1.5, max: 15, mode: "mul", spread: 0.4 },
    { ...SWIM_ABILITY, def: 0.2 },
  ]),
};

export const ROC: SpeciesDef = {
  key: "roc", name: "roc", plural: "rocs", prefix: "roc", diet: "prey", flies: true, senses: true, habitat: "land", shade: "tawny", stranded: "taking off from water",
  traits: traitList({
    maxFat: { def: 40, tip: "Most fat it can carry. Rocs eat a lot, but past a point they're too fat to fly (see Too fat to fly)." },
    minSpeed: { def: 0.005 },
    maxSpeed: { def: 0.04, label: "Running speed", tip: "Speed on foot while chasing prey or heading for a mate, in squares per tick." },
    roamSpeed: { def: 0.018, label: "Walking speed", tip: "Speed on foot while wandering, in squares per tick (flying speed is a separate trait)." },
    hue: { def: 30, spread: 60, tip: "Hue of its (tawny) feathers, in degrees." },
    breedAge: { def: 5000 },
    breedFat: { def: 12 },
    hungerFat: { def: 14, tip: "When fat falls below this, it hunts. Rocs have big appetites: they keep eating past the fat they need to breed." },
    lifespan: { def: 40000, tip: "Age (ticks) at which it dies of old age. Rocs are long-lived." },
    litterSize: { def: 1.2 },
    bodySize: { def: 8, max: 30 },
  }, false, [
    { key: "wanderArc", label: "Meander arc", tip: "Width of the arc (degrees) its path wanders within when walking.", def: 50, min: 20, max: 90, mode: "add", spread: 25 },
    { key: "flyPref", label: "Flying preference", tip: "0..1: how much it prefers flying to walking. At each check it takes off with this chance, or lands (over land) with the opposite chance.", def: 0.6, min: 0, max: 1, mode: "add", spread: 0.3 },
    { key: "airSpeed", label: "Flying speed", tip: "Cruising speed in the air, in squares per tick (diving at prey goes faster).", def: 0.12, min: 0.01, max: 0.6, mode: "mul", spread: 0.5 },
    wariness(10, "cats (while it's on the ground; it takes off if it can)"),
  ]),
};

export const SPECIES = [FISH, SHARK, SHEEP, CAT, ROC];

export const GENE_COUNT_CRITTER = 23;
/** Genes taken from each parent (the child also gets one brand-new gene). */
export const GENES_FROM_EACH_PARENT = (GENE_COUNT_CRITTER - 1) / 2;

/** A gene: which traits it touches and by how much (roughly -1..1 each, scaled by gene strength). */
export interface Gene {
  traits: Uint8Array;
  deltas: Float32Array;
}

export const enum Mode { Wander, Hungry, Mating, Stranded, Grazing, Fleeing }
/** Mode descriptions (Stranded is described per species, see SpeciesDef.stranded). */
export const MODE_NAMES = ["roaming", "hunting for food", "looking for a mate", "stranded", "grazing", "running from a hunter"];

export interface Critter {
  id: number;
  x: number;
  y: number;
  heading: number;
  speed: number;
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
  /** Whether it has already decided whether to boost at its current prey. */
  boostTried: boolean;
  /** Gliders (sharks): ticks of tail stroke left; 0 while gliding. */
  stroke: number;
  /** How hard the tail is sweeping, 0..1 (eases in and out, for drawing). */
  tailAmp: number;
  /** Ticks of pounce left (cats), the direction of the pounce, and ticks before it can pounce again. */
  pounceLeft: number;
  pounceDir: number;
  pounceRest: number;
  /** Direction it's turning toward (it turns gradually, at the species' turn rate). */
  desired: number;
  /** Meandering critters (sheep): the general direction they're walking in... */
  general: number;
  /** ...and how far their path has wandered off it (radians, within half the meander arc). */
  wander: number;
  /** Ticks before a sheep will turn around from water again (it's still turning). */
  avoid: number;
  /** Swimming sheep: whether (targetX, targetY) holds the nearest shore. */
  shore: boolean;
  /** Long-range sensing (sharks): the direction it's heading for the most prey it saw, and ticks left doing so. */
  senseDir: number;
  senseLeft: number;
  /** Prey running from a hunter: the way it's running, and ticks left running. */
  fleeDir: number;
  fleeLeft: number;
  /** Stomach: food eaten but not yet digested (energy and nutrients). */
  gutFat: number;
  gutN: number;
  /** Carrying young (no breeding meanwhile), or null. */
  womb: Womb | null;
  /** Rocs: in the air (else on foot, on land). */
  flying: boolean;
  /** Rocs: height above the ground, 0 (landed) to CruiseHeight; eases up and down. */
  alt: number;
  /** Rocs: descending to land (touches down, and starts walking, once low enough). */
  landing: boolean;
  /** Personal space (sheep): which way, and how strongly, it wants to move away from nearby others (worked out each tick). */
  awayX: number;
  awayY: number;
  readonly species: SpeciesDef;
  /** How grown it is: its current size as a share of its genetic adult body size (0..1). */
  grown: number;
  phase: number;
  alive: boolean;
  /**
   * Hue in degrees. Founders get it from their genes; children inherit the
   * midpoint of their parents' hues, slightly mutated. It overrides the hue
   * trait, so families keep drifting colours of their own.
   */
  hue: number;
  /** CSS colour from the hue / saturation / lightness traits. */
  colour: string;
}

/**
 * Young being carried. The partner's share of fat and nutrients is handed
 * over at mating (`gotFat`, `gotN`); the carrier passes its own share
 * across bit by bit (`needFat`, `needN` still to go), and the young are
 * born, all together, once it's done.
 */
export interface Womb {
  young: Array<{ genes: Gene[]; hue: number }>;
  parents: [number, number];
  needN: number;
  needFat: number;
  gotN: number;
  gotFat: number;
}

/** A dead critter rotting where it died; it keeps its shape while it decomposes. */
export interface Corpse {
  x: number;
  y: number;
  /** Nutrients still in the body; they return to the square as it rots. */
  nutrients: number;
  /** Nutrients it had when it died (so decay = nutrients / startNutrients). */
  startNutrients: number;
  heading: number;
  /** Body mass when it died (sets how big it's drawn). */
  mass: number;
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
  /** Removes the grass or algae on square i (it's been eaten). */
  clearFlora(i: number): void;
}

const GRASS_KIND = 2;
const ALGAE_KIND = 3;

/** Current body mass: the genetic adult body size scaled by how grown it is. */
export function bodyMass(c: Critter): number {
  return c.traits[T_BODY] * c.grown;
}

/**
 * Sheep size: the side of its square body, in grid squares (8 pixels across,
 * 2.67 squares, at the default adult body size). Drawing and collisions both use it.
 */
export function sheepSide(mass: number): number {
  return Math.max(0.5, (8 / 3) * Math.sqrt(mass / 2));
}

/** Radius of a colliding critter's body, in squares. */
function bodyRadius(c: Critter): number {
  return sheepSide(bodyMass(c)) / 2;
}

/** How close a predator must get to catch this prey: a square, or its body's edge if it has a solid body. */
function catchReach(prey: Critter): number {
  return prey.species.collides ? 1 + bodyRadius(prey) : 1;
}

export function colourOf(t: Float32Array, sp: SpeciesDef): string {
  if (sp.shade === "pastel") return `hsl(${t[T_HUE].toFixed(0)} 75% 86%)`;
  if (sp.shade === "dark") return `hsl(${t[T_HUE].toFixed(0)} 40% 24%)`;
  if (sp.shade === "tawny") return `hsl(${t[T_HUE].toFixed(0)} 45% 42%)`;
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

/**
 * A trait value drawn from anywhere in its allowed range: evenly on a log
 * scale for traits that scale (whose range spans orders of magnitude;
 * from a thousandth of the top if the range starts at zero), evenly for
 * the rest.
 */
function wildTrait(d: TraitDef, rng: Rng): number {
  if (d.mode === "add") return d.min + rng() * (d.max - d.min);
  const lo = Math.max(d.min, d.max / 1000);
  return lo * Math.exp(rng() * Math.log(d.max / lo));
}

/**
 * Reshapes a set of genes so each trait they express lands on a value
 * drawn from anywhere in its range (see wildTrait): the gap between what
 * the genes give now and the drawn value is shared out over every gene
 * that touches the trait. The genes stay ordinary genes, so children
 * inherit them as usual.
 */
export function makeWild(genes: Gene[], defs: TraitDef[], rng: Rng): void {
  const sum = new Float32Array(defs.length);
  const carriers = new Array<number>(defs.length).fill(0);
  for (const g of genes) for (let k = 0; k < g.traits.length; k++) (sum[g.traits[k]] += g.deltas[k]), carriers[g.traits[k]]++;
  for (let t = 0; t < defs.length; t++) {
    if (!carriers[t]) continue; // (almost never: no gene touches it, so it keeps its default)
    const d = defs[t];
    const v = wildTrait(d, rng);
    const want = d.mode === "mul" ? Math.log(v / d.def) / d.spread : (v - d.def) / d.spread;
    const share = (want - sum[t]) / carriers[t];
    for (const g of genes) for (let k = 0; k < g.traits.length; k++) if (g.traits[k] === t) g.deltas[k] += share;
  }
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
  "MoveCost", "Metabolism", "FatMass", "NutrientLoss", "MinNutrients", "FoodRadius", "MateRadius",
  "FoodInterval", "MateInterval", "BreedCooldown", "MinChildFat", "MinChildNutrients", "RotRate",
  "GeneStrength", "StartFat", "StartNutrients",
  "TurnRate", "Accel", "WanderTurnChance", "WanderTurnSize", "LookAhead",
  // Sheep have no FoodRadius (grass sight is genetic) and use these instead:
  "Bite", "GrazeFloor", "MeanderRate",
  // Land animals caught in water; predators.
  "SwimEffort", "SwimWalkCost", "PounceSpeed", "PounceRest",
  // Gliders (sharks).
  "StrokeTicks", "GlideDrag", "GlideSlack", "TailBeat",
  // Long-range sensing (sharks).
  "SenseRange", "SenseInterval", "SenseRays", "SenseCrowd", "SenseFull",
  // Personal space (sheep).
  "Space", "SpaceWeight",
  // Sensing: least prey seen before it bothers heading that way.
  "SenseMin",
  // Eating and breeding.
  "Stomach", "DigestCost", "GestationRate", "BirthEfficiency", "YoungRadius",
  // Prey: the cost of staying alert (per square of wariness).
  "WaryCost",
  // Flying (rocs).
  "TooFat", "FlightCheck", "DiveBoost", "LandedUpkeep", "HuntUntil", "EdgeMargin", "CruiseHeight", "ClimbRate", "CatchChance", "MissRest",
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
  /** Killed or taken by the gardener. */
  culled = 0;
  /**
   * Events since the UI last read them (for sounds): matings that made
   * children, deaths (including being eaten), kills (predators), and the
   * x position of the latest one.
   */
  readonly sounds = { births: 0, deaths: 0, kills: 0, x: 0 };
  private nextId = 1;
  private tick = 0;
  /** Mate-search buckets: ready critters by coarse cell. */
  private buckets = new Map<number, Critter[]>();
  /** Prey-search buckets (predators only): catchable prey by coarse cell. */
  private preyBuckets = new Map<number, Critter[]>();
  private keys: Record<ParamName, keyof Params>;

  constructor(
    private host: CritterHost,
    readonly species: SpeciesDef,
    /** For predators: the species they eat (land animals only while they're in water). */
    private preySystems: CritterSystem[] = [],
  ) {
    this.keys = Object.fromEntries(PARAM_NAMES.map((n) => [n, `${species.prefix}${n}` as keyof Params])) as Record<ParamName, keyof Params>;
    this.wary = species.traits.findIndex((d) => d.key === "wariness");
    for (const p of preySystems) p.hunters.push(this);
  }

  /** Index of the wariness trait (-1 for species that aren't prey). */
  private readonly wary: number;
  /** The species that hunt this one. */
  readonly hunters: CritterSystem[] = [];

  /**
   * Prey looking out for hunters: the nearest one within its wariness that
   * could catch it where it is now (hunters that fly count only while in
   * the air), or null.
   */
  private spotHunter(c: Critter): Critter | null {
    const r = c.traits[this.wary];
    if (r <= 0) return null;
    let best: Critter | null = null;
    let bd = r * r;
    for (const sys of this.hunters) {
      for (const k of sys.critters) {
        if (!k.alive || (sys.species.flies && !k.flying)) continue;
        const dx = k.x - c.x;
        const dy = k.y - c.y;
        if (Math.abs(dx) > r || Math.abs(dy) > r) continue;
        const d = dx * dx + dy * dy;
        if (d < bd && sys.catchable(c)) (bd = d), (best = k);
      }
    }
    return best;
  }

  /** This species' setting `name` (e.g. "MoveCost"), read live. */
  private sp(name: ParamName): number {
    return this.host.p[this.keys[name]];
  }

  /** Whether square i is where this species lives (water or land). */
  private home(i: number): boolean {
    return this.host.isWater(i) === (this.species.habitat === "water");
  }

  /**
   * Adds a founder with a random genome at (x, y), in its habitat only. Its
   * body nutrients are gathered from the squares around it (up to 4 away),
   * so nutrients stay conserved; it isn't created if there aren't enough.
   */
  /** `wild`: its traits are drawn from anywhere in their ranges (see makeWild), not near the defaults. */
  spawnRandom(x: number, y: number, wild = false): boolean {
    const h = this.host;
    const i = Math.floor(y) * GRID_W + Math.floor(x);
    const n = this.sp("StartNutrients");
    if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H || !this.home(i)) return false;
    if (!this.gatherNutrients(Math.floor(x), Math.floor(y), n)) return false;
    const genes: Gene[] = [];
    for (let g = 0; g < GENE_COUNT_CRITTER; g++) genes.push(randomGene(h.rng, this.sp("GeneStrength"), this.species.traits.length));
    if (wild) makeWild(genes, this.species.traits, h.rng);
    const c = this.add(x, y, genes, [0, 0], n, 0);
    c.fat = Math.min(this.sp("StartFat"), this.fatCap(c));
    // Founder flyers start in the air as often as they'd choose to be.
    if (this.species.flies && h.rng() < c.traits[T_FLY_PREF]) {
      c.flying = true;
      c.alt = this.sp("CruiseHeight");
    }
    return true;
  }

  /** Takes `amount` nutrients from habitat squares near (cx, cy), nearest first. False (and nothing taken) if short. */
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
          if (!this.home(i) || h.nutrients[i] <= 0) continue;
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

  private add(x: number, y: number, genes: Gene[], parents: [number, number], nutrients: number, fat: number, hue?: number): Critter {
    const traits = expressTraits(genes, this.species.traits);
    if (hue !== undefined) traits[T_HUE] = hue;
    const c: Critter = {
      hue: traits[T_HUE],
      id: this.nextId++, x, y, heading: this.host.rng() * Math.PI * 2, speed: 0,
      fat, nutrients, age: 0, cooldown: 0, parents, genes, traits,
      mode: Mode.Wander, targetX: 0, targetY: 0, hasTarget: false, mate: null, prey: null, boostLeft: 0, boostTried: false, stroke: 0, tailAmp: 0, pounceLeft: 0, pounceDir: 0, pounceRest: 0, desired: 0, general: 0, wander: 0, avoid: 0, shore: false, senseDir: 0, senseLeft: 0, fleeDir: 0, fleeLeft: 0, awayX: 0, awayY: 0, gutFat: 0, gutN: 0, womb: null, flying: false, alt: 0, landing: false, species: this.species, grown: 1,
      phase: this.host.rng() * Math.PI * 2, alive: true, colour: colourOf(traits, this.species),
    };
    c.desired = c.general = c.heading;
    this.critters.push(c);
    return c;
  }

  step(): void {
    this.tick++;
    this.buildBuckets();
    if (this.preySystems.length) this.buildPreyBuckets();
    if (this.species.senses) this.buildPreyGrid();
    for (const c of this.critters) if (c.alive) this.update(c);
    if (this.species.collides) this.collide();
    this.removeDead();
    this.rot();
  }

  /**
   * Destructor tool: removes every critter and body within `r` squares of
   * (x, y) outright (not counted as deaths). Their nutrients go back to the
   * square each was on, so nutrients stay conserved.
   */
  removeWithin(x: number, y: number, r: number): void {
    const r2 = r * r;
    const n = this.host.nutrients;
    for (const c of this.critters) {
      if (!c.alive || (c.x - x) ** 2 + (c.y - y) ** 2 > r2) continue;
      c.alive = false;
      n[squareOf(c)] += c.nutrients + c.gutN + (c.womb ? c.womb.gotN : 0);
      c.nutrients = c.gutN = 0;
      c.womb = null;
    }
    this.removeDead();
    this.corpses = this.corpses.filter((k) => {
      if ((k.x - x) ** 2 + (k.y - y) ** 2 > r2) return true;
      n[Math.floor(k.y) * GRID_W + Math.floor(k.x)] += k.nutrients;
      return false;
    });
  }

  /** The gardener's spear: it dies where it stands, leaving a body to rot. */
  cull(c: Critter): void {
    if (!c.alive) return;
    this.culled++;
    this.die(c);
  }

  /**
   * The gardener kills it to eat: no body is left; returns all its energy
   * (fat, undigested food, energy passed to unborn young) and nutrients.
   */
  take(c: Critter): { fat: number; nutrients: number } {
    const fat = Math.max(0, c.fat) + c.gutFat + (c.womb ? c.womb.gotFat : 0);
    const nutrients = c.nutrients + c.gutN + (c.womb ? c.womb.gotN : 0);
    c.alive = false;
    c.fat = c.gutFat = c.nutrients = c.gutN = 0;
    c.womb = null;
    this.culled++;
    this.deaths++;
    this.sounds.deaths++;
    this.sounds.x = c.x;
    this.removeDead();
    return { fat, nutrients };
  }

  /**
   * The gardener picks it up to carry it somewhere: it leaves the world
   * (others stop chasing or courting it) until `release`d.
   */
  lift(c: Critter): void {
    c.alive = false; // so hunters and mates let it go
    this.critters = this.critters.filter((o) => o !== c);
  }

  /** The gardener eats a critter they lifted (caught in the net): returns all its energy and nutrients. */
  consume(c: Critter): { fat: number; nutrients: number } {
    const fat = Math.max(0, c.fat) + c.gutFat + (c.womb ? c.womb.gotFat : 0);
    const nutrients = c.nutrients + c.gutN + (c.womb ? c.womb.gotN : 0);
    c.alive = false;
    c.fat = c.gutFat = c.nutrients = c.gutN = 0;
    c.womb = null;
    this.culled++;
    this.deaths++;
    return { fat, nutrients };
  }

  /** Puts a lifted critter back into the world at (x, y). */
  release(c: Critter, x: number, y: number): void {
    c.alive = true;
    c.x = x;
    c.y = y;
    c.speed = 0;
    c.hasTarget = false;
    c.mate = c.prey = null;
    c.flying = false;
    c.alt = 0;
    c.landing = false;
    this.critters.push(c);
  }

  /** Nutrients held by a critter (body, stomach, unborn young). */
  static nutrientsIn(c: Critter): number {
    return c.nutrients + c.gutN + (c.womb ? c.womb.gotN : 0);
  }

  /** Drops dead critters from the list (also those eaten by predators). */
  removeDead(): void {
    if (this.critters.some((c) => !c.alive)) this.critters = this.critters.filter((c) => c.alive);
  }

  private isReady(c: Critter): boolean {
    const t = c.traits;
    return c.alive && !c.womb && c.cooldown === 0 && c.grown >= 0.9 && c.age >= t[T_BREED_AGE] && c.fat >= t[T_BREED_FAT] && c.fat >= this.hunger(c) && !this.youngNear(c);
  }

  /** Immature members of this species (not yet grown or not yet of breeding age), worked out once a tick. */
  private young: Critter[] = [];
  private youngTick = -1;

  /** Whether an immature one of its kind is within YoungRadius (it won't breed while one is). */
  private youngNear(c: Critter): boolean {
    const r = this.sp("YoungRadius");
    if (r <= 0) return false;
    if (this.youngTick !== this.tick) {
      this.youngTick = this.tick;
      this.young = this.critters.filter((o) => o.alive && (o.grown < 0.9 || o.age < o.traits[T_BREED_AGE]));
    }
    for (const o of this.young) if (o !== c && Math.abs(o.x - c.x) < r && Math.abs(o.y - c.y) < r && Math.hypot(o.x - c.x, o.y - c.y) < r) return true;
    return false;
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
    for (const sys of this.preySystems) for (const c of sys.critters) {
      if (!this.catchable(c)) continue;
      const key = Math.floor(c.x / size) * 1000 + Math.floor(c.y / size);
      let b = this.preyBuckets.get(key);
      if (!b) this.preyBuckets.set(key, (b = []));
      b.push(c);
    }
  }

  /**
   * Whether this predator can catch `p` where it is: never in the air; a
   * flyer can take anything below it; others only in their own habitat
   * (sheep by sharks only while swimming, rocs by cats only once landed).
   */
  /** Whether this (hunting) species could catch p where it is now. */
  catchable(p: Critter): boolean {
    if (!p.alive || p.flying) return false;
    if (this.species.flies) return true;
    return this.home(squareOf(p));
  }

  /**
   * Fat below which it hunts (and grows, and can't breed): its genetic
   * hunger threshold, raised to the fat it needs to breed once it's free to,
   * and by what it still owes its young while pregnant; rocs also keep
   * hunting until they've built up a big reserve (HuntUntil, a share of
   * their fat store, kept just short of too fat to fly).
   */
  private hunger(c: Critter): number {
    const t = c.traits;
    let want = t[T_HUNGER_FAT];
    // An adult free to breed eats until it has the fat to; a pregnant one
    // eats for its young too.
    if (c.womb) want += c.womb.needFat;
    else if (c.cooldown === 0 && c.grown >= 0.9 && c.age >= t[T_BREED_AGE]) want = Math.max(want, t[T_BREED_FAT]);
    if (this.species.flies) {
      const share = Math.min(this.sp("HuntUntil"), this.sp("TooFat") - 0.05);
      want = Math.max(want, share * t[T_MAX_FAT]);
    }
    return Math.min(want, t[T_MAX_FAT]);
  }

  /**
   * Most fat a newborn or founder starts with: what it can carry, and for
   * flyers a little under too fat to fly, so none start out grounded.
   */
  private fatCap(c: Critter): number {
    const max = c.traits[T_MAX_FAT];
    return this.species.flies ? max * Math.max(0.05, this.sp("TooFat") - 0.1) : max;
  }

  /** Rocs: fat enough that it can't get off the ground. */
  private tooFat(c: Critter): boolean {
    return c.fat > this.sp("TooFat") * c.traits[T_MAX_FAT];
  }

  /**
   * Rocs: when to take off and land. Water underfoot always means taking
   * off; too fat means landing at the first land. Otherwise, every
   * FlightCheck ticks the genetic flying preference decides, and it takes
   * off to chase a fish or to head for a crowd it sensed far away.
   */
  private flight(c: Critter, here: number): void {
    const h = this.host;
    const overLand = this.home(here);
    const fat = this.tooFat(c);
    if (!c.flying) {
      if (!overLand) c.flying = true; // never stands in water, however fat
      else if (!fat && ((c.prey && c.prey.species.habitat === "water") || c.senseLeft > 0)) c.flying = true;
      else if (!fat && (this.tick + c.id) % this.sp("FlightCheck") === 0 && h.rng() < c.traits[T_FLY_PREF]) c.flying = true;
      if (c.flying) c.wander = 0;
      return;
    }
    // Only land over land: a descent over water is called off.
    if (!overLand) {
      c.landing = false;
      return;
    }
    const chasingFish = c.prey !== null && c.prey.species.habitat === "water";
    if (!c.landing && (fat || (!chasingFish && c.senseLeft <= 0 && (this.tick + c.id) % this.sp("FlightCheck") === 0 && h.rng() < 1 - c.traits[T_FLY_PREF]))) {
      c.landing = true;
      if (chasingFish) this.dropTarget(c);
    }
    // Touch down once low enough, and start walking.
    if (c.landing && c.alt < 0.1) {
      c.flying = false;
      c.landing = false;
      c.alt = 0;
      c.general = c.heading;
      c.wander = 0;
    }
  }

  /**
   * Rocs: ease toward the height it wants: cruising height in the air,
   * lower and lower as it closes on prey (so it dives), the ground when
   * landing. Diving drops twice as fast as climbing.
   */
  private fly(c: Critter): void {
    const cruise = this.sp("CruiseHeight");
    let want = cruise;
    if (!c.flying || c.landing) want = 0;
    else if (c.prey) want = Math.min(cruise, Math.hypot(c.prey.x - c.x, c.prey.y - c.y) * 0.5);
    const rate = this.sp("ClimbRate");
    c.alt += Math.max(-2 * rate, Math.min(rate, want - c.alt));
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
    if (this.species.flies) {
      this.flight(c, here);
      this.fly(c);
    }
    const flying = c.flying;
    const atHome = flying || this.home(here);
    const land = this.species.habitat === "land";
    // On foot on land (flyers in the air steer like swimmers, over anything).
    const walking = land && !flying;
    const roamSpeed = flying ? t[T_AIR_SPEED] : t[T_ROAM_SPEED];
    const grazer = this.species.diet === "grass";

    // A grazer keeps at a plant until it's gone or it can't store any more.
    if (c.mode === Mode.Grazing && !(h.kind[here] === GRASS_KIND && c.fat < t[T_MAX_FAT])) c.mode = Mode.Wander;

    // Prey keep an eye out for hunters (every few ticks), and run from any they see.
    if (c.fleeLeft > 0) c.fleeLeft--;
    if (this.wary >= 0 && atHome && !flying && (this.tick + c.id) % 5 === 0) {
      const k = this.spotHunter(c);
      if (k) {
        c.fleeDir = Math.atan2(c.y - k.y, c.x - k.x);
        if (c.fleeLeft === 0) this.dropTarget(c);
        c.fleeLeft = 40;
        // A landed flyer takes off if it can.
        if (this.species.flies && !this.tooFat(c)) {
          c.flying = true;
          c.landing = false;
          c.wander = 0;
          c.fleeLeft = 0;
        }
      }
    }

    // Choose what to do.
    if (!atHome) {
      if (c.mode !== Mode.Stranded) {
        this.dropTarget(c);
        c.shore = false;
      }
      c.mode = Mode.Stranded;
    } else if (c.fleeLeft > 0 && !c.flying) {
      c.mode = Mode.Fleeing;
    } else if (c.mode === Mode.Grazing) {
      // Still grazing.
    } else if (grazer && c.fat < this.hunger(c) && h.kind[here] === GRASS_KIND && this.room(c) > 0.05 * this.stomach(c)) {
      this.dropTarget(c);
      c.mode = Mode.Grazing;
    } else if (c.fat < this.hunger(c)) {
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
    // Long-range sensing, when not busy chasing or courting.
    if (this.species.senses && !c.prey && (c.mode === Mode.Wander || c.mode === Mode.Hungry)
      && (this.tick + c.id) % this.sp("SenseInterval") === 0) this.sense(c);

    // Steer and set speed. Water critters stranded on land can't move; land
    // critters caught in water wade on until they reach land. Grazers stand still.
    let speed = 0;
    let boosting = false;
    const moving = c.mode !== Mode.Grazing && (land || c.mode !== Mode.Stranded);
    if (c.mode === Mode.Grazing) {
      c.speed = 0;
      this.graze(c, here);
    } else if (c.hasTarget) {
      const other = c.mate ?? c.prey;
      if (other) {
        // Prey that's gone, or has got out of reach (left the predator's habitat, taken off), is lost.
        if (!other.alive || (other === c.prey && !this.catchable(other))) {
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
    let pouncing = false;
    if (c.avoid > 0) c.avoid--;
    if (c.pounceRest > 0) c.pounceRest--;
    if (!moving || !atHome) c.pounceLeft = 0;
    if (moving && c.pounceLeft > 0) {
      // Pouncing: a fast dash in a fixed direction, catching the prey if it gets close enough.
      pouncing = true;
      c.pounceLeft--;
      c.heading = c.desired = c.pounceDir;
      speed = this.sp("PounceSpeed");
      const p = c.prey;
      if (p && p.alive && (p.x - c.x) ** 2 + (p.y - c.y) ** 2 < catchReach(p) ** 2) this.arrive(c);
      if (c.pounceLeft === 0) c.pounceRest = this.sp("PounceRest");
    } else if (moving && c.mode === Mode.Fleeing) {
      // Running from a hunter: straight away from it at top speed.
      c.desired = c.fleeDir;
      speed = t[T_MAX_SPEED];
    } else if (moving && land && !atHome) {
      // Swimming: head for the nearest shore at half walking speed.
      if (!c.shore || (this.tick + c.id) % 30 === 0) this.findShore(c);
      if (c.shore) c.desired = Math.atan2(c.targetY - c.y, c.targetX - c.x);
      speed = 0.5 * t[T_ROAM_SPEED];
    } else if (moving && c.hasTarget) {
      const dx = c.targetX - c.x;
      const dy = c.targetY - c.y;
      const dist = Math.hypot(dx, dy);
      c.desired = Math.atan2(dy, dx);
      // Close in: turn harder so it doesn't circle what it's chasing.
      if (dist < 3) turnRate *= 3;
      // Heading for something it has spotted: top speed (or boost), easing off at the end.
      let top = flying ? t[T_AIR_SPEED] * this.sp("DiveBoost") : t[T_MAX_SPEED];
      // Close to locked-on prey: pouncers pounce (a fast dash toward where it is now)...
      if (this.species.hunt === "pounce" && c.prey && c.pounceRest === 0 && dist < t[T_POUNCE] && dist >= 1) {
        c.pounceDir = c.heading = c.desired;
        c.pounceLeft = Math.ceil(dist / this.sp("PounceSpeed")) + 3;
      }
      // ...and boosters decide (once, by their genetic boost likelihood) whether to burst.
      if (this.species.hunt === "boost" && c.prey && !c.boostTried && dist < h.p.sharkBoostRange) {
        c.boostTried = true;
        if (h.rng() < t[T_BOOST_CHANCE]) c.boostLeft = h.p.sharkBoostDuration;
      }
      if (c.prey && c.boostLeft > 0) {
        top *= t[T_BOOST_POWER];
        boosting = true;
        c.boostLeft--;
      }
      speed = Math.max(Math.min(t[T_MIN_SPEED], dist), Math.min(top, dist));
      // Arrived: at prey, at a mate (bodies touching, for animals that collide), or at food.
      const reach = c.prey ? catchReach(c.prey) : c.mate && this.species.collides ? bodyRadius(c) + bodyRadius(c.mate) + 0.3 : 0.75;
      if (dist < reach) this.arrive(c);
    } else if (moving && walking) {
      // Meander: the path wanders to and fro within the genetic arc around
      // its general direction, which itself changes now and then.
      // (Cats that sensed a herd from afar meander toward it.)
      if (c.senseLeft > 0) {
        c.senseLeft--;
        c.general = c.senseDir;
      } else if (h.rng() < this.sp("WanderTurnChance")) c.general += (h.rng() - 0.5) * this.sp("WanderTurnSize");
      const half = (t[T_WANDER_ARC] * Math.PI) / 360;
      c.wander = Math.max(-half, Math.min(half, c.wander + (h.rng() - 0.5) * 2 * this.sp("MeanderRate")));
      c.desired = c.general + c.wander;
      speed = roamSpeed;
      // Personal space: bend away from others that are too close.
      if (c.awayX || c.awayY) {
        const w = this.sp("SpaceWeight");
        c.desired = Math.atan2(Math.sin(c.desired) + w * c.awayY, Math.cos(c.desired) + w * c.awayX);
      }
    } else if (moving) {
      // Nothing in sight: roam, picking a new course now and then, or head
      // for the prey it sensed from afar.
      if (c.senseLeft > 0) {
        c.senseLeft--;
        c.desired = c.senseDir;
      } else if (h.rng() < this.sp("WanderTurnChance")) c.desired = c.heading + (h.rng() - 0.5) * this.sp("WanderTurnSize");
      speed = roamSpeed;
      c.boostLeft = 0;
    }
    if (moving && !pouncing) {
      const look = this.sp("LookAhead");
      if (flying) {
        // Nothing is in the way in the air.
      } else if (land) {
        // Water ahead: a land animal turns right round (170-190°, left or right).
        if (c.avoid === 0 && look > 0 && atHome && !this.clearAhead(c.x, c.y, c.heading, look)) this.turnAround(c);
      } else if (look > 0 && atHome && !this.clearAhead(c.x, c.y, c.heading, look)) {
        // Edge of its habitat coming up ahead: pick the nearest clear direction to turn to.
        for (let k = 1; k <= 6; k++) {
          const off = (k * Math.PI) / 6;
          const side = h.rng() < 0.5 ? 1 : -1;
          if (this.clearAhead(c.x, c.y, c.heading + side * off, look)) { c.desired = c.heading + side * off; break; }
          if (this.clearAhead(c.x, c.y, c.heading - side * off, look)) { c.desired = c.heading - side * off; break; }
        }
      }
      // Flyers keep away from the edges of the map, arcing back toward the
      // middle (more sharply the nearer they get), unless diving at prey.
      if (flying && !c.prey) {
        const m = this.sp("EdgeMargin");
        if (m > 0) {
          const ex = c.x < m ? 1 - c.x / m : c.x > GRID_W - m ? -(1 - (GRID_W - c.x) / m) : 0;
          const ey = c.y < m ? 1 - c.y / m : c.y > GRID_H - m ? -(1 - (GRID_H - c.y) / m) : 0;
          if (ex || ey) c.desired = Math.atan2(Math.sin(c.desired) + 3 * ey, Math.cos(c.desired) + 3 * ex);
        }
      }
      let delta = c.desired - c.heading;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      c.heading += Math.max(-turnRate, Math.min(turnRate, delta));
      if (this.species.flies) {
        // Wings flap while turning or speeding up; otherwise it glides.
        const flap = flying && (Math.abs(delta) > 0.05 || speed > c.speed + 1e-4) ? 1 : 0;
        c.tailAmp += (flap - c.tailAmp) * 0.15;
        if (c.tailAmp > 0.02) c.phase += 0.35;
      }
      const accel = this.sp("Accel");
      if (this.species.glides) speed = this.glide(c, speed, boosting);
      else speed = c.speed + Math.max(-accel, Math.min(accel, speed - c.speed));
    }

    // Move, but never out of its habitat (land critters already in water can
    // wade anywhere) or off the map.
    if (moving && speed > 0 && c.alive) {
      const nx = c.x + Math.cos(c.heading) * speed;
      const ny = c.y + Math.sin(c.heading) * speed;
      const ni = Math.floor(ny) * GRID_W + Math.floor(nx);
      if (nx >= 0 && ny >= 0 && nx < GRID_W && ny < GRID_H && (flying || !atHome || this.home(ni))) {
        c.x = nx;
        c.y = ny;
      } else if (walking) {
        // Reached the water's edge anyway: stop and turn right round (once, while it turns).
        if (c.pounceLeft > 0) {
          c.pounceLeft = 0;
          c.pounceRest = this.sp("PounceRest");
        }
        if (c.avoid === 0) this.turnAround(c);
        speed = 0;
      } else {
        // Bumped the edge anyway: stop and turn away.
        c.heading += Math.PI * (0.5 + h.rng());
        c.desired = c.heading;
        this.dropTarget(c);
        speed = 0;
      }
    }
    if (c.mode !== Mode.Grazing) c.speed = speed;
    if (this.species.glides) {
      // The tail only sweeps during a stroke, easing in and out.
      c.tailAmp += ((c.stroke > 0 ? 1 : 0) - c.tailAmp) * 0.12;
      if (c.stroke > 0) c.phase += this.sp("TailBeat");
    } else if (!this.species.flies) {
      c.phase += speed * 12; // wiggle only while moving
    }
    if (!c.alive) return;

    // Fat is its energy: moving costs ½·m·v² (fat adds mass), living costs fat
    // per unit of mass, and boosting multiplies the living cost while it lasts.
    const mass = bodyMass(c) + c.fat * this.sp("FatMass");
    let upkeep = this.sp("Metabolism") * mass * (boosting ? this.host.p.sharkBoostMetabolism : 1);
    if (this.wary >= 0) upkeep *= 1 + this.sp("WaryCost") * t[this.wary]; // staying alert costs fat
    if (this.species.flies && !flying) upkeep *= this.sp("LandedUpkeep"); // resting on the ground is cheaper
    let move = this.sp("MoveCost") * 0.5 * mass * speed * speed;
    if (land && !this.species.flies) {
      // Swimming ability trades off: good swimmers swim cheaply but pay more to walk.
      const a = t[T_SWIM];
      if (atHome) move *= 1 + a * this.sp("SwimWalkCost");
      else move = this.sp("SwimEffort") * mass * (1 - 0.75 * a);
    }
    c.fat -= move + upkeep;
    this.digest(c);
    if (c.womb) this.gestate(c);
    if (!c.alive) return;
    // Growing up: while it isn't hungry it grows toward its adult size,
    // paying fat for each unit of body mass it adds.
    if (c.grown < 1 && c.fat > this.hunger(c)) {
      const step = Math.min(this.sp("GrowthRate"), 1 - c.grown);
      const cost = step * t[T_BODY] * this.sp("GrowthCost");
      if (c.fat - cost > this.hunger(c)) {
        c.grown += step;
        c.fat -= cost;
      }
    }

    // Metabolism also sheds a little of the body's nutrients into its square.
    const shed = c.nutrients * this.sp("NutrientLoss");
    c.nutrients -= shed;
    h.nutrients[here] += shed;

    if (c.fat <= 0 || c.nutrients < this.sp("MinNutrients")) {
      this.starved++;
      this.die(c);
    }
  }

  /** Whether its habitat continues for `dist` squares ahead along `angle`. */
  private clearAhead(x: number, y: number, angle: number, dist: number): boolean {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    for (let d = 1; d <= dist; d++) {
      const px = x + dx * d;
      const py = y + dy * d;
      if (px < 0 || py < 0 || px >= GRID_W || py >= GRID_H) return false;
      if (!this.home(Math.floor(py) * GRID_W + Math.floor(px))) return false;
    }
    return true;
  }

  /**
   * Gliders swim in strokes: a few sweeps of the tail push them a little
   * faster than they want to go, then they glide, slowing gently, until
   * they've dropped far enough below it to take the next stroke. While
   * chasing prey (and boosting), the tail beats without a break. Returns the
   * new speed.
   */
  private glide(c: Critter, want: number, boosting: boolean): number {
    const slack = this.sp("GlideSlack");
    // Chasing prey (or boosting), the tail beats without a break.
    const hunting = boosting || c.prey !== null;
    if (hunting) c.stroke = Math.max(c.stroke, 1);
    else if (c.stroke === 0 && want > 0 && c.speed < want * (1 - slack)) c.stroke = this.sp("StrokeTicks");
    if (c.stroke > 0) {
      c.stroke--;
      // A stroke pushes it a little past the speed it wants (never faster), then ends.
      const cap = want * (1 + slack / 2);
      const speed = Math.min(c.speed + this.sp("Accel"), Math.max(c.speed, cap));
      if (!hunting && speed >= cap) c.stroke = 0;
      return speed;
    }
    return c.speed * (1 - this.sp("GlideDrag"));
  }

  /** Coarse count of catchable prey per SENSE_CELL block, for long-range sensing. */
  private preyGrids: Uint16Array[] = [];

  /** One count grid per prey species, so a roc can leave fish out when it's too fat to catch them. */
  private buildPreyGrid(): void {
    const cw = Math.ceil(GRID_W / SENSE_CELL);
    const ch = Math.ceil(GRID_H / SENSE_CELL);
    this.preySystems.forEach((sys, s) => {
      let g = this.preyGrids[s];
      if (!g || g.length !== cw * ch) g = this.preyGrids[s] = new Uint16Array(cw * ch);
      else g.fill(0);
      for (const p of sys.critters) {
        if (!this.catchable(p)) continue;
        const k = Math.floor(p.y / SENSE_CELL) * cw + Math.floor(p.x / SENSE_CELL);
        if (g[k] < 65535) g[k]++;
      }
    });
  }

  /**
   * Long-range sensing: unless it's already well fed or has plenty of prey
   * close by, it looks in SenseRays directions all round, each a straight
   * line across its habitat (stopping at the shore) up to SenseRange squares,
   * counting the prey along it. It then heads the way it saw the most, for
   * as long as it would take to get there.
   */
  private sense(c: Critter): void {
    if (c.fat >= this.sp("SenseFull") * c.traits[T_MAX_FAT]) return;
    const r = this.sp("FoodRadius");
    let near = 0;
    this.forEachIn(this.preyBuckets, r, c, (o) => {
      if (this.wants(c, o)) near++;
    });
    if (near >= this.sp("SenseCrowd")) return;
    // The grids of the prey it's after; a flyer sees over anything.
    const grids = this.preySystems
      .filter((sys) => !(this.species.flies && sys.species.habitat === "water" && this.tooFat(c)))
      .map((sys) => this.preyGrids[this.preySystems.indexOf(sys)]);
    const seeAll = !!this.species.flies;
    const cw = Math.ceil(GRID_W / SENSE_CELL);
    const range = this.sp("SenseRange");
    const rays = Math.max(4, Math.round(this.sp("SenseRays")));
    let best = 0;
    let bestDir = 0;
    let bestDist = 0;
    for (let k = 0; k < rays; k++) {
      const a = (k / rays) * Math.PI * 2;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      let seen = 0;
      let far = 0; // prey-weighted distance, to judge how far to go
      let lastCell = -1;
      for (let d = 1; d <= range; d++) {
        const x = c.x + dx * d;
        const y = c.y + dy * d;
        if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) break;
        if (!seeAll && !this.home(Math.floor(y) * GRID_W + Math.floor(x))) break;
        const cell = Math.floor(y / SENSE_CELL) * cw + Math.floor(x / SENSE_CELL);
        if (cell === lastCell) continue; // count each block once
        lastCell = cell;
        let n = 0;
        for (const g of grids) n += g[cell];
        seen += n;
        far += n * d;
      }
      if (seen > best) {
        best = seen;
        bestDir = a;
        bestDist = far / seen;
      }
    }
    // Only worth the trip if it saw enough (rocs go only for very large crowds).
    if (best <= 0 || best < this.sp("SenseMin")) return;
    c.senseDir = bestDir;
    // Head that way for as long as it takes to get there (but look again at the next scan).
    const speed = this.species.flies ? c.traits[T_AIR_SPEED] : c.traits[T_ROAM_SPEED];
    c.senseLeft = Math.min(this.sp("SenseInterval"), Math.ceil(bestDist / Math.max(1e-3, speed)));
  }

  /** Calls `f` for each critter in the bucket map (bucket size = r) within r of `c`. */
  private forEachIn(buckets: Map<number, Critter[]>, r: number, c: Critter, f: (o: Critter) => void): void {
    const bx = Math.floor(c.x / r);
    const by = Math.floor(c.y / r);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const b = buckets.get((bx + dx) * 1000 + by + dy);
        if (!b) continue;
        for (const o of b) if (o.alive && (o.x - c.x) ** 2 + (o.y - c.y) ** 2 <= r * r) f(o);
      }
    }
  }

  /**
   * Collisions (sheep): bodies are circles; any two that overlap are pushed
   * apart, half each, along the line between them. A push that would move
   * one into water is skipped (unless it's already swimming). A quadtree
   * finds the neighbours, so this stays cheap with big flocks.
   *
   * The same pass works out personal space: two that aren't looking for a
   * mate and are within Space squares of touching each want to steer away
   * from the other, more strongly the closer they are (used next tick).
   */
  private collide(): void {
    const tree = new QuadTree<Critter>(0, 0, GRID_W, GRID_H);
    let maxR = 0;
    for (const c of this.critters) {
      if (!c.alive) continue;
      tree.insert(c);
      maxR = Math.max(maxR, bodyRadius(c));
      c.awayX = c.awayY = 0;
    }
    const rng = this.host.rng;
    const space = Math.max(0, this.sp("Space"));
    for (const a of this.critters) {
      if (!a.alive) continue;
      const ra = bodyRadius(a);
      tree.query(a.x, a.y, ra + maxR + space, (b) => {
        if (b.id <= a.id || !b.alive) return; // each pair once
        const min = ra + bodyRadius(b);
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d >= min) {
          // Not touching: just keep some space, unless either is after a mate.
          if (d < min + space && a.mode !== Mode.Mating && b.mode !== Mode.Mating) {
            const f = (1 - (d - min) / space) / d;
            a.awayX -= dx * f;
            a.awayY -= dy * f;
            b.awayX += dx * f;
            b.awayY += dy * f;
          }
          return;
        }
        if (d < 1e-6) {
          const ang = rng() * Math.PI * 2;
          dx = Math.cos(ang);
          dy = Math.sin(ang);
          d = 1;
        }
        const push = (min - d) / 2;
        this.nudge(a, (-dx / d) * push, (-dy / d) * push);
        this.nudge(b, (dx / d) * push, (dy / d) * push);
      });
    }
  }

  /** Moves a critter by (dx, dy) if that keeps it on the map and in its habitat (or it's already out of it). */
  private nudge(c: Critter, dx: number, dy: number): void {
    const x = c.x + dx;
    const y = c.y + dy;
    if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) return;
    if (this.home(squareOf(c)) && !this.home(Math.floor(y) * GRID_W + Math.floor(x))) return;
    c.x = x;
    c.y = y;
  }

  /** Turns right round (170-190°, left or right) and takes that as its general direction. */
  private turnAround(c: Critter): void {
    const h = this.host;
    const turn = ((170 + 20 * h.rng()) * Math.PI) / 180;
    c.desired = c.general = c.heading + (h.rng() < 0.5 ? turn : -turn);
    c.wander = 0;
    // Don't turn again until this turn is done.
    c.avoid = Math.ceil(Math.PI / Math.max(1e-3, this.sp("TurnRate"))) + 10;
    this.dropTarget(c);
  }

  /** Swimmers: the nearest land square (searching outward up to 40 squares). */
  private findShore(c: Critter): void {
    const cx = Math.floor(c.x);
    const cy = Math.floor(c.y);
    let bestD = Infinity;
    for (let r = 1; r <= 40; r++) {
      // The nearest land may be in the next ring out (diagonals), so check one more ring.
      if (bestD < Infinity && r * r > bestD) break;
      for (let y = cy - r; y <= cy + r; y++) {
        if (y < 0 || y >= GRID_H) continue;
        const edge = y === cy - r || y === cy + r;
        for (let x = cx - r; x <= cx + r; x += edge ? 1 : 2 * r) {
          if (x < 0 || x >= GRID_W || !this.home(y * GRID_W + x)) continue;
          const d = (x - cx) ** 2 + (y - cy) ** 2;
          if (d < bestD) {
            bestD = d;
            c.targetX = x + 0.5;
            c.targetY = y + 0.5;
          }
        }
      }
    }
    c.shore = bestD < Infinity;
  }

  private dropTarget(c: Critter): void {
    c.hasTarget = false;
    c.mate = null;
    c.prey = null;
  }

  private findFood(c: Critter): void {
    // Too full to eat anything much yet.
    if (this.room(c) < 0.2 * this.stomach(c)) return;
    // A roc that just missed climbs away before picking a new target.
    if (this.species.flies && c.pounceRest > 0) return;
    if (this.species.diet === "prey") this.findPrey(c);
    else if (this.species.diet === "grass") this.findGrass(c);
    else this.findAlgae(c);
  }

  /** Grass (nutrients) per direction, in 8 sectors; reused between searches. */
  private sectors = new Float64Array(8);

  /**
   * Grazers: looks over the grass within its genetic sight range and sets
   * its general direction toward the grassiest of 8 directions. It still
   * meanders, and grazes whatever grass it walks over while hungry.
   */
  private findGrass(c: Critter): void {
    const h = this.host;
    const r = Math.round(c.traits[T_GRASS_SIGHT]);
    const s = this.sectors;
    s.fill(0);
    const cx = Math.floor(c.x);
    const cy = Math.floor(c.y);
    for (let y = Math.max(0, cy - r); y <= Math.min(GRID_H - 1, cy + r); y++) {
      const dy = y - cy;
      for (let x = Math.max(0, cx - r); x <= Math.min(GRID_W - 1, cx + r); x++) {
        const i = y * GRID_W + x;
        if (h.kind[i] !== GRASS_KIND) continue;
        const dx = x - cx;
        if (dx * dx + dy * dy > r * r || (dx === 0 && dy === 0)) continue;
        const sector = Math.floor(((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI)) * 8) & 7;
        s[sector] += h.floraN[i];
      }
    }
    let best = 0;
    for (let k = 1; k < 8; k++) if (s[k] > s[best]) best = k;
    if (s[best] <= 0) return; // no grass in sight: carry on
    c.general = -Math.PI + ((best + 0.5) * 2 * Math.PI) / 8;
    c.wander = 0;
  }

  /**
   * One bite of the grass on square i: a share of its nutrients and energy.
   * Once it's grazed down below the floor, the rest is eaten and it's gone.
   */
  private graze(c: Critter, i: number): void {
    const h = this.host;
    const n = h.floraN[i];
    const bite = Math.min(n, this.sp("Bite"));
    const share = n > 0 ? bite / n : 1;
    const e = h.floraE[i] * share;
    // Only as much as fits in its stomach.
    const f = this.eat(c, e, bite);
    h.floraN[i] -= bite * f;
    h.floraE[i] -= e * f;
    if (f < 1) {
      c.mode = Mode.Wander; // full up
      return;
    }
    if (h.floraN[i] < this.sp("GrazeFloor") * h.p.grassMaxN) {
      const g = this.eat(c, h.floraE[i], h.floraN[i]);
      h.floraN[i] -= h.floraN[i] * g;
      h.floraE[i] -= h.floraE[i] * g;
      if (g >= 1) {
        h.floraN[i] = 0;
        h.clearFlora(i);
      }
      c.mode = Mode.Wander;
    }
  }

  private findAlgae(c: Critter): void {
    const h = this.host;
    const r = this.sp("FoodRadius");
    const minAlgae = h.p.fishMinAlgaeSize * h.p.algaeMaxN;
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

  /**
   * Predators: lock on to the nearest living prey within sight and follow
   * it until it's caught, lost from sight or escapes (see update).
   */
  /** Whether this predator will go after `o` (a roc too fat to fly ignores fish). */
  private wants(c: Critter, o: Critter): boolean {
    return !(this.species.flies && o.species.habitat === "water" && this.tooFat(c));
  }

  private findPrey(c: Critter): void {
    const r = this.sp("FoodRadius");
    const locked = c.prey;
    if (locked && locked.alive && (locked.x - c.x) ** 2 + (locked.y - c.y) ** 2 <= r * r) return;
    const best = nearestIn(this.preyBuckets, r, c, (o) => this.wants(c, o));
    this.dropTarget(c);
    c.boostLeft = 0;
    if (!best) return;
    c.prey = best;
    c.boostTried = false;
    c.hasTarget = true;
    c.targetX = best.x;
    c.targetY = best.y;
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
      if (m.alive && this.isReady(c) && this.isReady(m) && this.canMate(c, m) && Math.hypot(m.x - c.x, m.y - c.y) < (this.species.collides ? bodyRadius(c) + bodyRadius(m) + 0.5 : 1.5)) {
        this.breed(c, m);
      }
      return;
    }
    if (c.prey && this.species.flies && c.flying) {
      // A diving roc can only strike once it's down low...
      if (c.alt > 1) return;
      // ...and even then most dives miss: it climbs away and tries again later.
      if (this.host.rng() >= this.sp("CatchChance")) {
        this.dropTarget(c);
        c.pounceRest = this.sp("MissRest");
        return;
      }
    }
    if (c.prey) {
      // Catch: eat the whole animal: all its fat (its energy) and nutrients.
      const p = c.prey;
      this.dropTarget(c);
      c.boostLeft = 0;
      c.pounceLeft = 0;
      if (!p.alive) return;
      p.alive = false;
      const sys = this.preySystems.find((sy) => sy.species === p.species)!;
      // It eats as much of the body as fits in its stomach: all its energy
      // (fat, and food it hadn't digested) and nutrients (body, stomach and
      // any unborn young). What doesn't fit is left to rot.
      const allN = p.nutrients + p.gutN + (p.womb ? p.womb.gotN : 0);
      const f = this.eat(c, p.fat + p.gutFat, allN);
      const left = allN * (1 - f);
      p.fat = p.gutFat = p.nutrients = p.gutN = 0;
      p.womb = null;
      if (left > 1e-6) {
        sys.corpses.push({ x: p.x, y: p.y, nutrients: left, startNutrients: left, heading: p.heading, mass: bodyMass(p) * (1 - f) });
      }
      sys.eaten++;
      sys.deaths++;
      sys.sounds.deaths++;
      sys.sounds.x = p.x;
      this.sounds.kills++;
      this.sounds.x = c.x;
      return;
    }
    // Algae: eat as much as fits (all of it if there's room; else it's left smaller).
    this.dropTarget(c);
    const i = Math.floor(c.targetY) * GRID_W + Math.floor(c.targetX);
    if (h.kind[i] === ALGAE_KIND) {
      const f = this.eat(c, h.floraE[i], h.floraN[i]);
      if (f >= 1) {
        h.floraN[i] = 0;
        h.clearFlora(i);
      } else {
        h.floraN[i] *= 1 - f;
        h.floraE[i] *= 1 - f;
      }
    }
  }

  /** Stomach capacity (energy plus nutrients): Stomach per unit of current body mass. */
  private stomach(c: Critter): number {
    return this.sp("Stomach") * bodyMass(c);
  }

  /** Room left in its stomach. */
  private room(c: Critter): number {
    return Math.max(0, this.stomach(c) - c.gutFat - c.gutN);
  }

  /**
   * Puts food into its stomach, as much as fits: returns the share of it
   * eaten (0..1), taking that share of both the energy and the nutrients.
   */
  private eat(c: Critter, fat: number, n: number): number {
    const total = Math.max(0, fat) + Math.max(0, n);
    if (total <= 0) return 1;
    const f = Math.min(1, this.room(c) / total);
    c.gutFat += Math.max(0, fat) * f;
    c.gutN += Math.max(0, n) * f;
    return f;
  }

  /**
   * Digestion: each tick it digests its genetic share of its stomach's
   * capacity, moving that food's energy into fat and its nutrients into its
   * body. Digesting uses up DigestCost × speed of the food's worth of fat,
   * so the cost per tick goes up with the square of the speed.
   */
  private digest(c: Critter): void {
    const total = c.gutFat + c.gutN;
    if (total <= 0) return;
    const rate = c.traits[T_DIGEST];
    const amount = Math.min(total, rate * this.stomach(c));
    const f = amount / total;
    const df = c.gutFat * f;
    const dn = c.gutN * f;
    c.gutFat -= df;
    c.gutN -= dn;
    c.fat += df - this.sp("DigestCost") * rate * amount;
    c.nutrients += dn;
    this.storeSurplus(c);
  }

  /**
   * Gestation: the carrier passes nutrients to its young at GestationRate
   * per unit of its body mass per tick (with fat in proportion), so the
   * more nutrients the young need, the longer it takes. It only gives what
   * it can spare; when it's all across, the young are born together.
   */
  private gestate(c: Critter): void {
    const w = c.womb!;
    let dn = Math.min(this.sp("GestationRate") * bodyMass(c), w.needN, Math.max(0, c.nutrients - 2 * this.sp("MinNutrients")));
    if (w.needN <= 1e-9) dn = 0;
    const df = Math.min(w.needN > 1e-9 ? (w.needFat * dn) / w.needN : w.needFat, Math.max(0, c.fat));
    c.nutrients -= dn;
    c.fat -= df;
    w.needN -= dn;
    w.needFat -= df;
    w.gotN += dn;
    w.gotFat += df * this.sp("BirthEfficiency"); // only part of the energy passed across reaches the young
    if (w.needN > 1e-9 || w.needFat > 1e-9) return;
    // Birth: the young share what was passed to them.
    const k = w.young.length;
    for (const y of w.young) {
      const child = this.add(c.x, c.y, y.genes, w.parents, w.gotN / k, 0, y.hue);
      child.grown = Math.min(1, this.sp("BirthSize")); // babies start small and grow
      child.fat = Math.min(w.gotFat / k, this.fatCap(child)); // any beyond what it can carry is lost
    }
    c.womb = null;
    c.cooldown = this.sp("BreedCooldown");
    this.births += k;
    this.sounds.births++;
    this.sounds.x = c.x;
  }

  /** Fat beyond what it can carry is lost. */
  private storeSurplus(c: Critter): void {
    if (c.fat > c.traits[T_MAX_FAT]) c.fat = c.traits[T_MAX_FAT];
  }

  /**
   * Mating: they conceive as many young (up to their preferred litter) as
   * they can afford, each parent giving its genetic share of fat and
   * nutrients per child. One of them, at random, carries the young: the
   * partner hands its share over now, and the carrier passes its own across
   * during gestation (see gestate).
   */
  private breed(a: Critter, b: Critter): void {
    const want = Math.max(1, Math.round((a.traits[T_LITTER] + b.traits[T_LITTER]) / 2));
    const [carrier, other] = this.host.rng() < 0.5 ? [a, b] : [b, a];
    const shareC = carrier.traits[T_PARENT_SHARE];
    const shareO = other.traits[T_PARENT_SHARE];
    const w: Womb = { young: [], parents: [a.id, b.id], needN: 0, needFat: 0, gotN: 0, gotFat: 0 };
    let cf = carrier.fat;
    let cn = carrier.nutrients;
    for (let k = 0; k < want; k++) {
      const fC = cf * shareC;
      const nC = cn * shareC;
      const fO = other.fat * shareO;
      const nO = other.nutrients * shareO;
      if (fC + fO < this.sp("MinChildFat") || nC + nO < this.sp("MinChildNutrients")) break;
      cf -= fC;
      cn -= nC;
      w.needFat += fC;
      w.needN += nC;
      other.fat -= fO;
      other.nutrients -= nO;
      w.gotFat += fO * this.sp("BirthEfficiency"); // only part of the energy handed over reaches the young
      w.gotN += nO;
      w.young.push({ genes: this.childGenes(a, b), hue: this.childHue(a, b) });
    }
    if (!w.young.length) return;
    carrier.womb = w;
    other.cooldown = this.sp("BreedCooldown");
  }

  /**
   * The child's hue: the midpoint of its parents' hues around the colour
   * wheel (so 350° and 10° give 0°, not 180°), nudged by up to ±hueMutation.
   */
  private childHue(a: Critter, b: Critter): number {
    const h = this.host;
    const ra = (a.hue * Math.PI) / 180;
    const rb = (b.hue * Math.PI) / 180;
    const sx = Math.cos(ra) + Math.cos(rb);
    const sy = Math.sin(ra) + Math.sin(rb);
    // Exactly opposite hues have no midpoint: pick either way round.
    let mid = Math.hypot(sx, sy) < 1e-6 ? a.hue + (h.rng() < 0.5 ? 90 : -90) : (Math.atan2(sy, sx) * 180) / Math.PI;
    mid += (h.rng() * 2 - 1) * h.p.hueMutation;
    return ((mid % 360) + 360) % 360;
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
          // No clamp: genes pass on as they are (traits are still kept within
          // their ranges when expressed), so wild founders' genes carry on.
          deltas[j] = g.deltas[j] + (h.rng() * 2 - 1) * mutation;
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
    this.sounds.deaths++;
    this.sounds.x = c.x;
    // The body keeps all its nutrients: its own, its stomach's and any unborn young's.
    const n = c.nutrients + c.gutN + (c.womb ? c.womb.gotN : 0);
    this.corpses.push({ x: c.x, y: c.y, nutrients: n, startNutrients: n, heading: c.heading, mass: bodyMass(c) });
    c.nutrients = c.gutN = c.gutFat = 0;
    c.womb = null;
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
      c.traits[T_HUE] = c.hue; // hue is inherited, not re-derived from genes
      c.colour = colourOf(c.traits, this.species);
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

  /** Energy held by living critters: fat, undigested food, and what's been passed to unborn young. */
  energyTotal(): number {
    let e = 0;
    for (const c of this.critters) if (c.alive) e += Math.max(0, c.fat) + c.gutFat + (c.womb ? c.womb.gotFat : 0);
    return e;
  }

  /** Nutrients held in living critters and in their bodies. */
  nutrientTotal(): number {
    let n = 0;
    for (const c of this.critters) n += c.nutrients + c.gutN + (c.womb ? c.womb.gotN : 0);
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

/** Block size (squares) of the coarse prey-count grid used for long-range sensing. */
const SENSE_CELL = 4;

function squareOf(c: Critter): number {
  return Math.floor(c.y) * GRID_W + Math.floor(c.x);
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
