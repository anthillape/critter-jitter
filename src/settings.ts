import { PARAMS, TERRAIN, TICKS_PER_SECOND, WORLD_SIZE, type Params } from "./sim/config";
import { CAT, FISH, SHARK, SHEEP, type SpeciesDef } from "./sim/critters";
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

/** The per-species settings shared by all animals (PARAMS keys by prefix). */
function critterSettings(sp: SpeciesDef, group: string, noun: string, food: string): Setting[] {
  const k = (name: string) => `${sp.prefix}${name}` as keyof Params;
  const e = (name: string, label: string, tip: string, range: Pick<Setting, "min" | "max" | "log" | "int">) =>
    param(k(name), { group, label, tip, ...range });
  const edge = sp.habitat === "water" ? "land" : "water";
  const grazer = sp.diet === "grass";
  return [
    e("MoveCost", "Cost of moving", `Multiplier on the energy a ${noun} spends moving (½ × mass × speed², where fat adds mass).`, { min: 0.005, max: 20, log: true }),
    e("Metabolism", "Upkeep per unit of mass", `Fat a ${noun} burns each tick just staying alive, per unit of body mass (fat counts as mass).` + PER_SEC, { min: 0.00005, max: 0.01, log: true }),
    e("FatMass", "Weight of fat", `Mass added by each unit of fat. Fatter ${sp.plural} cost more to move and to keep alive.`, { min: 0, max: 2 }),
    e("NutrientLoss", "Nutrient shedding", `Share of its body nutrients a ${noun} sheds into its square each tick, so it has to keep eating.` + PER_SEC, { min: 0, max: 0.005 }),
    e("MinNutrients", "Fewest nutrients to survive", `A ${noun} whose body nutrients fall below this dies.`, { min: 0.0005, max: 0.5, log: true }),
    // Grazers' sight range is genetic (the grass sight trait).
    ...(grazer ? [] : [e("FoodRadius", "Food sight range", `How far (squares) a hungry ${noun} can detect ${food}.`, { min: 1, max: 60, int: true })]),
    e("MateRadius", "Mate sight range", `How far (squares) a ${noun} ready to breed can see another ready ${noun}.`, { min: 2, max: 100, int: true }),
    e("FoodInterval", "Ticks between food searches", grazer
      ? `How often a hungry ${noun} looks around and turns toward the grassiest direction.`
      : `How often a hungry ${noun} looks around for ${food}.`, { min: 1, max: grazer ? 600 : 120, int: true, log: grazer }),
    e("MateInterval", "Ticks between mate searches", `How often a ${noun} ready to breed looks around for a mate.`, { min: 1, max: 300, int: true }),
    e("BreedCooldown", "Rest after mating", `Ticks after mating before a ${noun} can mate again.`, { min: 0, max: 10000, int: true }),
    e("MinChildFat", "Least fat for a child", "Parents won't make a child they can't give at least this much fat between them.", { min: 0.01, max: 10, log: true }),
    e("MinChildNutrients", "Fewest nutrients for a child", "Parents won't make a child they can't give at least this many nutrients between them.", { min: 0.001, max: 1, log: true }),
    e("RotRate", "Rotting speed", `Share of a dead ${noun}'s remaining nutrients returned to its square each tick.` + PER_SEC, { min: 0.0002, max: 0.1, log: true }),
    e("GeneStrength", "Gene strength", "How strongly each gene pushes its traits away from the defaults (affects new genes and mutations).", { min: 0.02, max: 1, log: true }),
    e("TurnRate", "Turning speed", `Most a ${noun} can turn each tick, in radians. Low values give smooth, gliding turns.`, { min: 0.005, max: 3.2, log: true }),
    e("Accel", "Acceleration", `Most a ${noun}'s speed can change each tick. Low values make it glide up to speed and coast to a stop.`, { min: 0.0002, max: 0.5, log: true }),
    e("WanderTurnChance", "Course changes while roaming", grazer
      ? `Chance each tick that a ${noun}'s general direction changes (its path also meanders around it).`
      : `Chance each tick that a roaming ${noun} picks a new course (1 = constant small jitters).`, { min: 0.0005, max: 1, log: true }),
    e("WanderTurnSize", "Size of course changes", `How far a roaming ${noun} turns when it changes course, in radians.`, { min: 0.05, max: 6.3 }),
    e("BirthSize", "Size at birth", `How big a newborn ${noun} is, as a share of its adult body size (100% = born full size). It grows into its adult size and can breed once nearly full-grown.`, { min: 0.05, max: 1 }),
    e("GrowthRate", "Growth speed", `Share of its adult size a young ${noun} grows each tick while it has spare energy.`, { min: 0.00005, max: 0.02, log: true }),
    e("GrowthCost", "Energy cost of growing", `Energy a young ${noun} spends for each unit of body mass it grows.`, { min: 0, max: 10 }),
    e("LookAhead", `Looks ahead for ${edge}`, `How many squares ahead a ${noun} checks for ${edge}, so it turns away before reaching the shore (0 = it just bumps into it).`, { min: 0, max: 20, int: true }),
  ];
}

