// World dimensions in squares, each drawn CELL_PX x CELL_PX pixels. The size
// is chosen on the Start tab and fixed while a world runs; these are live
// bindings, so every module sees the current size.
export const CELL_PX = 3;
export let GRID_W = 400;
export let GRID_H = 150;
export let CELL_COUNT = GRID_W * GRID_H;

/** World size wanted for the next world (edited on the Start tab). */
export const WORLD_SIZE = { width: 400, height: 150 };

/** Applies WORLD_SIZE; call only while building a new world. */
export function applyWorldSize(): void {
  GRID_W = Math.max(40, Math.round(WORLD_SIZE.width));
  GRID_H = Math.max(40, Math.round(WORLD_SIZE.height));
  CELL_COUNT = GRID_W * GRID_H;
}

// Terrain
export const MIN_HEIGHT = 1;
export const MAX_HEIGHT = 16;
/** Terrain generation settings; changing them only affects newly generated worlds. */
export const TERRAIN = {
  /** Lakes start filled so squares at or below this height are under water. */
  waterLevel: 6,
  /** Initial soil moisture reaches this many squares from water (then the water cycle takes over). */
  irrigationRange: 60,
  /** Size of landmasses: noise is sampled at 1/landScale per square. */
  landScale: 120,
  /** Noise octaves: more gives rougher ground with small valleys for streams. */
  octaves: 7,
};

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
  energyPerTick: 0.02, // sunlight arriving in every square each tick; only a plant there can use it (not stored)
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
  runoffRate: 0.1, // river flow speed: share of shallow water moving one square downhill per tick (slider in the UI)
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
  algaeBreedSize: 0.5, // algae can bud once grown to this share of full size

  // --- Swimmers ---
  swimMoveCost: 1, // multiplier on the ½·m·v² energy cost of moving
  swimMetabolism: 0.0012, // energy burned per tick per unit of body mass (fat adds mass)
  swimFatMass: 0.4, // mass added per unit of fat
  swimEnergyMax: 1, // short-term energy store; surplus goes to fat
  swimNutrientLoss: 0.0004, // share of body nutrients shed into the water each tick
  swimMinNutrients: 0.005, // a swimmer whose body nutrients fall below this dies
  swimFoodRadius: 7, // squares searched for algae when hungry
  swimMinAlgaeSize: 0.6, // swimmers only eat algae grown to at least this share of full size
  swimMateRadius: 14, // squares searched for a mate
  swimFoodInterval: 10, // ticks between food searches
  swimMateInterval: 40, // ticks between mate searches (less often than food)
  swimBreedCooldown: 600, // ticks after mating before a swimmer can mate again
  swimMinChildEnergy: 0.3, // parents won't make a child with less energy than this
  swimMinChildNutrients: 0.04, // ...or fewer nutrients than this
  swimRotRate: 0.004, // share of a corpse's nutrients returned to its square each tick
  swimGeneStrength: 0.35, // how strongly each gene nudges its traits
  swimStartEnergy: 1, // energy each starting swimmer gets
  swimStartNutrients: 0.1, // nutrients each starting swimmer takes from the water
  swimTurnRate: 0.6, // most a swimmer can turn per tick (radians): nimble
  swimAccel: 0.05, // most its speed can change per tick
  swimWanderTurnChance: 1, // chance per tick of changing course while roaming (1 = constant jitter)
  swimWanderTurnSize: 0.5, // size of those course changes (radians)
  swimLookAhead: 0, // squares ahead it checks for land (0 = just bumps into the shore)
  swimBirthSize: 1, // newborn size as a share of adult body size (1 = born full size)
  swimGrowthRate: 0.001, // share of adult size grown per tick while it has spare energy
  swimGrowthCost: 1, // energy per unit of body mass grown

  // --- Sharks (eat swimmers) ---
  sharkMoveCost: 0.15,
  sharkMetabolism: 0.00015,
  sharkFatMass: 0.3,
  sharkEnergyMax: 3,
  sharkNutrientLoss: 0.0002,
  sharkMinNutrients: 0.02,
  sharkFoodRadius: 20, // squares within which a hungry shark can detect fish
  sharkMateRadius: 40,
  sharkFoodInterval: 15,
  sharkMateInterval: 60,
  sharkBreedCooldown: 2000,
  sharkMinChildEnergy: 1,
  sharkMinChildNutrients: 0.1,
  sharkRotRate: 0.003,
  sharkGeneStrength: 0.35,
  sharkStartEnergy: 7,
  sharkStartNutrients: 0.3,
  sharkBoostDuration: 60, // ticks a boost lasts
  sharkBoostMetabolism: 3, // upkeep multiplier while boosting
  sharkTurnRate: 0.04, // most a shark can turn per tick (radians): smooth, gliding turns
  sharkAccel: 0.002, // most its speed can change per tick
  sharkWanderTurnChance: 0.004, // chance per tick of changing course while roaming
  sharkWanderTurnSize: 1.6, // size of those course changes (radians)
  sharkLookAhead: 6, // squares ahead it checks for land, turning away before it gets there
  sharkBirthSize: 0.15, // newborn sharks are this share of their adult size...
  sharkGrowthRate: 0.0004, // ...and grow by this share per tick while they have spare energy
  sharkGrowthCost: 1, // energy per unit of body mass grown
  sharkPreyEnergy: 2, // extra energy per unit of a fish's body size when a shark digests it

  // --- Genetics ---
  fullGrowth: 0.98, // fraction of max nutrients considered "fully grown"

  // --- Initial population ---
  initialSeeds: 400,
  initialAlgae: 150,
  initialSwimmers: 80,
  initialSharks: 12,
  initialSoilWetness: 1, // scales the starting damp band around the lakes
  initialWaterPrefSpread: 0.85, // starting seeds' water preference is spread over this range around the default
};

export type Params = typeof PARAMS;
