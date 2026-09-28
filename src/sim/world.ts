import { CELL_COUNT, GRID_H, GRID_W, PARAMS, type Params } from "./config";
import {
  ALGAE_DEFAULTS, G_BREED, G_GERM, G_GROWTH, G_LIFESPAN, G_RANGE, GENE_COUNT,
  GRASS_DEFAULTS, inheritGenes, setGenes,
} from "./genes";
import { mulberry32, type Rng } from "./rng";
import { generateTerrain, type Terrain } from "./terrain";

/** What occupies a square in the flora layer. Only one thing per square. */
export const EMPTY = 0;
export const SEED = 1;
export const GRASS = 2;
export const ALGAE = 3;

const NEIGHBOURS_X = [-1, 0, 1, -1, 1, -1, 0, 1];
const NEIGHBOURS_Y = [-1, -1, -1, 0, 0, 1, 1, 1];

export interface Stats {
  tick: number;
  seeds: number;
  grass: number;
  algae: number;
  grassBirths: number;
  grassDeaths: number;
  algaeBirths: number;
  algaeDeaths: number;
  starved: number;
  oldAge: number;
  nutrientsGround: number;
  nutrientsWater: number;
  nutrientsFlora: number;
  nutrientsTotal: number;
}

export class World {
  readonly terrain: Terrain;
  readonly p: Params;
  readonly rng: Rng;
  tick = 0;

  /** Nutrients in the ground (land squares) or dissolved in the water (water squares). */
  readonly nutrients = new Float64Array(CELL_COUNT);
  /** Energy banked in each square, topped up every tick. */
  readonly energy = new Float32Array(CELL_COUNT);

  // Flora layer (structure of arrays, indexed by square)
  readonly kind = new Uint8Array(CELL_COUNT);
  readonly floraN = new Float64Array(CELL_COUNT); // nutrients held by the organism / seed
  readonly floraE = new Float32Array(CELL_COUNT); // energy held by the organism / seed
  readonly age = new Int32Array(CELL_COUNT); // ticks alive (seeds: ticks until germination)
  readonly bornTick = new Int32Array(CELL_COUNT);
  readonly genes = new Float32Array(CELL_COUNT * GENE_COUNT);

  // Precomputed nutrient conductance to the right / down neighbour.
  private readonly condR = new Float32Array(CELL_COUNT);
  private readonly condD = new Float32Array(CELL_COUNT);
  private readonly fluxR = new Float64Array(CELL_COUNT);
  private readonly fluxD = new Float64Array(CELL_COUNT);

  // Running counters since last stats read
  private births = [0, 0];
  private deaths = [0, 0];
  private starved = 0;
  private oldAge = 0;

  constructor(seed: number, params: Params = PARAMS) {
    this.p = params;
    this.terrain = generateTerrain(seed);
    this.rng = mulberry32(seed ^ 0x9e3779b9);
    this.buildConductance();
    this.seedInitialState();
  }

