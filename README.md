# Critter Jitter

A grid ecosystem simulation in HTML / CSS / TypeScript. The world is a grid
of squares drawn 3×3 pixels each. It starts as a 400×150 strip (1200×450
pixels), and its width and height can be changed on the Start tab. Stats and
graphs sit in masonry-style cards under the map, and a tabbed sidebar (Start,
World, Tools & weather, Settings, Help) fills the rest of the window.

```sh
npm install
npm run dev        # open the printed URL
npm run build      # typecheck + production build into dist/
npm run sim -- [seed] [ticks] [reportEvery] [width] [height]   # headless run for tuning
```

## Starting a world

The page opens paused on the **Start** tab, with a preview of the map. Every
starting condition is there: seed, terrain (world width and height,
landmass size, roughness), water
(sea level, starting wet-ground reach, starting soil wetness, starting cloud
water), life (starting nutrients, number of grass seeds and algae, spread of
water preferences) and starting genes. The preview and a summary (land/lake
split, total water and where it is, total nutrients, starting life) update as
you change them. Nothing runs until you press **Start**. Later, **Restart**
on the World tab rebuilds the same world, and *Set up a new world…* returns
to a paused preview on the Start tab.

## Time

The simulation runs on a real-time clock at 60 ticks per second of game time
(`TICKS_PER_SECOND`), times the chosen speed (½× to 8×). It doesn't run as
fast as the machine can go. If the machine can't keep up, the world slows
down rather than stuttering, and the panel shows the achieved speed with
"can't keep up". All rates in `PARAMS` are per tick.

## Layers

1. **Ground**: every square has a height of 1–16 from seeded Perlin fBm noise,
   generated once per world seed and never changed. Brown, lighter on higher
   ground, darker the more saturated it is.
2. **Water**: lakes start filled to a flat surface so squares at height ≤ 6
   are under water. After that, water is dynamic (see *Water cycle*). A square
   counts as water while its standing water is at least 0.3 deep. Deeper water
   is more opaque, and wetter ground is darker.
3. **Flora**: at most one organism (or seed) per square.
   - **Grass** (land only) absorbs energy from its square, pays a metabolic cost
     every tick, grows by pulling nutrients out of the ground, and at full
     growth may throw a seed in a random direction. Seeds lie dormant, then
     germinate. A seed that lands in water gives its nutrients to that water. A
     seed that lands on an occupied square or off the map rots into the ground.
   - **Algae** (water only) works the same way but draws nutrients from the
     water and buds live algae into a free adjacent water square. If no square
     is free, it doesn't breed. Deeper water gets less light.

## Critters: swimmers and sharks

Swimmers are small fish, drawn as 3-pixel lines that wiggle while they move.
Their colour comes from their hue, saturation and lightness genes, so
families show up as colour groups.

- **Energy.** Each swimmer has a short-term energy store and a fat reserve
  (both capped: the fat cap is genetic). Spare energy is turned into fat at
  a genetic rate, and fat is drawn on when energy runs low. Moving costs
  ½·m·v², where mass is body size plus fat, so fat swimmers pay more to move.
  Staying alive costs energy per unit of mass. Metabolism also sheds a little
  body nutrient into the water every tick, so swimmers must keep eating.
