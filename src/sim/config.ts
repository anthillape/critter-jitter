// World dimensions: an 800x600 canvas where every grid square is 2x2 pixels.
export const CANVAS_W = 800;
export const CANVAS_H = 600;
export const CELL_PX = 2;
export const GRID_W = CANVAS_W / CELL_PX; // 400
export const GRID_H = CANVAS_H / CELL_PX; // 300
export const CELL_COUNT = GRID_W * GRID_H;

// Terrain
export const MIN_HEIGHT = 1;
export const MAX_HEIGHT = 16;
/** Lakes start filled so squares at or below this height are under water. */
export const WATER_LEVEL = 6;
/** Initial soil moisture reaches this many squares from water (then the water cycle takes over). */
export const IRRIGATION_RANGE = 60;
export const NOISE_SCALE = 1 / 120; // larger denominator = bigger landmasses
export const NOISE_OCTAVES = 5;

/**
 * All simulation tunables. "Per tick" everywhere. Energy is not conserved
 * (it arrives every tick, like sunlight); nutrients are strictly conserved.
 */
export const PARAMS = {
  // --- Ground / water ---
  energyPerTick: 0.02, // energy arriving in every square each tick
  energyCap: 1.5, // max energy a square can bank
  landNutrients: 0.6, // mean starting nutrients per land square
  waterNutrients: 0.15, // mean starting nutrients per water square
  waterDiffusion: 0.2, // nutrient exchange rate between neighbouring water squares
  wetDiffusion: 0.03, // max exchange rate through wet ground (scaled by saturation)

  // --- Water cycle (total water is conserved) ---
  waterDepthMin: 0.3, // standing water at least this deep makes a "water" square
  soilCap: 1.0, // water a square's soil can hold
  infiltration: 0.02, // max standing water soaking into the soil per tick
  soilWick: 0.2, // soil water spreading between squares (any direction; slow uphill pull)
  soilDrain: 0.15, // extra soil drainage downhill per level of height difference
  surfaceFlow: 0.2, // standing water flow rate toward lower water surfaces
  evapSurface: 0.0000025, // standing water evaporating per square per tick
  evapSoil: 0.00005, // fraction of soil water evaporating per tick
  initialCloud: 0.17, // share of all water that starts in the clouds
  rainStart: 0.2, // rain starts when clouds hold more than this share of all water
  rainStop: 0.14, // a shower brings the clouds back down to this share...
  rainDuration: 1000, // ...spread evenly over this many ticks (~5 s at the default 4x speed)
  cloudScale: 1 / 70, // size of cloud patterns (smaller = bigger clouds)
  windX: 0.003, // cloud drift, squares per tick
  windY: 0.0012,

  // --- Grass ---
  grassMaxN: 0.6, // nutrients held by a fully grown grass plant
  grassMaxE: 2.0, // energy a grass plant can store
  grassAbsorb: 0.04, // max energy drawn from the ground per tick
  grassToleranceCost: 0.5, // peak efficiency = 1 - this * tolerance gene (generalists pay)
  grassMetaBase: 0.004, // metabolic cost per tick
  grassMetaSize: 0.008, // extra metabolic cost per tick at full size
  grassMetaGrowthGene: 0.2, // metabolic cost per unit of growth-rate gene (fast growers burn more)
  grassMetaLifespan: 0.0000005, // metabolic cost per tick of genetic lifespan (long lives cost upkeep)
  growEnergyPerN: 0.8, // energy spent per unit of nutrient taken up while growing
  seedN: 0.04, // nutrients packed into each seed (from the ground)
  seedE: 0.25, // energy packed into each seed (from the parent)
  seedRangeCost: 0.01, // extra energy per seed per square of genetic throw range
  grassBreedReserve: 0.3, // energy the parent keeps back when seeding

  // --- Algae ---
  algaeMaxN: 0.35,
  algaeMaxE: 1.5,
  algaeAbsorb: 0.035,
  algaeDepthShade: 0.6, // fraction of light lost at max depth
  algaeMetaBase: 0.004,
  algaeMetaSize: 0.008,
  algaeMetaGrowthGene: 0.2,
  algaeMetaLifespan: 0.0000005,
  algaeChildN: 0.04, // nutrients a new algae cell takes from the water
  algaeChildE: 0.2, // energy a new algae cell takes from its parent
  algaeBreedReserve: 0.2,

  // --- Genetics ---
  fullGrowth: 0.98, // fraction of max nutrients considered "fully grown"

  // --- Initial population ---
  initialSeeds: 400,
  initialAlgae: 150,
};

export type Params = typeof PARAMS;
