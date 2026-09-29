import { PARAMS, TERRAIN, TICKS_PER_SECOND, type Params } from "./sim/config";
import {
  ALGAE_DEFAULTS, G_BREED, G_GERM, G_GROWTH, G_LIFESPAN, G_MUTATION, G_RANGE, G_WATER_PREF,
  G_WATER_TOL, GRASS_DEFAULTS,
} from "./sim/genes";

/** One adjustable number, described for the settings panel. */
export interface Setting {
  id: string;
  group: string;
  label: string;
  /** Tooltip: what it does, in plain words. */
  tip: string;
  min: number;
  max: number;
  /** Slider moves on a log scale (for values spanning orders of magnitude). */
  log?: boolean;
  int?: boolean;
  /** Only takes effect when a world is (re)generated. */
  newWorld?: boolean;
  get(): number;
  set(v: number): void;
  fmt?(v: number): string;
  /** Default value, captured at startup for "reset". */
  defaultValue?: number;
}

const PER_SEC = ` (per tick; ${TICKS_PER_SECOND} ticks = 1 second at 1× speed)`;

const pct = (v: number) => `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`;
const deg = (v: number) => `${Math.round(v)}°`;

function param(key: keyof Params, rest: Omit<Setting, "id" | "get" | "set">): Setting {
  return {
    id: key,
    get: () => PARAMS[key],
    set: (v) => {
      PARAMS[key] = v;
    },
    ...rest,
  };
}

function gene(kind: "grass" | "algae", idx: number, rest: Omit<Setting, "id" | "get" | "set" | "newWorld">): Setting {
  const arr = kind === "grass" ? GRASS_DEFAULTS : ALGAE_DEFAULTS;
  return {
    id: `${kind}Gene${idx}`,
    newWorld: true,
    get: () => arr[idx],
    set: (v) => {
      arr[idx] = v;
    },
    ...rest,
  };
}

function terrain(key: keyof typeof TERRAIN, rest: Omit<Setting, "id" | "get" | "set" | "newWorld">): Setting {
  return {
    id: `terrain_${key}`,
    newWorld: true,
    get: () => TERRAIN[key],
    set: (v) => {
      TERRAIN[key] = v;
    },
    ...rest,
  };
}

// Wind direction: stored as the angle the wind blows toward (screen radians,
// 0 = east, +y = south); shown as the compass bearing it blows *from*.
function bearingFromAngle(a: number): number {
  const toward = (Math.atan2(Math.cos(a), -Math.sin(a)) * 180) / Math.PI;
  return (toward + 180 + 360) % 360;
}
function angleFromBearing(fromDeg: number): number {
  const t = ((fromDeg + 180) * Math.PI) / 180;
  return Math.atan2(-Math.cos(t), Math.sin(t));
}

