import { CELL_COUNT, GRID_H, GRID_W, PARAMS, type Params } from "./config";
import {
  ALGAE_DEFAULTS, G_BREED, G_GERM, G_GROWTH, G_LIFESPAN, G_RANGE, G_WATER_PREF, G_WATER_TOL,
  GENE_COUNT, GRASS_DEFAULTS, inheritGenes, mutateInto, setGenes,
} from "./genes";
import { SporeSystem } from "./spores";
import { Hydrology } from "./hydrology";
import { Wind } from "./wind";
import { CAT, CritterSystem, FISH, ROC, SHARK, SHEEP, type CritterHost } from "./critters";
import { mulberry32, type Rng } from "./rng";
import { generateTerrain, type Terrain } from "./terrain";
import { Gardener } from "./gardener";

/** What occupies a square in the flora layer. Only one thing per square. */
export const EMPTY = 0;
export const SEED = 1;
export const GRASS = 2;
export const ALGAE = 3;

/** A seed the gardener carries: its genes, nutrients and energy. */
export interface SeedPack {
  genes: Float32Array;
  n: number;
  e: number;
}


export interface Stats {
  tick: number;
  seeds: number;
  /** Algae spores drifting in the water. */
  spores: number;
  grass: number;
  algae: number;
  grassBirths: number;
  grassDeaths: number;
  algaeBirths: number;
  algaeDeaths: number;
  starved: number;
  oldAge: number;
  /** Grass drowned by rising water, algae stranded by falling water, seeds washed away. */
  habitatLost: number;
  nutrientsGround: number;
  nutrientsWater: number;
  nutrientsFlora: number;
  /** Nutrients and energy held by grass (with seeds) and by algae (with drifting spores). */
  nutrientsGrass: number;
  nutrientsAlgae: number;
  energyGrass: number;
  energyAlgae: number;
  /** Nutrients in living animals (fish, sharks, sheep, cats) and their rotting bodies. */
  nutrientsAnimals: number;
  nutrientsTotal: number;
  fish: CritterCounts;
  sharks: CritterCounts;
  sheep: CritterCounts;
  cats: CritterCounts;
  rocs: CritterCounts;
  waterSurface: number;
  waterSoil: number;
  waterCloud: number;
  waterTotal: number;
  raining: boolean;
  /** Squares currently under water. */
  waterSquares: number;
}

export interface CritterCounts {
  alive: number;
  corpses: number;
  births: number;
  deaths: number;
  starved: number;
  oldAge: number;
  eaten: number;
  /** Killed or taken by the gardener. */
  culled: number;
}

function counts(c: CritterSystem): CritterCounts {
  return {
    alive: c.critters.filter((x) => x.alive).length,
    corpses: c.corpses.length,
    births: c.births,
    deaths: c.deaths,
    starved: c.starved,
    oldAge: c.oldAge,
    eaten: c.eaten,
    culled: c.culled,
  };
}

export class World {
  readonly terrain: Terrain;
  readonly water: Hydrology;
  readonly wind: Wind;
  readonly fish: CritterSystem;
  readonly sharks: CritterSystem;
  readonly sheep: CritterSystem;
  readonly cats: CritterSystem;
  readonly rocs: CritterSystem;
  /** Algae spores drifting in the water (how algae breed). */
  readonly spores: SporeSystem;
  /** The person looking after the world (null if there isn't one). */
  gardener: Gardener | null = null;
  readonly p: Params;
  readonly rng: Rng;
  tick = 0;

  /** Nutrients in the ground (land squares) or dissolved in the water (water squares). */
  readonly nutrients = new Float64Array(CELL_COUNT);

  // Flora layer (structure of arrays, indexed by square)
  readonly kind = new Uint8Array(CELL_COUNT);
  readonly floraN = new Float64Array(CELL_COUNT); // nutrients held by the organism / seed
  readonly floraE = new Float32Array(CELL_COUNT); // energy held by the organism / seed
  readonly age = new Int32Array(CELL_COUNT); // ticks alive (seeds: ticks until germination)
  readonly bornTick = new Int32Array(CELL_COUNT);
  readonly genes = new Float32Array(CELL_COUNT * GENE_COUNT);

