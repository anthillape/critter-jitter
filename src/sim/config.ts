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
  /** Size of landmasses: noise is sampled at 1/landScale per square. */
  landScale: 120,
  /** Noise octaves: more gives rougher ground with small valleys for streams. */
  octaves: 7,
  /** Layers in each square's soil column (top layer = what plants feel). */
  soilLayers: 3,
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
  energyPerTick: 0.03, // sunlight arriving in every square each tick; only a plant there can use it (not stored)
  landNutrients: 0.9, // mean starting nutrients per land square
  waterNutrients: 0.25, // mean starting nutrients per water square
  waterDiffusion: 0.2, // nutrient exchange rate between neighbouring water squares
  wetDiffusion: 0.03, // max exchange rate through wet ground (scaled by saturation)
  nutrientBoost: 1, // how much nutrients in a square help plants and algae there (0 = not at all)...
  nutrientBoostRef: 0.5, // ...at this many nutrients their upkeep and growing cost are divided by (1 + boost) and growth multiplied by it; no upper limit

  // --- Water cycle (total water is conserved) ---
  waterDepthMin: 0.3, // standing water at least this deep makes a "water" square
  flowRate: 0.3, // how fast standing water runs to lower neighbours (share of what it could move per tick)
  flowFocus: 2, // how strongly water picks the steepest way (higher = narrower channels)
  evaporation: 0.00003, // water evaporating from every square per tick (from surface water, else the top soil)
  infiltration: 0.0005, // standing water soaking into dry top soil per tick (less as it fills)
  soilCap: 1.0, // water each soil layer can hold
  percolation: 0.001, // water seeping down from one soil layer to the next per tick (gravity)
  capillary: 0.003, // water pulled up toward a drier layer above per tick (capillary pressure)
  groundFlow: 0.01, // deepest layer (groundwater) flowing sideways toward lower ground
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
  algaeBreedSize: 0.5, // algae can release spores once grown to this share of full size
  algaeSporeSpeed: 0.02, // squares per tick a spore drifts (it spends no energy moving)
  algaeSporeDrift: 0.08, // how much a spore's direction wanders each tick (radians)
  algaeSporeSharkRadius: 6, // spores within this many squares of a shark get caught in its wake...
  algaeSporeSharkPull: 0.08, // ...their direction swinging this share of the way toward the shark's heading each tick

  // --- Fish ---
  fishMoveCost: 1, // multiplier on the ½·m·v² energy cost of moving
  fishMetabolism: 0.002, // energy burned per tick per unit of body mass (fat adds mass)
  fishFatMass: 0.1, // mass added per unit of fat (fat is the only energy store)
  fishNutrientLoss: 0.0004, // share of body nutrients shed into the water each tick
  fishMinNutrients: 0.005, // a fish whose body nutrients fall below this dies
  fishFoodRadius: 7, // squares searched for algae when hungry
  fishMinAlgaeSize: 0.6, // fish only eat algae grown to at least this share of full size
  fishMateRadius: 14, // squares searched for a mate
  fishFoodInterval: 10, // ticks between food searches
  fishMateInterval: 40, // ticks between mate searches (less often than food)
  fishBreedCooldown: 600, // ticks after mating before a fish can mate again
  fishMinChildFat: 0.3, // parents won't make a child with less fat than this
  fishMinChildNutrients: 0.04, // ...or fewer nutrients than this
  fishRotRate: 0.004, // share of a corpse's nutrients returned to its square each tick
  fishGeneStrength: 0.35, // how strongly each gene nudges its traits
  fishStartFat: 2, // fat (energy) each starting fish gets
  fishStartNutrients: 0.1, // nutrients each starting fish takes from the water
  fishTurnRate: 0.6, // most a fish can turn per tick (radians): nimble
  fishAccel: 0.05, // most its speed can change per tick
  fishWanderTurnChance: 1, // chance per tick of changing course while roaming (1 = constant jitter)
  fishWanderTurnSize: 0.5, // size of those course changes (radians)
  fishLookAhead: 0, // squares ahead it checks for land (0 = just bumps into the shore)
  fishBirthSize: 1, // newborn size as a share of adult body size (1 = born full size)
  fishGrowthRate: 0.001, // share of adult size grown per tick while it has spare energy
  fishGrowthCost: 1, // energy per unit of body mass grown
  fishStomach: 2, // stomach capacity (energy plus nutrients) per unit of body mass
  fishDigestCost: 25, // share of food used up digesting it = this x digestion speed (so the cost per tick goes with speed squared)
  fishGestationRate: 0.001, // nutrients passed to unborn young per tick per unit of the carrier's mass

  // --- Sharks (eat fish) ---
  sharkMoveCost: 0.04, // sharks are efficient swimmers
  sharkMetabolism: 0.00015,
  sharkFatMass: 0.1,
  sharkNutrientLoss: 0.0002,
  sharkMinNutrients: 0.02,
  sharkFoodRadius: 20, // squares within which a hungry shark can detect fish
  sharkMateRadius: 40,
  sharkFoodInterval: 15,
  sharkMateInterval: 60,
  sharkBreedCooldown: 2000,
  sharkMinChildFat: 1,
  sharkMinChildNutrients: 0.1,
  sharkRotRate: 0.003,
  sharkGeneStrength: 0.35,
  sharkStartFat: 10,
  sharkStartNutrients: 0.3,
  sharkSenseRange: 100, // how far (squares) a shark can sense fish, in a straight line across water
  sharkSenseInterval: 1200, // ticks between long-range looks (every 20 s)
  sharkSenseRays: 32, // directions it looks in, all round
  sharkSenseCrowd: 4, // it doesn't bother looking far if it already has this many fish within sight
  sharkSenseFull: 0.35, // ...or if its fat is at least this share of what it can carry
  sharkSenseMin: 1, // it only heads off if it saw at least this many fish
  sharkBoostRange: 5, // squares from its locked-on prey at which a shark may boost
  sharkBoostDuration: 60, // ticks a boost lasts
  sharkBoostMetabolism: 3, // upkeep multiplier while boosting
  sharkTurnRate: 0.04, // most a shark can turn per tick (radians): smooth, gliding turns
  sharkAccel: 0.0009, // speed gained per tick during a tail stroke
  sharkTailBeat: 0.15, // how fast the tail sweeps during a stroke (radians of the sweep cycle per tick): slow
  sharkStrokeTicks: 45, // longest tail stroke, in ticks...
  sharkGlideDrag: 0.004, // ...then it glides, losing this share of its speed each tick...
  sharkGlideSlack: 0.25, // ...until it's this share below the speed it wants (strokes push it half this share above) // most its speed can change per tick
  sharkWanderTurnChance: 0.004, // chance per tick of changing course while roaming
  sharkWanderTurnSize: 1.6, // size of those course changes (radians)
  sharkLookAhead: 6, // squares ahead it checks for land, turning away before it gets there
  sharkBirthSize: 0.15, // newborn sharks are this share of their adult size...
  sharkGrowthRate: 0.0004, // ...and grow by this share per tick while they have spare energy
  sharkGrowthCost: 1, // energy per unit of body mass grown
  sharkStomach: 2,
  sharkDigestCost: 25,
  sharkGestationRate: 0.00004,

  // --- Sheep (graze grass on land) ---
  sheepMoveCost: 1,
  sheepMetabolism: 0.0004,
  sheepFatMass: 0.1,
  sheepNutrientLoss: 0.0003,
  sheepMinNutrients: 0.01,
  sheepMateRadius: 30,
  sheepFoodInterval: 90, // ticks between looks for the grassiest direction while hungry
  sheepMateInterval: 60,
  sheepBreedCooldown: 800,
  sheepMinChildFat: 0.6,
  sheepMinChildNutrients: 0.08,
  sheepRotRate: 0.003,
  sheepGeneStrength: 0.35,
  sheepStartFat: 6,
  sheepStartNutrients: 0.2,
  sheepTurnRate: 0.08, // most a sheep can turn per tick (radians)
  sheepAccel: 0.002,
  sheepWanderTurnChance: 0.003, // chance per tick its general direction changes
  sheepWanderTurnSize: 1.2, // size of those changes (radians)
  sheepLookAhead: 3, // squares ahead it checks for water
  sheepBirthSize: 0.4,
  sheepGrowthRate: 0.0005,
  sheepGrowthCost: 1,
  sheepStomach: 3,
  sheepDigestCost: 25,
  sheepGestationRate: 0.001,
  sheepBite: 0.008, // nutrients (with a matching share of energy) taken from grass per tick of grazing
  sheepGrazeFloor: 0.08, // grass grazed below this share of full size is eaten up entirely
  sheepSwimEffort: 0.0005, // energy per tick per unit of mass spent swimming (for the worst swimmer; the best pay a quarter)
  sheepSwimWalkCost: 1, // extra walking cost at full swimming ability (1 = twice the cost)
  sheepSpace: 3, // squares of room a sheep likes between its body and another's (unless looking for a mate)
  sheepSpaceWeight: 1.5, // how strongly it steers away from sheep inside that room
  sheepMeanderRate: 0.03, // how fast its path swings about within the meander arc (radians per tick)

  // --- Cats (hunt sheep on land) ---
  catMoveCost: 0.3,
  catMetabolism: 0.0002,
  catFatMass: 0.1,
  catNutrientLoss: 0.0002,
  catMinNutrients: 0.02,
  catFoodRadius: 40, // squares within which a hungry cat can spot a sheep
  catMateRadius: 60,
  catFoodInterval: 30,
  catMateInterval: 60,
  catBreedCooldown: 2500,
  catMinChildFat: 1,
  catMinChildNutrients: 0.1,
  catRotRate: 0.003,
  catGeneStrength: 0.35,
  catStartFat: 12,
  catStartNutrients: 0.3,
  catTurnRate: 0.1,
  catAccel: 0.002,
  catWanderTurnChance: 0.003,
  catWanderTurnSize: 1.2,
  catLookAhead: 3,
  catBirthSize: 0.3,
  catGrowthRate: 0.0004,
  catGrowthCost: 1,
  catStomach: 2.5,
  catDigestCost: 25,
  catGestationRate: 0.0001,
  catPounceSpeed: 0.25, // squares per tick while pouncing
  catPounceRest: 180, // ticks after a pounce before it can pounce again
  catSwimEffort: 0.0005,
  catSwimWalkCost: 1,
  catSenseRange: 60, // how far (squares) a cat can see sheep, in a straight line across land
  catSenseInterval: 600, // ticks between long looks for the biggest herd
  catSenseRays: 32,
  catSenseCrowd: 3, // it doesn't bother looking far if it already has this many sheep within sight
  catSenseFull: 0.5, // ...or if its fat is at least this share of what it can carry
  catSenseMin: 1, // it only heads off if it saw at least this many sheep
  catMeanderRate: 0.03,

  // --- Rocs (huge birds: eat fish or sheep, fly anywhere, land on land) ---
  rocMoveCost: 0.05, // flying is efficient
  rocMetabolism: 0.0001, // big soaring birds are cheap to run
  rocFatMass: 0.05,
  rocNutrientLoss: 0.0002,
  rocMinNutrients: 0.03,
  rocFoodRadius: 15, // squares within which it spots a fish or sheep to dive at
  rocMateRadius: 150, // they fly far and see far
  rocFoodInterval: 30,
  rocMateInterval: 60,
  rocBreedCooldown: 4000,
  rocMinChildFat: 3,
  rocMinChildNutrients: 0.2,
  rocRotRate: 0.002,
  rocGeneStrength: 0.35,
  rocStartFat: 20,
  rocStartNutrients: 0.5,
  rocTurnRate: 0.05,
  rocAccel: 0.003,
  rocWanderTurnChance: 0.004,
  rocWanderTurnSize: 1.2,
  rocLookAhead: 3, // squares ahead it checks for water when walking
  rocBirthSize: 0.3,
  rocGrowthRate: 0.0003,
  rocGrowthCost: 1,
  rocStomach: 2,
  rocDigestCost: 25,
  rocGestationRate: 0.00005,
  rocMeanderRate: 0.03,
  rocSenseRange: 200, // it can see a long way from the air, over anything
  rocSenseInterval: 600,
  rocSenseRays: 32,
  rocSenseCrowd: 5,
  rocSenseFull: 0.6,
  rocSenseMin: 25, // only very large crowds of fish or sheep draw it
  rocTooFat: 0.7, // past this share of its fat store it's too heavy to fly (and stops going after fish)
  rocFlightCheck: 300, // ticks between decisions to take off or land (by its flying preference)
  rocDiveBoost: 1.5, // flying speed multiplier while diving at prey
  rocLandedUpkeep: 0.5, // share of its upkeep it burns while on the ground
  rocHuntUntil: 0.65, // it keeps hunting until its fat reaches this share of its store (a big reserve)
  rocCruiseHeight: 4, // how high it flies (in terrain height levels above the ground)
  rocClimbRate: 0.04, // height gained per tick climbing (it drops twice as fast when diving or landing)
  rocCatchChance: 0.25, // share of dives that catch the prey
  rocMissRest: 120, // ticks after a missed dive before it picks a new target
  rocEdgeMargin: 20, // squares from the map edge at which a flying roc starts arcing back toward the middle

  // --- Gardener (a person who tries to keep every species alive) ---
  gardenerStartFat: 50,
  gardenerMaxFat: 100, // a person can carry a lot of fat
  gardenerUpkeep: 0.002, // fat burned per tick just living
  gardenerEfficiency: 0.8, // share of the energy in food that becomes fat
  gardenerMass: 10, // body mass, for the cost of moving (doubled while carrying the boat)
  gardenerMoveCost: 0.05, // moving costs this x ½·m·v² per tick (people walk efficiently)
  gardenerWalkSpeed: 0.12, // squares per tick on foot
  gardenerRowSpeed: 0.08, // squares per tick rowing the boat
  gardenerCarrySpeed: 0.03, // squares per tick carrying the boat over land
  gardenerSwimSpeed: 0.02, // squares per tick swimming (caught in a flood without the boat)
  gardenerSpearRange: 12, // how far they can throw a spear, in squares
  gardenerSpearHit: 0.75, // chance a throw hits
  gardenerNetRadius: 3, // the net's radius in squares (it lands a spear's throw away and catches every fish under it)
  gardenerNetRest: 90, // ticks to gather the net in before casting again
  gardenerRareShare: 0.4, // they think a species is rare once it falls below this share of the most they remember seeing
  gardenerDecideInterval: 300, // ticks between rethinking what to do while wandering
  gardenerGiveUp: 3000, // ticks before they give up on a task that isn't working out

  // --- Genetics ---
  fullGrowth: 0.98, // fraction of max nutrients considered "fully grown"
  hueMutation: 6, // animals: a child's hue is its parents' midpoint, nudged by up to this many degrees

  // --- Initial population ---
  // A new world starts empty (just land, water and nutrients): place life with
  // the tools, or set these (or use STARTER_POPULATION) to start with some.
  initialSeeds: 0,
  initialAlgae: 0,
  initialFish: 0,
  initialSharks: 0,
  initialSheep: 0,
  initialCats: 0,
  initialRocs: 0,
  initialGardeners: 0, // how many gardeners start in the world
  startingSurfaceWater: 1.3, // standing water at the start, as an average depth over the whole world
  initialSoilWetness: 0.4, // how full the soil starts (0..1); full under the starting lakes
  initialWaterPrefSpread: 0.85, // starting seeds' water preference is spread over this range around the default
};

export type Params = typeof PARAMS;

/** A ready-made starting population (the Start tab's "Starter population" button, and headless runs). */
export const STARTER_POPULATION: Partial<Params> = {
  initialSeeds: 400,
  initialAlgae: 150,
  initialFish: 80,
  initialSharks: 12,
  initialSheep: 40,
  initialCats: 20,
  initialRocs: 10,
  initialGardeners: 1,
};