- **Behaviour.**
  - *Roaming*: with nothing in sight, a swimmer roams randomly at its genetic
    roaming speed.
  - *Hungry*: when fat drops below its hunger threshold, it looks for the
    nearest algae within 7 squares every so often, swims to it at top speed,
    and eats it in one go (the algae's nutrients and energy).
  - *Looking for a mate*: once it's old and fat enough (both genetic) it
    looks, less often, for another ready swimmer within 14 squares.
  - Swimmers can't move on land and slowly starve there. They pass through
    each other freely, and can sit on a square with grass.
- **Breeding.** Both swimmers must be ready. Any two can mate (no sexes),
  except a swimmer and its own parent. They make up to their preferred litter
  size (the parents' genetic average), as long as they can afford it. Each
  parent gives each child its genetic share of its nutrients and energy.
  Children appear straight away between the parents, and the parents then
  rest for a while before mating again.
- **Death.** Swimmers die of old age (genetic lifespan), starvation, or
  running out of body nutrients. Any remaining energy is lost, and the body
  rots, returning its nutrients to the square gradually.
- **Genome.** Swimmers have 16 traits (fat store max, fat storing, minimum /
  top / roaming speed, colour hue / saturation / lightness, breeding age,
  fat needed to breed, hunger threshold, lifespan, share given to each
  child, litter size, mutation size, body size). A swimmer has 23 genes, and
  each gene nudges a third of the traits (5) up or down, so several genes
  overlap on each trait. The genes act on top of editable defaults (Settings
  → *Swimmer traits*). A child gets 11 random genes from each parent, each
  mutated slightly by the parents' mutation size, plus one brand-new random
  gene, making 23 again.

### Sharks

Sharks hunt swimmers. They have the same lifecycle as swimmers (fat, hunger,
mates, breeding, old age, rotting bodies) and the same kind of genome: 23
genes, each nudging a third of their traits. They have two extra traits:

- **Boost likelihood**: when a shark spots a fish (it can detect them up to
  20 squares away), this is the chance it bursts into a boost.
- **Boost power**: the boost speed as a multiple of its top speed.

While boosting, a shark burns several times its normal upkeep, on top of the
higher ½·m·v² cost of moving faster, for a set number of ticks. A caught fish
is eaten whole: the shark gets its energy, fat and nutrients, plus extra
energy from digesting its body. Sharks are bigger than swimmers and drawn
shark-shaped (seen from above: tapered body, pectoral fins, and a forked
tail that sweeps as they swim), with a pale streak behind them while
boosting. Their colour is genetic too, defaulting to grey-blue.

Sharks glide. They turn gradually (a slow turn rate), speed up and slow down
smoothly, keep a steady course while roaming and only change course now and
then. They look ahead for land and turn away before reaching the shore, and
curve toward prey, turning harder only in the last few squares. They're
drawn centred on their position, so they rotate about their middle.
Swimmers use the same steering with nimble settings, so they stay quick and
twitchy. The turn rate, acceleration, how often and how far they change
course, and how far ahead they look for land are all in Settings for each
species.

Swimmers and sharks run on the same code (`src/sim/critters.ts`). Each
species has its own traits, settings (Settings → *Swimmers* / *Sharks*, and
their trait defaults) and diet.

Nutrients stay conserved: starting swimmers and sharks gather theirs from
the water, and everything a critter eats, sheds or leaves behind is
accounted for.

## Water cycle

The total amount of water is constant apart from the tools (the panel shows it). It is split
between three places:

- **Standing water** comes in two kinds:
  - **Run-off** (shallower than 0.3) runs downhill fast, half of it moving
    one square each tick. It follows a drainage network worked out once from
    the terrain: a priority flood from the lakes gives every square a route
    down to a lake. Flows merge into branching streams, drawn as bright blue
    lines, that swell during rain and dry up afterwards. Water follows the
    smooth height before rounding to levels 1–16, plus fine detail octaves,
    so it gathers in small valleys instead of spreading across flat terraces.
  - **Deep water** (lakes, ponds, a stream in flood) flows toward
    neighbours with a lower water surface, so lakes stay level.
- **Soil water** (up to 1 per square) soaks in from standing water slowly,
  much more slowly than run-off moves, and more slowly still as the soil
  fills. It spreads slowly between squares in any direction, which pulls
  water up and away from lakes. It drains downhill faster, in proportion to
  the height difference. Water over the soil's capacity seeps back out as
  standing water.
- **Clouds**: standing water and soil water evaporate into one shared cloud
  pool. Clouds are drawn as white translucent shapes made from 3D Perlin
  noise: the wind carries them across the map, and time runs along the third
  axis so their shapes slowly change as they go. They cover more of the map
  the more water they hold. Rain starts at random, more likely the fuller the
  clouds are: never below 12% of all water, and at 20% there's a 1-in-600
  chance per tick, rising with the square of how full they are. Rain falls
  where the clouds are, at a roughly steady rate, shared out by cloud
  thickness squared, so it's heaviest under the thickest (most opaque)
  cloud. How much falls varies each time: usually 15–40% of the cloud
  water, but about one rain in twelve empties the clouds completely. Rain
  tapers off as the clouds thin out, and rain clouds fade to grey.

The world starts with 17% of its water in the clouds, so lakes begin at the
level-6 shoreline and don't shrink much to fill the sky.

When water levels move, grass on a square that floods drowns and algae on a
square that dries out is stranded. Either way, its nutrients go back to the
square.

## Wind

The wind is its own system (`src/sim/wind.ts`). It isn't part of the water
cycle: clouds read it to drift, and later systems can too. It blows from a
prevailing direction, but its bearing and speed wander slowly and smoothly
(Perlin noise over time). Speed varies by up to about ±50%. The bearing
usually stays within a quarter turn or so of the prevailing wind but can
swing to any direction. The panel shows where it's blowing from and its
speed.

## Tools and weather controls

- **Cursor**: *Select* (drag a rectangle for area stats), *Rain* (hold to
  rain under the cursor, adding new water to the world), *Dryer* (hold to
  remove standing water, then soil water, under the cursor), and the sprays
  *Seeds*, *Algae*, *Swimmers* and *Sharks*, which drop things at random
  points inside the brush circle. Seeds only take on empty land and algae
  only in empty water, each taking its nutrients from the square it lands on.
  Swimmers and sharks get random genomes, land only in water, and gather
  their body nutrients from the water around them. Anything that can't be
  supplied is skipped, so nutrients stay conserved. Sprayed seeds and algae
  get the starting genes. Keys S / R / D / G / A / F / K switch between the
  tools.
  *Rate* and *Size* set the brush strength (water per second at the
  centre, or particles sprayed per second) and its radius. Rain and Dryer
  fade toward the edge of the circle. The tools work while paused too.
- **Manual rain**: switches off automatic rain. A button then starts and
  stops rain from the clouds, until they run dry.

Total water is conserved apart from what the Rain and Dryer tools add and
remove.

The **Water** card charts cloud water, free water (lakes, puddles and
streams) and water in the ground over time. Shaded vertical bands mark when
it was raining.

## Settings

Every variable of the running simulation has a slider on the **Settings**
tab, grouped into collapsible sections, with a plain-English name. Hover a
name for a description. Changed settings are highlighted, and *Reset all to
defaults* puts them back. They apply immediately. Starting conditions live
on the Start tab. The slider table is in `src/settings.ts`, and the
underlying values are in `src/sim/config.ts` (`PARAMS`, `TERRAIN`) and
`src/sim/genes.ts`.

## Nutrients and energy

- **Nutrients are conserved.** They move between ground, water and organisms
  but are never created or destroyed. The panel shows the total so you can
  check it stays constant.
- Water squares exchange nutrients with neighbouring water quickly. Wet ground
  exchanges nutrients with its neighbours (and with the water) slowly, in
  proportion to its current saturation. Dry ground never moves nutrients.
- **Energy** (sunlight) arrives in every square each tick, the same
  everywhere. The ground can't store it: only a plant or algae in the square
  can use it that tick, up to its own uptake limit, and the rest is lost.
- An organism dies when it can't pay its metabolism or reaches its genetic
  lifespan. All the nutrients it holds go back to its square.

## Genes

Each organism carries `growth`, `breed`, `range` (grass), `germ` (grass),
`mutation`, `lifespan`, `water pref` (grass) and `water tol` (grass). Every
gene mutates on every birth: the child's value is the parent's scaled by a
random factor in `[1 − m, 1 + m]`, where `m` is the parent's `mutation` gene
(default 0.05). The mutation gene mutates the same way, so the mutation rate
evolves too.

Grass's ability to use energy and nutrients (absorbing energy and growing) is
highest at its preferred soil saturation (`water pref`, 0–1). It falls off
with a bell curve whose width is `water tol`. A wide tolerance lowers the
peak, so generalists pay for their flexibility. The initial seeds get random
water preferences, so dry hills and soggy lake margins can both be colonised
and then specialise. The "Grass water preference" view colours grass from
yellow (dry-loving) to blue (wet-loving).

Other trade-offs: faster growth and a longer lifespan both raise metabolic
cost, and a longer seed range raises seed cost.

The panel shows each gene's mean ± standard deviation across the world.
Drag a rectangle on the map to get terrain, nutrient, population and gene
statistics (mean ± sd, min–max) for that area. They update live. Click or
press Esc to clear it.

All tunables can be changed live from the Settings panel.

## Code layout

- `src/sim/`: pure simulation with no DOM (`terrain`, `world`, `genes`, `perlin`, `rng`)
- `src/render.ts`: draws one pixel per square, which is then scaled ×2
- `src/main.ts`: loop, controls, stats, inspector
- `scripts/headless.ts`: runs the sim in Node for balancing