  private readonly fluxR = new Float64Array(CELL_COUNT);
  private readonly fluxD = new Float64Array(CELL_COUNT);

  // Running counters since last stats read
  private births = [0, 0];
  private deaths = [0, 0];
  private starved = 0;
  private oldAge = 0;
  private habitatLost = 0;

  constructor(seed: number, params: Params = PARAMS) {
    this.p = params;
    this.terrain = generateTerrain(seed);
    this.wind = new Wind(seed, params);
    this.water = new Hydrology(this.terrain, params, this.wind);
    this.rng = mulberry32(seed ^ 0x9e3779b9);
    const host: CritterHost = {
      p: this.p,
      rng: this.rng,
      kind: this.kind,
      floraN: this.floraN,
      floraE: this.floraE,
      nutrients: this.nutrients,
      isWater: (i) => this.water.isWater(i),
      clearFlora: (i) => {
        this.deaths[this.kind[i] === ALGAE ? 1 : 0]++;
        this.kind[i] = EMPTY;
        this.floraN[i] = 0;
        this.floraE[i] = 0;
        this.age[i] = 0;
      },
    };
    this.fish = new CritterSystem(host, FISH);
    this.sheep = new CritterSystem(host, SHEEP);
    this.sharks = new CritterSystem(host, SHARK, [this.fish, this.sheep]);
    this.rocs = new CritterSystem(host, ROC, [this.fish, this.sheep]);
    this.cats = new CritterSystem(host, CAT, [this.sheep, this.rocs]);
    this.spores = new SporeSystem({
      p: this.p,
      rng: this.rng,
      nutrients: this.nutrients,
      wet: this.water.wet,
      settle: (i, sp) => {
        if (!this.water.isWater(i) || this.kind[i] !== EMPTY) return false;
        this.kind[i] = ALGAE;
        this.floraN[i] = sp.n;
        this.floraE[i] = sp.e;
        this.age[i] = 0;
        this.bornTick[i] = this.tick;
        this.genes.set(sp.genes, i * GENE_COUNT);
        this.births[1]++;
        return true;
      },
      sharks: () => this.sharks.critters,
    });
    this.seedInitialState();
  }

  private seedInitialState(): void {
    const { fertility } = this.terrain;
    const water = this.water;
    const rng = this.rng;
    for (let i = 0; i < CELL_COUNT; i++) {
      this.nutrients[i] = water.isWater(i)
        ? this.p.waterNutrients
        : this.p.landNutrients * fertility[i] * (0.8 + 0.4 * rng());
    }
    let placed = 0;
    for (let tries = 0; placed < this.p.initialSeeds && tries < 1e6; tries++) {
      if (this.addSeed(Math.floor(rng() * CELL_COUNT), rng)) placed++;
    }
    placed = 0;
    for (let tries = 0; placed < this.p.initialAlgae && tries < 1e6; tries++) {
      if (this.addAlgae(Math.floor(rng() * CELL_COUNT))) placed++;
    }
    placed = 0;
    for (let tries = 0; placed < this.p.initialFish && tries < 1e6; tries++) {
      if (this.fish.spawnRandom(rng() * GRID_W, rng() * GRID_H)) placed++;
    }
    placed = 0;
    for (let tries = 0; placed < this.p.initialSharks && tries < 1e6; tries++) {
      if (this.sharks.spawnRandom(rng() * GRID_W, rng() * GRID_H)) placed++;
    }
    placed = 0;
    for (let tries = 0; placed < this.p.initialSheep && tries < 1e6; tries++) {
      if (this.sheep.spawnRandom(rng() * GRID_W, rng() * GRID_H)) placed++;
    }
    placed = 0;
    for (let tries = 0; placed < this.p.initialCats && tries < 1e6; tries++) {
      if (this.cats.spawnRandom(rng() * GRID_W, rng() * GRID_H)) placed++;
    }
    placed = 0;
    for (let tries = 0; placed < this.p.initialRocs && tries < 1e6; tries++) {
      if (this.rocs.spawnRandom(rng() * GRID_W, rng() * GRID_H)) placed++;
    }
    if (this.p.initialGardener >= 1) this.spawnGardener();
  }