/** Long-range sensing sliders for a species that scans for the most prey (sharks, cats). */
function senseSettings(sp: SpeciesDef, group: string, prey: string, across: string, blocker: string): Setting[] {
  const k = (name: string) => `${sp.prefix}${name}` as keyof Params;
  return [
    param(k("SenseRange"), {
      group, label: "Long-range sense distance",
      tip: `How far (squares) a ${sp.name} can sense ${prey}, looking in straight lines across ${across} in every direction. ${blocker[0].toUpperCase()}${blocker.slice(1)} blocks its view.`,
      min: 0, max: 400, int: true,
    }),
    param(k("SenseInterval"), {
      group, label: "Ticks between long-range looks",
      tip: `How often a ${sp.name} scans far and wide for the most ${prey}, then heads that way.`,
      min: 10, max: 2000, int: true, log: true,
    }),
    param(k("SenseRays"), {
      group, label: "Directions scanned",
      tip: `How many directions, all round, a ${sp.name} looks in when it scans. More directions miss less but cost more.`,
      min: 4, max: 128, int: true, log: true,
    }),
    param(k("SenseCrowd"), {
      group, label: `${prey[0].toUpperCase()}${prey.slice(1)} nearby to skip scanning`,
      tip: `A ${sp.name} doesn't bother scanning far if it already has this many ${prey} within its food sight range.`,
      min: 1, max: 50, int: true, log: true,
    }),
    param(k("SenseFull"), {
      group, label: "Too full to scan",
      tip: `A ${sp.name} doesn't bother scanning far once its fat is at least this share of what it can carry.`,
      min: 0.05, max: 1, fmt: pct,
    }),
  ];
}

