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
/** Squares at or below this height are under water. */
export const WATER_LEVEL = 6;
/** Water irrigates land up to this many squares away. */
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

  // --- Grass ---
  grassMaxN: 0.6, // nutrients held by a fully grown grass plant
  grassMaxE: 2.0, // energy a grass plant can store
  grassAbsorb: 0.04, // max energy drawn from the ground per tick
  grassDryAbsorb: 0.25, // absorb efficiency on bone-dry ground (1.0 when saturated)
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
