# Critter Jitter

A grid ecosystem simulation in HTML / CSS / TypeScript. The world is a
400×300 grid of squares (120,000 squares), drawn 3×3 pixels each on a
1200×900 map. Stats and graphs sit in cards under the map, and a tabbed
sidebar (World, Tools & weather, Settings, Help) fills the rest of the
window.

```sh
npm install
npm run dev        # open the printed URL
npm run build      # typecheck + production build into dist/
npm run sim -- [seed] [ticks] [reportEvery]   # headless run for tuning
```

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
  rain under the cursor, adding new water to the world) and *Dryer* (hold to
  remove standing water, then soil water, under the cursor). Keys S / R / D
  switch between them. *Rate* and *Size* sliders set how much water per
  second at the centre and the brush radius. The effect falls off toward
  the edge of the circle. The tools work while paused too.
- **Manual rain**: switches off automatic rain. A button then starts and
  stops rain from the clouds, until they run dry.

Total water is conserved apart from what the Rain and Dryer tools add and
remove.

## Settings

Every simulation variable has a slider in the **Settings** panel, grouped
into collapsible sections, with a plain-English name. Hover a name for a
description. Settings you've changed are highlighted, and *Reset all to
defaults* puts everything back. Most apply immediately. The *New world*
sections (terrain, starting life and starting genes) take effect when you
press **Restart** (same seed) or **New world** (typed or random seed). The
slider table lives in `src/settings.ts`, and the underlying values are in
`src/sim/config.ts` (`PARAMS`, `TERRAIN`) and `src/sim/genes.ts`.

## Nutrients and energy

- **Nutrients are conserved.** They move between ground, water and organisms
  but are never created or destroyed. The panel shows the total so you can
  check it stays constant.
- Water squares exchange nutrients with neighbouring water quickly. Wet ground
  exchanges nutrients with its neighbours (and with the water) slowly, in
  proportion to its current saturation. Dry ground never moves nutrients.
- **Energy** arrives in every square each tick (capped), the same everywhere.
  Plants draw it from their square.
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