/** Sliders for a species' trait defaults (the values before genes act). */
function critterTraitSettings(sp: SpeciesDef, group: string): Setting[] {
  return sp.traits.map((d): Setting => ({
    id: `${sp.key}Trait_${d.key}`,
    group,
    label: d.label,
    tip: `${d.tip} This is the default before genes act; changing it updates every ${sp.name}.`,
    min: d.mode === "mul" ? Math.max(d.min, d.max / 2000) : d.min,
    max: d.max,
    log: d.mode === "mul",
    get: () => d.def,
    set: (v) => {
      d.def = v;
      onCritterTraitsChanged();
    },
  }));
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
  param("flowRate", {
    group: "Water on the ground", label: "Water flow speed",
    tip: "How fast standing water runs to lower neighbouring squares (compared by ground height plus water depth). The same rule makes streams run and lakes settle level.",
    min: 0.01, max: 0.5, log: true,
  }),
  param("flowFocus", {
    group: "Water on the ground", label: "Channelling",
    tip: "How strongly running water picks the steepest way down. Higher values gather it into narrow streams; lower values spread it in sheets.",
    min: 0.5, max: 6,
  }),
  param("waterDepthMin", {
    group: "Water on the ground", label: "Depth that counts as water",
    tip: "Standing water at least this deep makes a water square: algae can live there, grass drowns, and fish can swim.",
    min: 0.05, max: 1.5, log: true,
  }),
  param("evaporation", {
    group: "Water on the ground", label: "Evaporation",
    tip: "Water evaporating into the clouds from every square each tick: from standing water if there is any, otherwise from the top soil." + PER_SEC,
    min: 1e-6, max: 5e-4, log: true,
  }),
  param("infiltration", {
    group: "Water on the ground", label: "Soak-in speed",
    tip: "How fast standing water soaks into the top soil layer. It slows as the layer fills. Lower = more run-off and bigger streams." + PER_SEC,
    min: 0.00002, max: 0.02, log: true,
  }),
  param("soilCap", {
    group: "Water on the ground", label: "Soil layer capacity",
    tip: "How much water each soil layer can hold.",
    min: 0.2, max: 4, log: true,
  }),
  param("percolation", {
    group: "Water on the ground", label: "Seeping down",
    tip: "How fast water seeps down from one soil layer to the next under gravity (faster when the layer above is wet and the one below dry)." + PER_SEC,
    min: 0.00005, max: 0.05, log: true,
  }),
  param("capillary", {
    group: "Water on the ground", label: "Capillary rise",
    tip: "How strongly water is pulled back up toward a drier soil layer above (water pressure), keeping the topsoil damp over wet ground." + PER_SEC,
    min: 0, max: 0.05,
  }),
  param("groundFlow", {
    group: "Water on the ground", label: "Groundwater flow",
    tip: "How fast groundwater (the deepest soil layer) flows sideways toward lower ground. It gathers under valleys and comes up as springs when the soil there is full.",
    min: 0, max: 0.1,
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
  param("algaeBreedSize", {
    group: "Algae", label: "Size when algae can release spores",
    tip: "Algae can release spores once grown to this share of full size. Below the size fish bother eating, it gives grazed water a way to recover.",
    min: 0.1, max: 1, fmt: pct,
  }),
  param("algaeBreedReserve", {
    group: "Algae", label: "Energy kept back when releasing a spore",
    tip: "Algae only releases a spore if it would still have this much energy left.",
    min: 0, max: 2,
  }),
  param("algaeSporeSpeed", {
    group: "Algae", label: "Spore drift speed",
    tip: "How fast spores drift through the water, in squares per tick. Spores spend no energy moving.",
    min: 0.001, max: 0.3, log: true,
  }),
  param("algaeSporeDrift", {
    group: "Algae", label: "Spore wandering",
    tip: "How much a spore's direction wanders each tick, in radians. Low values drift in long straight lines; high values jitter about.",
    min: 0, max: 1,
  }),
  param("algaeSporeSharkRadius", {
    group: "Algae", label: "Shark wake reach",
    tip: "Spores within this many squares of a shark get caught in its wake and start drifting the way it's heading (0 = sharks don't affect spores).",
    min: 0, max: 30,
  }),
  param("algaeSporeSharkPull", {
    group: "Algae", label: "Shark wake pull",
    tip: "How strongly a nearby shark swings a spore's direction toward its own heading each tick (stronger the closer the shark).",
    min: 0.001, max: 1, log: true,
  }),

  // --- Animals: fish, sharks, sheep and cats ---
  param("hueMutation", {
    group: "Animal colours", label: "Hue mutation",
    tip: "A newborn animal's hue is the midpoint of its parents' hues, nudged randomly by up to this many degrees. Larger values let families drift apart in colour faster.",
    min: 0, max: 90, fmt: (v) => `±${v.toFixed(0)}°`,
  }),
  ...critterSettings(FISH, "Fish", "fish", "algae"),
  param("fishMinAlgaeSize", {
    group: "Fish", label: "Smallest algae worth eating",
    tip: "Fish only eat algae grown to at least this share of full size, so young algae can regrow.",
    min: 0, max: 1, fmt: pct,
  }),
  ...critterTraitSettings(FISH, "Fish traits (defaults)"),
  ...critterSettings(SHARK, "Sharks", "shark", "fish (or swimming sheep)"),
  param("sharkStrokeTicks", {
    group: "Sharks", label: "Tail stroke length",
    tip: "Sharks swim in strokes: a few sweeps of the tail speed them up, then they glide. This is the longest a stroke lasts, in ticks (it ends early once the shark is a little faster than it wants to go).",
    min: 5, max: 300, int: true, log: true,
  }),
  param("sharkTailBeat", {
    group: "Sharks", label: "Tail beat speed",
    tip: "How fast a shark's tail sweeps side to side during a stroke (looks only). At 0.15 one full sweep takes about 0.7 s.",
    min: 0.02, max: 1, log: true,
  }),
  param("sharkGlideDrag", {
    group: "Sharks", label: "Glide slowing",
    tip: "Share of its speed a gliding shark loses each tick. Low values mean long glides between strokes." + PER_SEC,
    min: 0.0005, max: 0.05, log: true,
  }),
  param("sharkGlideSlack", {
    group: "Sharks", label: "Glide before next stroke",
    tip: "How far below the speed it wants a shark lets itself slow before its next stroke (strokes push it half this far above). Larger values give longer glides and bigger surges.",
    min: 0.02, max: 0.9, fmt: pct,
  }),
  ...senseSettings(SHARK, "Sharks", "fish", "water", "land"),
  param("sharkBoostRange", {
    group: "Sharks", label: "Boost range",
    tip: "How close (squares) a shark gets to the prey it's locked on to before it may boost at it.",
    min: 1, max: 30, log: true,
  }),
  param("sharkBoostDuration", {
    group: "Sharks", label: "Boost length",
    tip: "Ticks a shark's boost lasts once it bursts at its prey.",
    min: 5, max: 600, int: true, log: true,
  }),
  param("sharkBoostMetabolism", {
    group: "Sharks", label: "Upkeep while boosting",
    tip: "How many times its normal upkeep a shark burns while boosting (on top of the extra cost of moving faster).",
    min: 1, max: 20, log: true,
  }),
  ...critterTraitSettings(SHARK, "Shark traits (defaults)"),
  ...critterSettings(SHEEP, "Sheep", "sheep", "grass"),
  param("sheepBite", {
    group: "Sheep", label: "Bite size",
    tip: "Nutrients a grazing sheep takes from the grass under it each tick, with the same share of the plant's energy. Smaller bites mean it takes longer to eat a plant.",
    min: 0.0005, max: 0.2, log: true,
  }),
  param("sheepGrazeFloor", {
    group: "Sheep", label: "Grazed down to",
    tip: "Once grass is grazed below this share of full size, the sheep eats the rest and the plant is gone.",
    min: 0, max: 0.9, fmt: pct,
  }),
  param("sheepSwimEffort", {
    group: "Sheep", label: "Cost of swimming",
    tip: "Energy a sheep spends each tick swimming, per unit of body mass, if it's the worst possible swimmer. The best swimmers (swimming ability 1) pay a quarter of this." + PER_SEC,
    min: 0.0001, max: 0.05, log: true,
  }),
  param("sheepSwimWalkCost", {
    group: "Sheep", label: "Walking cost of swimming ability",
    tip: "Extra walking cost a perfect swimmer pays (1 = walking costs twice as much); scaled by swimming ability.",
    min: 0, max: 5,
  }),
  param("sheepSpace", {
    group: "Sheep", label: "Personal space",
    tip: "Room (squares) a sheep likes to keep between its body and another sheep's. Sheep steer away from others closer than this, except when looking for a mate.",
    min: 0, max: 15,
  }),
  param("sheepSpaceWeight", {
    group: "Sheep", label: "Keeping apart",
    tip: "How strongly a sheep steers away from sheep inside its personal space (0 = it doesn't).",
    min: 0, max: 10,
  }),
  param("sheepMeanderRate", {
    group: "Sheep", label: "Meander speed",
    tip: "How quickly a sheep's path swings about within its meander arc, in radians per tick.",
    min: 0.001, max: 0.3, log: true,
  }),
  ...critterTraitSettings(SHEEP, "Sheep traits (defaults)"),
  ...critterSettings(CAT, "Cats", "cat", "sheep"),
  param("catPounceSpeed", {
    group: "Cats", label: "Pounce speed",
    tip: "How fast a cat dashes when it pounces, in squares per tick. It pounces straight at where the sheep was, so fast pounces are more likely to land.",
    min: 0.02, max: 1, log: true,
  }),
  param("catPounceRest", {
    group: "Cats", label: "Rest after pouncing",
    tip: "Ticks after a pounce before a cat can pounce again (it keeps stalking meanwhile).",
    min: 0, max: 2000, int: true,
  }),
  param("catSwimEffort", {
    group: "Cats", label: "Cost of swimming",
    tip: "Energy a cat caught in water spends each tick swimming for the shore, per unit of body mass, if it's the worst possible swimmer. The best swimmers pay a quarter of this." + PER_SEC,
    min: 0.0001, max: 0.05, log: true,
  }),
  param("catSwimWalkCost", {
    group: "Cats", label: "Walking cost of swimming ability",
    tip: "Extra walking cost a perfect swimmer pays (1 = walking costs twice as much); scaled by swimming ability.",
    min: 0, max: 5,
  }),
  ...senseSettings(CAT, "Cats", "sheep", "land", "water"),
  param("catMeanderRate", {
    group: "Cats", label: "Meander speed",
    tip: "How quickly a cat's path swings about within its meander arc, in radians per tick.",
    min: 0.001, max: 0.3, log: true,
  }),
  ...critterTraitSettings(CAT, "Cat traits (defaults)"),

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
  {
    id: "worldWidth", group: "Terrain", label: "World width",
    tip: "Width of the world in squares. Bigger worlds run slower.",
    min: 100, max: 800, int: true, newWorld: true,
    get: () => WORLD_SIZE.width,
    set: (v) => {
      WORLD_SIZE.width = Math.round(v);
    },
    fmt: (v) => `${Math.round(v)} sq`,
  },
  {
    id: "worldHeight", group: "Terrain", label: "World height",
    tip: "Height of the world in squares. Bigger worlds run slower.",
    min: 40, max: 600, int: true, newWorld: true,
    get: () => WORLD_SIZE.height,
    set: (v) => {
      WORLD_SIZE.height = Math.round(v);
    },
    fmt: (v) => `${Math.round(v)} sq`,
  },
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
  param("startingSurfaceWater", {
    group: "Water", label: "Starting surface water",
    tip: "How much standing water there is at the start, as an average depth over the whole world. It fills the lowest ground first, so lakes form wherever the land is lowest.",
    min: 0, max: 6, newWorld: true,
  }),
  terrain("soilLayers", {
    group: "Water", label: "Soil layers",
    tip: "How many layers each square's soil column has. The top layer is what plants feel; water seeps down through the column and is pulled back up, and the deepest layer flows as groundwater.",
    min: 1, max: 8, int: true,
  }),

  param("initialSoilWetness", {
    group: "Water", label: "Starting soil wetness",
    tip: "How full every soil layer starts (0 = bone dry, 100% = soaked). Soil under the starting lakes starts full. More soil water means more total water in the world.",
    min: 0, max: 1, fmt: pct, newWorld: true,
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
  param("initialFish", {
    group: "Life", label: "Starting fish",
    tip: "Number of fish (with random genomes) released into the water at the start. Each takes a few nutrients from the water.",
    min: 0, max: 2000, int: true, newWorld: true,
  }),
  param("fishStartFat", {
    group: "Life", label: "Starting fish fat",
    tip: "Fat (its energy) each starting fish begins with (up to what it can carry).",
    min: 0.1, max: 20, log: true, newWorld: true,
  }),
  param("fishStartNutrients", {
    group: "Life", label: "Starting fish nutrients",
    tip: "Nutrients each starting fish takes from the water to build its body.",
    min: 0.01, max: 0.5, log: true, newWorld: true,
  }),
  param("initialSharks", {
    group: "Life", label: "Starting sharks",
    tip: "Number of sharks (with random genomes) released into the water at the start. Each gathers a few nutrients from the water around it.",
    min: 0, max: 500, int: true, newWorld: true,
  }),
  param("sharkStartFat", {
    group: "Life", label: "Starting shark fat",
    tip: "Fat (its energy) each starting shark begins with (up to what it can carry).",
    min: 0.5, max: 30, log: true, newWorld: true,
  }),
  param("sharkStartNutrients", {
    group: "Life", label: "Starting shark nutrients",
    tip: "Nutrients each starting shark gathers from the water to build its body.",
    min: 0.02, max: 2, log: true, newWorld: true,
  }),
  param("initialSheep", {
    group: "Life", label: "Starting sheep",
    tip: "Number of sheep (with random genomes) released on land at the start. Each gathers a few nutrients from the ground around it.",
    min: 0, max: 1000, int: true, newWorld: true,
  }),
  param("sheepStartFat", {
    group: "Life", label: "Starting sheep fat",
    tip: "Fat (its energy) each starting sheep begins with (up to what it can carry).",
    min: 0.2, max: 20, log: true, newWorld: true,
  }),
  param("sheepStartNutrients", {
    group: "Life", label: "Starting sheep nutrients",
    tip: "Nutrients each starting sheep gathers from the ground to build its body.",
    min: 0.01, max: 1, log: true, newWorld: true,
  }),
  param("initialCats", {
    group: "Life", label: "Starting cats",
    tip: "Number of cats (with random genomes) released on land at the start. Each gathers a few nutrients from the ground around it.",
    min: 0, max: 500, int: true, newWorld: true,
  }),
  param("catStartFat", {
    group: "Life", label: "Starting cat fat",
    tip: "Fat (its energy) each starting cat begins with (up to what it can carry).",
    min: 0.5, max: 30, log: true, newWorld: true,
  }),
  param("catStartNutrients", {
    group: "Life", label: "Starting cat nutrients",
    tip: "Nutrients each starting cat gathers from the ground to build its body.",
    min: 0.02, max: 2, log: true, newWorld: true,
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
  gene("algae", G_BREED, { group: "Starting genes", label: "Algae: spore release chance", tip: "Chance per tick that grown algae releases a spore (if it can spare the energy and nutrients).", min: 0.0005, max: 0.2, log: true }),
  gene("algae", G_GERM, { group: "Starting genes", label: "Algae: spore time", tip: "Ticks a spore drifts before settling as a new algae cell (300 = 5 s at 1×).", min: 1, max: 800, log: true }),
  gene("algae", G_MUTATION, { group: "Starting genes", label: "Algae: mutation size", tip: "How much each gene can change, either way, in each new cell.", min: 0.002, max: 0.5, log: true, fmt: pct }),
  gene("algae", G_LIFESPAN, { group: "Starting genes", label: "Algae: lifespan", tip: "Age in ticks at which an algae cell dies.", min: 100, max: 30000, log: true }),
];

for (const s of SETTINGS) s.defaultValue = s.get();

/** Called when critter trait defaults change (the app re-expresses living critters). */
let onCritterTraitsChanged: () => void = () => {};
export function setCritterTraitsHook(f: () => void): void {
  onCritterTraitsChanged = f;
}

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