  /**
   * Puts the gardener on a random land square. Their body's nutrients come
   * from the ground around them, so nutrients stay conserved.
   */
  spawnGardener(): void {
    for (let tries = 0; tries < 10000; tries++) {
      const x = Math.floor(this.rng() * GRID_W);
      const y = Math.floor(this.rng() * GRID_H);
      if (this.water.isWater(y * GRID_W + x)) continue;
      let want = 2;
      for (let r = 0; r <= 12 && want > 0; r++) {
        for (let sy = Math.max(0, y - r); sy <= Math.min(GRID_H - 1, y + r); sy++) {
          for (let sx = Math.max(0, x - r); sx <= Math.min(GRID_W - 1, x + r); sx++) {
            const i = sy * GRID_W + sx;
            const take = Math.min(want, this.nutrients[i] * 0.5);
            this.nutrients[i] -= take;
            want -= take;
          }
        }
      }
      this.gardener = new Gardener(this, x + 0.5, y + 0.5, 2 - want);
      return;
    }
  }

  /**
   * The gardener eats the plant or seed on square i: returns its nutrients
   * and energy and clears the square (not counted as a death). Never spores.
   */
  eatFlora(i: number): { n: number; e: number } | null {
    if (this.kind[i] === EMPTY) return null;
    const got = { n: this.floraN[i], e: this.floraE[i] };
    this.kind[i] = EMPTY;
    this.floraN[i] = 0;
    this.floraE[i] = 0;
    this.age[i] = 0;
    return got;
  }

  /** The gardener picks up the seed on square i (with its genes). */
  takeSeed(i: number): SeedPack | null {
    if (this.kind[i] !== SEED) return null;
    const pack = { genes: this.genes.slice(i * GENE_COUNT, (i + 1) * GENE_COUNT), n: this.floraN[i], e: this.floraE[i] };
    this.kind[i] = EMPTY;
    this.floraN[i] = 0;
    this.floraE[i] = 0;
    this.age[i] = 0;
    return pack;
  }

  /** The gardener sows a seed on square i (empty land only). */
  plantSeed(i: number, pack: SeedPack): boolean {
    if (this.water.isWater(i) || this.kind[i] !== EMPTY) return false;
    this.kind[i] = SEED;
    this.floraN[i] = pack.n;
    this.floraE[i] = pack.e;
    this.genes.set(pack.genes, i * GENE_COUNT);
    this.age[i] = 1 + Math.floor(this.rng() * pack.genes[G_GERM]);
    this.bornTick[i] = this.tick;
    return true;
  }

  /**
   * Places a new grass seed with the starting genes (used at world creation
   * and by the seed spray tool). Its nutrients come from the square's ground,
   * so nutrients stay conserved. Returns false if the square is water,
   * occupied, or too poor in nutrients.
   */
  addSeed(i: number, rng: Rng = this.rng): boolean {
    if (this.water.isWater(i) || this.kind[i] !== EMPTY || this.nutrients[i] < this.p.seedN) return false;
    this.nutrients[i] -= this.p.seedN;
    this.kind[i] = SEED;
    this.floraN[i] = this.p.seedN;
    this.floraE[i] = this.p.seedE;
    this.bornTick[i] = this.tick;
    this.age[i] = 1 + Math.floor(rng() * GRASS_DEFAULTS[G_GERM]);
    setGenes(this.genes, i, GRASS_DEFAULTS);
    // Start with a spread of water preferences so every moisture niche has
    // a chance from the outset; evolution then refines them.
    const pref = GRASS_DEFAULTS[G_WATER_PREF] + (rng() - 0.5) * this.p.initialWaterPrefSpread;
    this.genes[i * GENE_COUNT + G_WATER_PREF] = Math.max(0.01, Math.min(1, pref));
    return true;
  }

