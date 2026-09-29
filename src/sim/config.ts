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
export const NOISE_OCTAVES = 7; // fine octaves give the small valleys streams gather in

/**
 * Simulation ticks per second of game time. The main loop runs the
 * simulation against the wall clock at this rate times the chosen speed.
 */
export const TICKS_PER_SECOND = 60;

/**
 * All simulation tunables. "Per tick" everywhere (see TICKS_PER_SECOND). Energy is not conserved
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
  infiltration: 0.0002, // standing water soaking into dry soil per tick (less as it fills); much slower than run-off
  soilWick: 0.2, // soil water spreading between squares (any direction; slow uphill pull)
  soilDrain: 0.15, // extra soil drainage downhill per level of height difference
  surfaceFlow: 0.2, // deep water (lakes, ponds, floods) flow toward lower water surfaces
  runoffRate: 0.5, // share of shallow water running to the steepest downhill square per tick
  evapSurface: 0.0000025, // standing water evaporating per square per tick
  evapSoil: 0.00005, // fraction of soil water evaporating per tick
  initialCloud: 0.17, // share of all water that starts in the clouds
  rainMinCloud: 0.12, // no rain until the clouds hold at least this share of all water
  rainStart: 0.2, // at this share, rain has a rainChance chance of starting each tick...
  rainChance: 1 / 600, // ...rising with the square of how far the clouds are above rainMinCloud
  rainRate: 0.0001, // share of all water falling per tick while it rains (steady rate)
  rainMinShare: 0.15, // each rain event drops at least this share of the cloud water (up to all of it)
  rainMaxPerSquare: 0.004, // thin clouds can't drop more than this per square per tick
  cloudScale: 1 / 70, // size of cloud patterns (smaller = bigger clouds)
  cloudMorph: 1 / 6000, // how fast cloud shapes change (noise time axis per tick)

  // --- Wind ---
  windSpeed: 0.0032, // mean speed, squares per tick
  windSpeedVariation: 0.5, // speed wanders by up to this fraction either way
  windPrevailing: 0.38, // prevailing direction the wind blows toward, radians (0 = east, +y = south)
  windSwing: Math.PI * 1.6, // how far the bearing can wander (usually well under a quarter of this)
  windChangeRate: 1 / 20000, // how quickly direction and speed drift (noise time per tick)

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