  private buildConductance(): void {
    const { water, moisture } = this.terrain;
    const { waterDiffusion, wetDiffusion } = this.p;
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        const i = y * GRID_W + x;
        if (x < GRID_W - 1) this.condR[i] = conductance(i, i + 1);
        if (y < GRID_H - 1) this.condD[i] = conductance(i, i + GRID_W);
      }
    }
    // Water squares mix freely; any edge touching land only exchanges
    // through wet ground, more slowly the drier it is. Dry land never moves.
    function conductance(a: number, b: number): number {
      if (water[a] && water[b]) return waterDiffusion;
      return wetDiffusion * Math.min(moisture[a], moisture[b]);
    }
  }

  private seedInitialState(): void {
    const { water, fertility } = this.terrain;
    const rng = this.rng;
    for (let i = 0; i < CELL_COUNT; i++) {
      this.nutrients[i] = water[i]
        ? this.p.waterNutrients
        : this.p.landNutrients * fertility[i] * (0.8 + 0.4 * rng());
      this.energy[i] = this.p.energyCap * rng();
    }
    let placed = 0;
    for (let tries = 0; placed < this.p.initialSeeds && tries < 1e6; tries++) {
      const i = Math.floor(rng() * CELL_COUNT);
      if (water[i] || this.kind[i] !== EMPTY || this.nutrients[i] < this.p.seedN) continue;
      this.nutrients[i] -= this.p.seedN;
      this.kind[i] = SEED;
      this.floraN[i] = this.p.seedN;
      this.floraE[i] = this.p.seedE;
      this.age[i] = 1 + Math.floor(rng() * GRASS_DEFAULTS[G_GERM]);
      setGenes(this.genes, i, GRASS_DEFAULTS);
      placed++;
    }
    placed = 0;
    for (let tries = 0; placed < this.p.initialAlgae && tries < 1e6; tries++) {
      const i = Math.floor(rng() * CELL_COUNT);
      if (!water[i] || this.kind[i] !== EMPTY || this.nutrients[i] < this.p.algaeChildN) continue;
      this.nutrients[i] -= this.p.algaeChildN;
      this.kind[i] = ALGAE;
      this.floraN[i] = this.p.algaeChildN;
      this.floraE[i] = this.p.algaeChildE;
      setGenes(this.genes, i, ALGAE_DEFAULTS);
      placed++;
    }
  }

  step(): void {
    this.tick++;
    this.addEnergy();
    this.diffuseNutrients();
    // Alternate sweep direction so low-index squares don't always act first.
    if (this.tick & 1) {
      for (let i = 0; i < CELL_COUNT; i++) this.updateSquare(i);
    } else {
      for (let i = CELL_COUNT - 1; i >= 0; i--) this.updateSquare(i);
    }
  }

  private addEnergy(): void {
    const e = this.energy;
    const add = this.p.energyPerTick;
    const cap = this.p.energyCap;
    for (let i = 0; i < CELL_COUNT; i++) {
      const v = e[i] + add;
      e[i] = v > cap ? cap : v;
    }
  }

  /** Conservative diffusion: every unit leaving one square arrives in its neighbour. */
  private diffuseNutrients(): void {
    const n = this.nutrients;
    const { condR, condD, fluxR, fluxD } = this;
    const W = GRID_W;
    for (let i = 0; i < CELL_COUNT; i++) {
      const cr = condR[i];
      fluxR[i] = cr > 0 ? cr * (n[i] - n[i + 1]) : 0;
      const cd = condD[i];
      fluxD[i] = cd > 0 ? cd * (n[i] - n[i + W]) : 0;
    }
    for (let i = 0; i < CELL_COUNT; i++) {
      let v = n[i] - fluxR[i] - fluxD[i];
      if (i % W > 0) v += fluxR[i - 1];
      if (i >= W) v += fluxD[i - W];
      n[i] = v;
    }
  }

  private updateSquare(i: number): void {
    const k = this.kind[i];
    if (k === EMPTY || this.bornTick[i] === this.tick) return;
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
    const moist = this.terrain.moisture[i];

    // Absorb energy from the ground; wetter ground makes this more efficient.
    const eff = p.grassDryAbsorb + (1 - p.grassDryAbsorb) * moist;
    let e = this.floraE[i];
    let take = Math.min(p.grassAbsorb * eff, p.grassMaxE - e, this.energy[i]);
    if (take > 0) {
      this.energy[i] -= take;
      e += take;
    }

    // Metabolise. If the plant can't pay, it dies.
    const size = this.floraN[i] / p.grassMaxN;
    const cost = p.grassMetaBase + p.grassMetaSize * size
      + p.grassMetaGrowthGene * genes[g + G_GROWTH]
      + p.grassMetaLifespan * genes[g + G_LIFESPAN];
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

    // Grow: move nutrients from the ground into the plant, paid for with energy.
    let n = this.floraN[i];
    if (n < p.grassMaxN) {
      let dn = Math.min(genes[g + G_GROWTH], p.grassMaxN - n, this.nutrients[i]);
      dn = Math.min(dn, e / p.growEnergyPerN);
      if (dn > 0) {
        this.nutrients[i] -= dn;
        n += dn;
        e -= dn * p.growEnergyPerN;
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
    if (this.terrain.water[t] || this.kind[t] !== EMPTY) {
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
    const depth = this.terrain.depth[i];
    const light = 1 - p.algaeDepthShade * (depth - 1) / 5;
    let e = this.floraE[i];
    const take = Math.min(p.algaeAbsorb * light, p.algaeMaxE - e, this.energy[i]);
    if (take > 0) {
      this.energy[i] -= take;
      e += take;
    }

    const size = this.floraN[i] / p.algaeMaxN;
    const cost = p.algaeMetaBase + p.algaeMetaSize * size
      + p.algaeMetaGrowthGene * genes[g + G_GROWTH]
      + p.algaeMetaLifespan * genes[g + G_LIFESPAN];
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

    // Grow from nutrients dissolved in this water square.
    let n = this.floraN[i];
    if (n < p.algaeMaxN) {
      let dn = Math.min(genes[g + G_GROWTH], p.algaeMaxN - n, this.nutrients[i]);
      dn = Math.min(dn, e / p.growEnergyPerN);
      if (dn > 0) {
        this.nutrients[i] -= dn;
        n += dn;
        e -= dn * p.growEnergyPerN;
      }
    }

    // Breed: bud a live algae cell into a free adjacent water square, if there is one.
    if (n >= p.algaeMaxN * p.fullGrowth && this.rng() < genes[g + G_BREED]
      && e >= p.algaeChildE + p.algaeBreedReserve && this.nutrients[i] >= p.algaeChildN) {
      const t = this.freeWaterNeighbour(i);
      if (t >= 0) {
        e -= p.algaeChildE;
        this.nutrients[i] -= p.algaeChildN;
        this.kind[t] = ALGAE;
        this.floraN[t] = p.algaeChildN;
        this.floraE[t] = p.algaeChildE;
        this.age[t] = 0;
        this.bornTick[t] = this.tick;
        inheritGenes(genes, i, t, this.rng);
        this.births[1]++;
      }
    }

    this.floraN[i] = n;
    this.floraE[i] = e;
  }

  private freeWaterNeighbour(i: number): number {
    const x = i % GRID_W;
    const y = (i / GRID_W) | 0;
    const start = (this.rng() * 8) | 0;
    for (let k = 0; k < 8; k++) {
      const d = (start + k) & 7;
      const nx = x + NEIGHBOURS_X[d];
      const ny = y + NEIGHBOURS_Y[d];
      if (nx < 0 || ny < 0 || nx >= GRID_W || ny >= GRID_H) continue;
      const t = ny * GRID_W + nx;
      if (this.terrain.water[t] && this.kind[t] === EMPTY) return t;
    }
    return -1;
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
    let seeds = 0, grass = 0, algae = 0;
    let ground = 0, waterN = 0, flora = 0;
    const water = this.terrain.water;
    for (let i = 0; i < CELL_COUNT; i++) {
      const k = this.kind[i];
      if (k === SEED) seeds++;
      else if (k === GRASS) grass++;
      else if (k === ALGAE) algae++;
      if (water[i]) waterN += this.nutrients[i];
      else ground += this.nutrients[i];
      flora += this.floraN[i];
    }
    const s: Stats = {
      tick: this.tick,
      seeds, grass, algae,
      grassBirths: this.births[0],
      grassDeaths: this.deaths[0],
      algaeBirths: this.births[1],
      algaeDeaths: this.deaths[1],
      starved: this.starved,
      oldAge: this.oldAge,
      nutrientsGround: ground,
      nutrientsWater: waterN,
      nutrientsFlora: flora,
      nutrientsTotal: ground + waterN + flora,
    };
    this.births = [0, 0];
    this.deaths = [0, 0];
    this.starved = 0;
    this.oldAge = 0;
    return s;
  }

  /**
   * Aggregates everything inside the inclusive rectangle (x0,y0)-(x1,y1):
   * terrain, nutrients, energy, and per-kind organism stats with gene spread.
   */
  regionStats(x0: number, y0: number, x1: number, y1: number): RegionStats {
    const { water, height, moisture } = this.terrain;
    const r: RegionStats = {
      squares: 0, land: 0, water: 0,
      meanHeight: 0, meanLandMoisture: 0,
      groundNutrients: 0, waterNutrients: 0, floraNutrients: 0, meanEnergy: 0,
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
        r.meanEnergy += this.energy[i];
        if (water[i]) {
          r.water++;
          r.waterNutrients += this.nutrients[i];
        } else {
          r.land++;
          r.meanLandMoisture += moisture[i];
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
    r.meanEnergy /= r.squares || 1;
    r.meanLandMoisture /= r.land || 1;
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
  groundNutrients: number;
  waterNutrients: number;
  floraNutrients: number;
  meanEnergy: number;
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