  /**
   * Places a new algae cell with the starting genes, taking its nutrients
   * from the water. Returns false on land, occupied or nutrient-poor squares.
   */
  addAlgae(i: number): boolean {
    if (!this.water.isWater(i) || this.kind[i] !== EMPTY || this.nutrients[i] < this.p.algaeChildN) return false;
    this.nutrients[i] -= this.p.algaeChildN;
    this.kind[i] = ALGAE;
    this.floraN[i] = this.p.algaeChildN;
    this.floraE[i] = this.p.algaeChildE;
    this.bornTick[i] = this.tick;
    this.age[i] = 0;
    setGenes(this.genes, i, ALGAE_DEFAULTS);
    return true;
  }

  /**
   * Destructor tool: removes all life within `r` squares of (x, y): grass,
   * seeds, algae, animals and their bodies. Nothing is counted as a death;
   * every nutrient goes back to its square, so nutrients stay conserved.
   */
  destroyLife(x: number, y: number, r: number): void {
    const r2 = r * r;
    for (let sy = Math.max(0, Math.floor(y - r)); sy <= Math.min(GRID_H - 1, Math.ceil(y + r)); sy++) {
      for (let sx = Math.max(0, Math.floor(x - r)); sx <= Math.min(GRID_W - 1, Math.ceil(x + r)); sx++) {
        if ((sx - x) ** 2 + (sy - y) ** 2 > r2) continue;
        const i = sy * GRID_W + sx;
        if (this.kind[i] === EMPTY) continue;
        this.nutrients[i] += this.floraN[i];
        this.kind[i] = EMPTY;
        this.floraN[i] = 0;
        this.floraE[i] = 0;
        this.age[i] = 0;
      }
    }
    // Animals and spores by position (centred on the square, matching the brush).
    for (const sys of [this.fish, this.sharks, this.sheep, this.cats, this.rocs]) sys.removeWithin(x + 0.5, y + 0.5, r);
    this.spores.removeWithin(x + 0.5, y + 0.5, r);
  }

  step(): void {
    this.tick++;
    this.wind.step();
    this.water.step(this.tick);
    // Nutrients spread slowly; every other tick is plenty.
    if (this.tick & 1) this.diffuseNutrients();
    // Alternate sweep direction so low-index squares don't always act first.
    if (this.tick & 1) {
      for (let i = 0; i < CELL_COUNT; i++) this.updateSquare(i);
    } else {
      for (let i = CELL_COUNT - 1; i >= 0; i--) this.updateSquare(i);
    }
    this.spores.step();
    this.fish.step();
    this.sharks.step();
    this.sheep.step();
    this.cats.step();
    this.rocs.step();
    this.gardener?.step();
    this.fish.removeDead(); // fish eaten by sharks and rocs this tick
    this.sheep.removeDead(); // sheep eaten by cats and rocs this tick
    this.rocs.removeDead(); // rocs eaten by cats this tick // fish eaten by sharks this tick
  }