export const SETTINGS: Setting[] = [
  // --- Sunlight & nutrients ---
  param("energyPerTick", {
    group: "Sunlight & nutrients", label: "Sunlight",
    tip: "Sunlight energy arriving in every square each tick. Only a plant or algae in that square can use it; the ground can't store it, so unused light is lost." + PER_SEC,
    min: 0.004, max: 0.1, log: true,
  }),
  param("waterDiffusion", {
    group: "Sunlight & nutrients", label: "Nutrient mixing in water",
    tip: "How quickly nutrients spread between neighbouring water squares.",
    min: 0.005, max: 0.24, log: true,
  }),
  param("wetDiffusion", {
    group: "Sunlight & nutrients", label: "Nutrient seepage through wet ground",
    tip: "How quickly nutrients seep through wet ground (and between land and water). Scaled by how wet the ground is; dry ground never moves nutrients.",
    min: 0.001, max: 0.2, log: true,
  }),

  // --- Water on the ground ---
  param("runoffRate", {
    group: "Water on the ground", label: "River flow speed",
    tip: "How fast streams and run-off flow downhill: the share of shallow water that moves one square down its channel each tick.",
    min: 0.01, max: 0.5, log: true,
  }),
  param("surfaceFlow", {
    group: "Water on the ground", label: "Lake levelling speed",
    tip: "How fast deep water (lakes, ponds, floods) flows toward lower water levels to even itself out.",
    min: 0.02, max: 0.24, log: true,
  }),
  param("waterDepthMin", {
    group: "Water on the ground", label: "Depth that counts as water",
    tip: "Standing water at least this deep makes a water square: algae can live there, grass drowns, and lakes level out. Shallower water runs off as streams.",
    min: 0.05, max: 1.5, log: true,
  }),
  param("infiltration", {
    group: "Water on the ground", label: "Soak-in speed",
    tip: "How fast standing water soaks into dry ground. It slows as the soil fills. Lower = more run-off and bigger streams." + PER_SEC,
    min: 0.00002, max: 0.01, log: true,
  }),
  param("soilCap", {
    group: "Water on the ground", label: "Soil water capacity",
    tip: "How much water each square's soil can hold. Extra water seeps out as standing water.",
    min: 0.2, max: 4, log: true,
  }),
  param("soilWick", {
    group: "Water on the ground", label: "Soil water spreading",
    tip: "How fast soil water spreads to drier neighbours in any direction. This is what slowly pulls water up and away from lakes.",
    min: 0.005, max: 0.24, log: true,
  }),
  param("soilDrain", {
    group: "Water on the ground", label: "Soil drainage downhill",
    tip: "Extra soil-water flow downhill, in proportion to the slope.",
    min: 0.005, max: 0.6, log: true,
  }),
  param("evapSurface", {
    group: "Water on the ground", label: "Evaporation from open water",
    tip: "Water evaporating into the clouds from each square of standing water, each tick." + PER_SEC,
    min: 1e-7, max: 1e-4, log: true,
  }),
  param("evapSoil", {
    group: "Water on the ground", label: "Evaporation from soil",
    tip: "Share of each square's soil water evaporating into the clouds each tick." + PER_SEC,
    min: 1e-6, max: 2e-3, log: true,
  }),

  // --- Clouds & rain ---
  param("rainMinCloud", {
    group: "Clouds & rain", label: "Clouds needed before rain",
    tip: "Rain can't start until the clouds hold at least this share of all the world's water.",
    min: 0, max: 0.4, fmt: pct,
  }),
  param("rainStart", {
    group: "Clouds & rain", label: "Typical rain level",
    tip: "Cloud level (share of all water) at which rain has the 'Rain chance' of starting each tick. Above it, the chance rises steeply; below it, it falls away.",
    min: 0.05, max: 0.6, fmt: pct,
  }),
  param("rainChance", {
    group: "Clouds & rain", label: "Rain chance",
    tip: "Chance each tick that rain starts when the clouds are at the typical rain level.",
    min: 1 / 50000, max: 1 / 20, log: true, fmt: (v) => `1 in ${Math.round(1 / v).toLocaleString()}`,
  }),
  param("rainRate", {
    group: "Clouds & rain", label: "Rainfall rate",
    tip: "How much falls per tick while it rains, as a share of all the world's water." + PER_SEC,
    min: 1e-5, max: 2e-3, log: true,
  }),
  param("rainMinShare", {
    group: "Clouds & rain", label: "Smallest shower",
    tip: "Each rain drops at least this share of the cloud water. How much more is random, and now and then a rain empties the clouds completely.",
    min: 0.02, max: 1, fmt: pct,
  }),
  param("rainMaxPerSquare", {
    group: "Clouds & rain", label: "Heaviest rain on one square",
    tip: "Most rain one square can get per tick under the thickest cloud. Keeps thin clouds from dumping everything in one spot." + PER_SEC,
    min: 0.0003, max: 0.05, log: true,
  }),
  {
    id: "cloudSize", group: "Clouds & rain", label: "Cloud size",
    tip: "Rough size of cloud patterns, in squares.",
    min: 20, max: 300, log: true, int: true,
    get: () => 1 / PARAMS.cloudScale,
    set: (v) => {
      PARAMS.cloudScale = 1 / v;
    },
    fmt: (v) => `${Math.round(v)} sq`,
  },
  param("cloudMorph", {
    group: "Clouds & rain", label: "Cloud shape change speed",
    tip: "How quickly clouds change shape as they drift.",
    min: 1e-5, max: 5e-3, log: true,
  }),

  // --- Wind ---
  param("windSpeed", {
    group: "Wind", label: "Wind speed",
    tip: "Average wind speed, in squares per tick. Clouds drift at this speed." + PER_SEC,
    min: 0.0002, max: 0.05, log: true,
  }),
  param("windSpeedVariation", {
    group: "Wind", label: "Gustiness",
    tip: "How far the wind speed wanders either side of average (50% = between half and one-and-a-half times).",
    min: 0, max: 1, fmt: pct,
  }),
  {
    id: "windPrevailing", group: "Wind", label: "Prevailing wind (from)",
    tip: "Compass direction the wind usually blows from (0° = north, 90° = east).",
    min: 0, max: 359, int: true,
    get: () => bearingFromAngle(PARAMS.windPrevailing),
    set: (v) => {
      PARAMS.windPrevailing = angleFromBearing(v);
    },
    fmt: deg,
  },
  {
    id: "windSwing", group: "Wind", label: "Wind direction wander",
    tip: "How far the wind can swing away from the prevailing direction. It usually stays well inside a quarter of this, and only rarely reaches the extremes.",
    min: 0, max: 540, int: true,
    get: () => (PARAMS.windSwing * 180) / Math.PI,
    set: (v) => {
      PARAMS.windSwing = (v * Math.PI) / 180;
    },
    fmt: deg,
  },
  param("windChangeRate", {
    group: "Wind", label: "Wind change speed",
    tip: "How quickly the wind's direction and speed drift over time.",
    min: 1e-6, max: 2e-3, log: true,
  }),

  // --- Grass ---
  param("grassMaxN", {
    group: "Grass", label: "Nutrients in full-grown grass",
    tip: "How many nutrients a grass plant holds when fully grown (it has to take them from the ground).",
    min: 0.05, max: 2, log: true,
  }),
  param("grassMaxE", {
    group: "Grass", label: "Grass energy store",
    tip: "Most energy a grass plant can store.",
    min: 0.3, max: 8, log: true,
  }),
  param("grassAbsorb", {
    group: "Grass", label: "Grass energy uptake",
    tip: "Most energy grass can take from its square each tick (before its water preference is applied)." + PER_SEC,
    min: 0.004, max: 0.2, log: true,
  }),
  param("grassToleranceCost", {
    group: "Grass", label: "Cost of being a water generalist",
    tip: "How much a wide water tolerance lowers grass's peak efficiency. High values favour specialists.",
    min: 0, max: 0.95,
  }),
  param("grassMetaBase", {
    group: "Grass", label: "Grass base upkeep",
    tip: "Energy every grass plant burns each tick just to stay alive." + PER_SEC,
    min: 0.0003, max: 0.03, log: true,
  }),
  param("grassMetaSize", {
    group: "Grass", label: "Extra upkeep when full grown",
    tip: "Additional energy burned each tick by a full-grown plant (less for smaller plants)." + PER_SEC,
    min: 0.0005, max: 0.05, log: true,
  }),
  param("grassMetaGrowthGene", {
    group: "Grass", label: "Upkeep cost of fast growth",
    tip: "Extra upkeep per unit of the 'growth' gene, so fast growers pay for it.",
    min: 0, max: 1.5,
  }),
  param("grassMetaLifespan", {
    group: "Grass", label: "Upkeep cost of long life",
    tip: "Extra upkeep per tick of genetic lifespan, so long-lived plants pay for it.",
    min: 0, max: 5e-6,
  }),
  param("seedN", {
    group: "Grass", label: "Nutrients per seed",
    tip: "Nutrients packed into each seed (taken from the parent's square).",
    min: 0.005, max: 0.3, log: true,
  }),
  param("seedE", {
    group: "Grass", label: "Energy per seed",
    tip: "Energy the parent packs into each seed to start the seedling off.",
    min: 0.02, max: 1.5, log: true,
  }),
  param("seedRangeCost", {
    group: "Grass", label: "Cost of throwing seeds far",
    tip: "Extra energy per seed for each square of the parent's 'range' gene.",
    min: 0, max: 0.06,
  }),
  param("grassBreedReserve", {
    group: "Grass", label: "Energy kept back when seeding",
    tip: "Grass only makes a seed if it would still have this much energy left.",
    min: 0, max: 2,
  }),

  // --- Algae ---
  param("algaeMaxN", {
    group: "Algae", label: "Nutrients in full-grown algae",
    tip: "How many nutrients an algae cell holds when fully grown (taken from the water).",
    min: 0.05, max: 2, log: true,
  }),
  param("algaeMaxE", {
    group: "Algae", label: "Algae energy store",
    tip: "Most energy an algae cell can store.",
    min: 0.3, max: 8, log: true,
  }),
  param("algaeAbsorb", {
    group: "Algae", label: "Algae energy uptake",
    tip: "Most energy algae can take from its square each tick in shallow water." + PER_SEC,
    min: 0.004, max: 0.2, log: true,
  }),
  param("algaeDepthShade", {
    group: "Algae", label: "Light lost in deep water",
    tip: "How much less energy algae gets in the deepest water compared with the shallows.",
    min: 0, max: 1, fmt: pct,
  }),
  param("algaeMetaBase", {
    group: "Algae", label: "Algae base upkeep",
    tip: "Energy every algae cell burns each tick just to stay alive." + PER_SEC,
    min: 0.0003, max: 0.03, log: true,
  }),
  param("algaeMetaSize", {
    group: "Algae", label: "Extra upkeep when full grown",
    tip: "Additional energy burned each tick by full-grown algae (less for smaller cells)." + PER_SEC,
    min: 0.0005, max: 0.05, log: true,
  }),
  param("algaeMetaGrowthGene", {
    group: "Algae", label: "Upkeep cost of fast growth",
    tip: "Extra upkeep per unit of the 'growth' gene.",
    min: 0, max: 1.5,
  }),
  param("algaeMetaLifespan", {
    group: "Algae", label: "Upkeep cost of long life",
    tip: "Extra upkeep per tick of genetic lifespan.",
    min: 0, max: 5e-6,
  }),
  param("algaeChildN", {
    group: "Algae", label: "Nutrients per new cell",
    tip: "Nutrients a newly budded algae cell takes from the water.",
    min: 0.005, max: 0.3, log: true,
  }),
  param("algaeChildE", {
    group: "Algae", label: "Energy per new cell",
    tip: "Energy the parent gives each new algae cell.",
    min: 0.02, max: 1.5, log: true,
  }),
  param("algaeBreedReserve", {
    group: "Algae", label: "Energy kept back when budding",
    tip: "Algae only buds a new cell if it would still have this much energy left.",
    min: 0, max: 2,
  }),

  // --- Both plants ---
  param("growEnergyPerN", {
    group: "Grass & algae", label: "Energy cost of growing",
    tip: "Energy spent for each unit of nutrient a plant takes up while growing.",
    min: 0.05, max: 5, log: true,
  }),
  param("fullGrowth", {
    group: "Grass & algae", label: "Counts as full grown at",
    tip: "Plants can only breed once they hold this share of their full-grown nutrients.",
    min: 0.3, max: 1, fmt: pct,
  }),

  // --- Starting conditions (Start tab): terrain ---
  terrain("landScale", {
    group: "Terrain", label: "Landmass size",
    tip: "Size of hills, valleys and lakes, in squares. Bigger = broader landscape.",
    min: 30, max: 500, log: true, int: true,
  }),
  terrain("octaves", {
    group: "Terrain", label: "Ground roughness",
    tip: "Layers of detail in the terrain noise. More layers give rougher ground with small valleys for streams.",
    min: 1, max: 9, int: true,
  }),

  // --- Starting conditions: water ---
  terrain("waterLevel", {
    group: "Water", label: "Sea level",
    tip: "Lakes start filled up to this height (1–16), so everything at or below it begins under water.",
    min: 1, max: 14, int: true,
  }),
  terrain("irrigationRange", {
    group: "Water", label: "Starting wet-ground reach",
    tip: "How far from the lakes the ground starts out damp, in squares. After that, the water cycle takes over.",
    min: 5, max: 150, int: true,
  }),

  param("initialSoilWetness", {
    group: "Water", label: "Starting soil wetness",
    tip: "How wet the ground starts near the lakes (1 = the usual damp band, 0 = bone dry, above 1 = soggier). More soil water means more total water in the world.",
    min: 0, max: 2, newWorld: true,
  }),
  param("initialCloud", {
    group: "Water", label: "Starting cloud water",
    tip: "Share of the world's water that starts in the clouds, on top of the lakes and soil. More cloud water means more total water in the world, and rain sooner.",
    min: 0, max: 0.5, fmt: pct, newWorld: true,
  }),

  // --- Starting conditions: life ---
  param("landNutrients", {
    group: "Life", label: "Starting nutrients in land",
    tip: "Average nutrients per land square at the start. Nutrients are never created or destroyed after that.",
    min: 0.05, max: 3, log: true, newWorld: true,
  }),
  param("waterNutrients", {
    group: "Life", label: "Starting nutrients in water",
    tip: "Nutrients per water square at the start.",
    min: 0.01, max: 2, log: true, newWorld: true,
  }),
  param("initialSeeds", {
    group: "Life", label: "Starting grass seeds",
    tip: "Number of grass seeds scattered on land at the start.",
    min: 10, max: 5000, log: true, int: true, newWorld: true,
  }),
  param("initialAlgae", {
    group: "Life", label: "Starting algae",
    tip: "Number of algae cells scattered in the water at the start.",
    min: 10, max: 3000, log: true, int: true, newWorld: true,
  }),
  param("initialWaterPrefSpread", {
    group: "Life", label: "Spread of starting water preferences",
    tip: "Starting seeds get random water preferences spread over this range around the starting water preference, so different moisture niches can be tried from the outset.",
    min: 0, max: 1, newWorld: true,
  }),

  // --- Starting conditions: genes ---
  gene("grass", G_GROWTH, { group: "Starting genes", label: "Grass: growth speed", tip: "Nutrients a grass plant takes up per tick while growing.", min: 0.0005, max: 0.05, log: true }),
  gene("grass", G_BREED, { group: "Starting genes", label: "Grass: seeding chance", tip: "Chance per tick that a full-grown plant throws a seed.", min: 0.0005, max: 0.2, log: true }),
  gene("grass", G_RANGE, { group: "Starting genes", label: "Grass: seed throw distance", tip: "Furthest a seed can be thrown, in squares.", min: 1, max: 40 }),
  gene("grass", G_GERM, { group: "Starting genes", label: "Grass: germination wait", tip: "Ticks a seed lies dormant before sprouting.", min: 1, max: 800, log: true }),
  gene("grass", G_MUTATION, { group: "Starting genes", label: "Grass: mutation size", tip: "How much each gene can change, either way, in each seed.", min: 0.002, max: 0.5, log: true, fmt: pct }),
  gene("grass", G_LIFESPAN, { group: "Starting genes", label: "Grass: lifespan", tip: "Age in ticks at which a grass plant dies.", min: 100, max: 30000, log: true }),
  gene("grass", G_WATER_PREF, { group: "Starting genes", label: "Grass: water preference", tip: "Soil wetness (0 = dry, 1 = soaked) grass works best at. Starting seeds are spread around this value.", min: 0.01, max: 1 }),
  gene("grass", G_WATER_TOL, { group: "Starting genes", label: "Grass: water tolerance", tip: "How far from its preferred wetness grass still copes. Wider tolerance lowers peak efficiency.", min: 0.05, max: 1 }),
  gene("algae", G_GROWTH, { group: "Starting genes", label: "Algae: growth speed", tip: "Nutrients an algae cell takes up per tick while growing.", min: 0.0005, max: 0.05, log: true }),
  gene("algae", G_BREED, { group: "Starting genes", label: "Algae: budding chance", tip: "Chance per tick that full-grown algae buds a new cell next to it.", min: 0.0005, max: 0.2, log: true }),
  gene("algae", G_MUTATION, { group: "Starting genes", label: "Algae: mutation size", tip: "How much each gene can change, either way, in each new cell.", min: 0.002, max: 0.5, log: true, fmt: pct }),
  gene("algae", G_LIFESPAN, { group: "Starting genes", label: "Algae: lifespan", tip: "Age in ticks at which an algae cell dies.", min: 100, max: 30000, log: true }),
];

for (const s of SETTINGS) s.defaultValue = s.get();

/** Slider positions run 0..SLIDER_STEPS. */
export const SLIDER_STEPS = 1000;

export function toSlider(s: Setting, v: number): number {
  const t = s.log ? Math.log(v / s.min) / Math.log(s.max / s.min) : (v - s.min) / (s.max - s.min);
  return Math.round(Math.max(0, Math.min(1, t)) * SLIDER_STEPS);
}

export function fromSlider(s: Setting, pos: number): number {
  const t = pos / SLIDER_STEPS;
  const v = s.log ? s.min * (s.max / s.min) ** t : s.min + (s.max - s.min) * t;
  return s.int ? Math.round(v) : v;
}

export function formatSetting(s: Setting, v: number): string {
  if (s.fmt) return s.fmt(v);
  if (s.int) return Math.round(v).toLocaleString();
  const a = Math.abs(v);
  if (a === 0) return "0";
  if (a < 0.001 || a >= 100000) return v.toExponential(2);
  return v.toPrecision(3);
}
