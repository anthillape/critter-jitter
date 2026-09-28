# Critter Jitter

A grid ecosystem simulation in HTML / CSS / TypeScript. The world is an
800×600 canvas of 2×2-pixel squares (400×300 = 120,000 squares).

```sh
npm install
npm run dev        # open the printed URL
npm run build      # typecheck + production build into dist/
npm run sim -- [seed] [ticks] [reportEvery]   # headless run for tuning
```

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

The total amount of water is constant (the panel shows it). It is split
between three places:

- **Standing water** (lakes, puddles, run-off) flows toward neighbours with a
  lower water surface, so lakes level out and rain runs downhill.
- **Soil water** (up to 1 per square) soaks in from standing water. It
  spreads slowly between squares in any direction, which pulls water up and
  away from lakes. It drains downhill faster, in proportion to the height
  difference. Water over the soil's capacity seeps back out as standing
  water.
- **Clouds**: standing water and soil water evaporate into one shared cloud
  pool. Clouds are drawn as white translucent Perlin-noise shapes drifting
  slowly across the map, and cover more of it the more water they hold. When
  the clouds hold more than 20% of all water, a shower starts: the water
  above 14% falls over 1,000 ticks (about 5 seconds at the default speed),
  where the clouds are. Clouds look greyer while it rains.

The world starts with 17% of its water in the clouds, so lakes begin at the
level-6 shoreline and don't shrink much to fill the sky.

When water levels move, grass on a square that floods drowns and algae on a
square that dries out is stranded. Either way, its nutrients go back to the
square.

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

All tunables live in `src/sim/config.ts` (`PARAMS`) and `src/sim/genes.ts`
(defaults and limits).

## Code layout

- `src/sim/`: pure simulation with no DOM (`terrain`, `world`, `genes`, `perlin`, `rng`)
- `src/render.ts`: draws one pixel per square, which is then scaled ×2
- `src/main.ts`: loop, controls, stats, inspector
- `scripts/headless.ts`: runs the sim in Node for balancing