  /**
   * Conservative diffusion: every unit leaving one square arrives in its
   * neighbour. Water squares mix freely; any edge touching land only
   * exchanges through wet ground, more slowly the drier it is.
   */
  private diffuseNutrients(): void {
    const n = this.nutrients;
    const { fluxR, fluxD } = this;
    const { waterDiffusion, wetDiffusion } = this.p;
    const W = GRID_W;
    const { wet, sat, notLastCol, notFirstCol } = this.water;
    for (let i = 0; i < CELL_COUNT; i++) {
      const ni = n[i];
      const sa = sat[i];
      let f = 0;
      if (notLastCol[i]) {
        const j = i + 1;
        const c = wet[i] & wet[j] ? waterDiffusion : wetDiffusion * (sa < sat[j] ? sa : sat[j]);
        f = c * (ni - n[j]);
      }
      fluxR[i] = f;
      f = 0;
      if (i + W < CELL_COUNT) {
        const j = i + W;
        const c = wet[i] & wet[j] ? waterDiffusion : wetDiffusion * (sa < sat[j] ? sa : sat[j]);
        f = c * (ni - n[j]);
      }
      fluxD[i] = f;
    }
    for (let i = 0; i < CELL_COUNT; i++) {
      let v = n[i] - fluxR[i] - fluxD[i];
      if (notFirstCol[i]) v += fluxR[i - 1];
      if (i >= W) v += fluxD[i - W];
      n[i] = v;
    }
  }

  private updateSquare(i: number): void {
    const k = this.kind[i];
    if (k === EMPTY || this.bornTick[i] === this.tick) return;
    // Water levels move: land flora drowns, algae gets stranded.
    if (this.water.isWater(i) === (k !== ALGAE)) {
      this.habitatLost++;
      this.kill(i, k === ALGAE ? 1 : 0);
      return;
    }
    if (k === GRASS) this.updateGrass(i);
    else if (k === SEED) this.updateSeed(i);
    else this.updateAlgae(i);
  }

  private updateSeed(i: number): void {
    // Seeds lie dormant (no metabolism) until their germination timer runs out.
    if (--this.age[i] > 0) return;
    this.kind[i] = GRASS;
    this.age[i] = 0;
    this.births[0]++;
  }

  private updateGrass(i: number): void {
    const p = this.p;
    const g = i * GENE_COUNT;
    const genes = this.genes;
    const age = ++this.age[i];

    // How well the plant can use energy and nutrients peaks at its preferred
    // soil saturation. Wide tolerance lowers the peak (generalist's cost).
    const tol = genes[g + G_WATER_TOL];
    const miss = (this.water.saturation(i) - genes[g + G_WATER_PREF]) / tol;
    const eff = Math.max(0, 1 - p.grassToleranceCost * tol) * Math.exp(-miss * miss);
    let e = this.floraE[i];
    // Sunlight can't be stored by the ground: a plant uses what arrives this
    // tick (up to its own uptake limit) and the rest is lost.
    const take = Math.min(p.grassAbsorb * eff, p.grassMaxE - e, p.energyPerTick);
    if (take > 0) e += take;

    // Metabolise (cheaper the richer its soil). If the plant can't pay, it dies.
    const rich = this.richness(i);
    const size = this.floraN[i] / p.grassMaxN;
    const cost = (p.grassMetaBase + p.grassMetaSize * size
      + p.grassMetaGrowthGene * genes[g + G_GROWTH]
      + p.grassMetaLifespan * genes[g + G_LIFESPAN]) / rich;
    if (e < cost) {
      this.starved++;
      this.kill(i, 0);
      return;
    }
    e -= cost;
    if (age >= genes[g + G_LIFESPAN]) {
      this.oldAge++;
      this.kill(i, 0);
      return;
    }

    // Grow: move nutrients from the ground into the plant, paid for with
    // energy. Richer soil makes it faster and cheaper.
    let n = this.floraN[i];
    if (n < p.grassMaxN) {
      const perN = p.growEnergyPerN / rich;
      let dn = Math.min(genes[g + G_GROWTH] * eff * rich, p.grassMaxN - n, this.nutrients[i]);
      dn = Math.min(dn, e / perN);
      if (dn > 0) {
        this.nutrients[i] -= dn;
        n += dn;
        e -= dn * perN;
      }
    }

    // Breed: throw a seed in a random direction.
    if (n >= p.grassMaxN * p.fullGrowth && this.rng() < genes[g + G_BREED]) {
      const range = genes[g + G_RANGE];
      const seedCost = p.seedE + p.seedRangeCost * range;
      if (e >= seedCost + p.grassBreedReserve && this.nutrients[i] >= p.seedN) {
        e -= seedCost;
        this.nutrients[i] -= p.seedN;
        this.throwSeed(i, range);
      }
    }

    this.floraN[i] = n;
    this.floraE[i] = e;
  }

  private throwSeed(parent: number, range: number): void {
    const p = this.p;
    const px = parent % GRID_W;
    const py = (parent / GRID_W) | 0;
    const angle = this.rng() * Math.PI * 2;
    const dist = 1 + this.rng() * (range - 1);
    const x = Math.round(px + Math.cos(angle) * dist);
    const y = Math.round(py + Math.sin(angle) * dist);

    if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) {
      // Off the edge of the world: the seed falls back at the parent's feet and rots.
      this.nutrients[parent] += p.seedN;
      return;
    }
    const t = y * GRID_W + x;
    if (this.water.isWater(t) || this.kind[t] !== EMPTY) {
      // Landed in water or on an occupied square: its nutrients go to that square.
      this.nutrients[t] += p.seedN;
      return;
    }
    this.kind[t] = SEED;
    this.floraN[t] = p.seedN;
    this.floraE[t] = p.seedE;
    this.bornTick[t] = this.tick;
    inheritGenes(this.genes, parent, t, this.rng);
    this.age[t] = Math.max(1, Math.round(this.genes[t * GENE_COUNT + G_GERM]));
  }

  private updateAlgae(i: number): void {
    const p = this.p;
    const g = i * GENE_COUNT;
    const genes = this.genes;
    const age = ++this.age[i];

    // Deeper water gets less light.
    const depth = this.water.surface[i];
    const light = 1 - p.algaeDepthShade * Math.min(1, (depth - p.waterDepthMin) / 5.5);
    let e = this.floraE[i];
    const take = Math.min(p.algaeAbsorb * light, p.algaeMaxE - e, p.energyPerTick);
    if (take > 0) e += take;

    // Metabolise (cheaper the richer its water).
    const rich = this.richness(i);
    const size = this.floraN[i] / p.algaeMaxN;
    const cost = (p.algaeMetaBase + p.algaeMetaSize * size
      + p.algaeMetaGrowthGene * genes[g + G_GROWTH]
      + p.algaeMetaLifespan * genes[g + G_LIFESPAN]) / rich;
    if (e < cost) {
      this.starved++;
      this.kill(i, 1);
      return;
    }
    e -= cost;
    if (age >= genes[g + G_LIFESPAN]) {
      this.oldAge++;
      this.kill(i, 1);
      return;
    }

    // Grow from nutrients dissolved in this water square: faster and
    // cheaper the richer the water.
    let n = this.floraN[i];
    if (n < p.algaeMaxN) {
      const perN = p.growEnergyPerN / rich;
      let dn = Math.min(genes[g + G_GROWTH] * rich, p.algaeMaxN - n, this.nutrients[i]);
      dn = Math.min(dn, e / perN);
      if (dn > 0) {
        this.nutrients[i] -= dn;
        n += dn;
        e -= dn * perN;
      }
    }

    // Breed: release a spore, which drifts off and later settles as a new
    // cell (see spores.ts). Algae can release spores once half grown
    // (algaeBreedSize), before fish find it worth eating, so grazed waters
    // can recover.
    if (n >= p.algaeMaxN * p.algaeBreedSize && this.rng() < genes[g + G_BREED]
      && e >= p.algaeChildE + p.algaeBreedReserve && this.nutrients[i] >= p.algaeChildN) {
      e -= p.algaeChildE;
      this.nutrients[i] -= p.algaeChildN;
      const sporeGenes = new Float32Array(GENE_COUNT);
      mutateInto(genes, g, sporeGenes, 0, this.rng);
      this.spores.release((i % GRID_W) + 0.5, Math.floor(i / GRID_W) + 0.5, sporeGenes, p.algaeChildN, p.algaeChildE);
    }

    this.floraN[i] = n;
    this.floraE[i] = e;
  }

  /**
   * How much the nutrients in square i help a plant or algae there: 1 with
   * none, rising in a straight line with no upper limit (1 + boost at
   * nutrientBoostRef nutrients, 1 + 2·boost at twice that...). Upkeep and
   * the energy cost of growing are divided by it; growth speed is
   * multiplied by it.
   */
  private richness(i: number): number {
    const p = this.p;
    return 1 + p.nutrientBoost * Math.max(0, this.nutrients[i]) / p.nutrientBoostRef;
  }

  /** Death: all nutrients held return to the ground / water beneath. */
  private kill(i: number, type: 0 | 1): void {
    this.nutrients[i] += this.floraN[i];
    this.floraN[i] = 0;
    this.floraE[i] = 0;
    this.kind[i] = EMPTY;
    this.age[i] = 0;
    this.deaths[type]++;
  }

  /** Scans the world for population / nutrient totals and resets event counters. */
  stats(): Stats {
    const sw = this.fish;
    const sh = this.sharks;
    let seeds = 0, grass = 0, algae = 0;
    let ground = 0, waterN = 0, flora = 0, waterSquares = 0;
    let grassN = 0, algaeN = 0, grassE = 0, algaeE = 0;
    const water = this.water;
    for (let i = 0; i < CELL_COUNT; i++) {
      const k = this.kind[i];
      if (k === SEED) seeds++;
      else if (k === GRASS) grass++;
      else if (k === ALGAE) algae++;
      if (water.isWater(i)) {
        waterN += this.nutrients[i];
        waterSquares++;
      } else ground += this.nutrients[i];
      flora += this.floraN[i];
      if (k === ALGAE) {
        algaeN += this.floraN[i];
        algaeE += this.floraE[i];
      } else if (k !== EMPTY) {
        grassN += this.floraN[i];
        grassE += this.floraE[i];
      }
    }
    flora += this.spores.nutrientTotal(); // spores are algae on the move
    algaeN += this.spores.nutrientTotal();
    algaeE += this.spores.energyTotal();
    const animals = sw.nutrientTotal() + sh.nutrientTotal() + this.sheep.nutrientTotal() + this.cats.nutrientTotal() + this.rocs.nutrientTotal() + (this.gardener ? this.gardener.nutrientTotal() : 0);
    const s: Stats = {
      tick: this.tick,
      seeds, grass, algae, spores: this.spores.spores.length,
      nutrientsGrass: grassN, nutrientsAlgae: algaeN, energyGrass: grassE, energyAlgae: algaeE,
      grassBirths: this.births[0],
      grassDeaths: this.deaths[0],
      algaeBirths: this.births[1],
      algaeDeaths: this.deaths[1],
      starved: this.starved,
      oldAge: this.oldAge,
      nutrientsGround: ground,
      nutrientsWater: waterN,
      nutrientsFlora: flora,
      nutrientsAnimals: animals,
      nutrientsTotal: ground + waterN + flora + animals,
      fish: counts(sw),
      sharks: counts(sh),
      sheep: counts(this.sheep),
      cats: counts(this.cats),
      rocs: counts(this.rocs),
      habitatLost: this.habitatLost,
      ...(() => {
        const m = water.measure();
        return { waterSurface: m.surface, waterSoil: m.soil, waterCloud: m.cloud, waterTotal: m.total };
      })(),
      raining: water.raining,
      waterSquares,
    };
    this.births = [0, 0];
    this.deaths = [0, 0];
    this.starved = 0;
    this.oldAge = 0;
    this.habitatLost = 0;
    for (const c of [sw, sh, this.sheep, this.cats, this.rocs]) c.births = c.deaths = c.starved = c.oldAge = c.eaten = c.culled = 0;
    return s;
  }

  /**
   * Aggregates everything inside the inclusive rectangle (x0,y0)-(x1,y1):
   * terrain, water, nutrients and per-kind organism stats with gene spread.
   */
  regionStats(x0: number, y0: number, x1: number, y1: number): RegionStats {
    const { height } = this.terrain;
    const water = this.water;
    const r: RegionStats = {
      squares: 0, land: 0, water: 0,
      meanHeight: 0, meanLandMoisture: 0, meanWaterDepth: 0, waterVolume: 0, meanCloud: 0,
      groundNutrients: 0, waterNutrients: 0, floraNutrients: 0,
      grass: emptyGroup(), seeds: emptyGroup(), algae: emptyGroup(),
    };
    const sq = new Array<number>(GENE_COUNT);
    const groups = [null, r.seeds, r.grass, r.algae];
    const sums = [null, sq.slice().fill(0), sq.slice().fill(0), sq.slice().fill(0)] as Array<number[] | null>;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * GRID_W + x;
        r.squares++;
        r.meanHeight += height[i];
        r.waterVolume += water.surface[i] + water.soilColumn(i);
        r.meanCloud += water.cloudAt(x, y);
        if (water.isWater(i)) {
          r.water++;
          r.meanWaterDepth += water.surface[i];
          r.waterNutrients += this.nutrients[i];
        } else {
          r.land++;
          r.meanLandMoisture += water.saturation(i);
          r.groundNutrients += this.nutrients[i];
        }
        const k = this.kind[i];
        if (k === EMPTY) continue;
        r.floraNutrients += this.floraN[i];
        const grp = groups[k]!;
        const sumSq = sums[k]!;
        grp.count++;
        grp.meanNutrients += this.floraN[i];
        grp.meanEnergy += this.floraE[i];
        grp.meanAge += this.age[i];
        const g = i * GENE_COUNT;
        for (let j = 0; j < GENE_COUNT; j++) {
          const v = this.genes[g + j];
          const gs = grp.genes[j];
          gs.mean += v;
          sumSq[j] += v * v;
          if (v < gs.min) gs.min = v;
          if (v > gs.max) gs.max = v;
        }
      }
    }
    r.meanHeight /= r.squares || 1;
    r.meanLandMoisture /= r.land || 1;
    r.meanWaterDepth /= r.water || 1;
    r.meanCloud /= r.squares || 1;
    for (let k = SEED; k <= ALGAE; k++) {
      const grp = groups[k]!;
      const n = grp.count;
      if (!n) continue;
      grp.meanNutrients /= n;
      grp.meanEnergy /= n;
      grp.meanAge /= n;
      for (let j = 0; j < GENE_COUNT; j++) {
        const gs = grp.genes[j];
        gs.mean /= n;
        gs.sd = Math.sqrt(Math.max(0, sums[k]![j] / n - gs.mean * gs.mean));
      }
    }
    return r;
  }
}

export interface GeneStats {
  mean: number;
  sd: number;
  min: number;
  max: number;
}

export interface GroupStats {
  count: number;
  meanNutrients: number;
  meanEnergy: number;
  /** For seeds: mean ticks left until germination. */
  meanAge: number;
  genes: GeneStats[];
}

export interface RegionStats {
  squares: number;
  land: number;
  water: number;
  meanHeight: number;
  meanLandMoisture: number;
  meanWaterDepth: number;
  /** Surface + soil water in the area. */
  waterVolume: number;
  meanCloud: number;
  groundNutrients: number;
  waterNutrients: number;
  floraNutrients: number;
  grass: GroupStats;
  seeds: GroupStats;
  algae: GroupStats;
}

function emptyGroup(): GroupStats {
  return {
    count: 0, meanNutrients: 0, meanEnergy: 0, meanAge: 0,
    genes: Array.from({ length: GENE_COUNT }, () => ({ mean: 0, sd: 0, min: Infinity, max: -Infinity })),
  };
}
