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
2. **Water**: squares at height ≤ 6 are under water (depth 1–6), drawn blue and
   more opaque the deeper they are. Water irrigates land up to 60 squares
   away. Saturation falls off with distance to the nearest water square.
3. **Flora**: at most one organism (or seed) per square.
   - **Grass** (land only) absorbs energy from its square, pays a metabolic cost
     every tick, grows by pulling nutrients out of the ground, and at full
     growth may throw a seed in a random direction. Seeds lie dormant, then
     germinate. A seed that lands in water gives its nutrients to that water. A
     seed that lands on an occupied square or off the map rots into the ground.
   - **Algae** (water only) works the same way but draws nutrients from the
     water and buds live algae into a free adjacent water square. If no square
     is free, it doesn't breed. Deeper water gets less light.

## Nutrients and energy

- **Nutrients are conserved.** They move between ground, water and organisms
  but are never created or destroyed. The panel shows the total so you can
  check it stays constant.
- Water squares exchange nutrients with neighbouring water quickly. Wet ground
  exchanges nutrients with its neighbours (and with the water) slowly, in
  proportion to its saturation. Dry ground never moves nutrients.
- **Energy** arrives in every square each tick (capped). Plants draw it from
  their square. Grass draws it more efficiently on wet ground.
- An organism dies when it can't pay its metabolism or reaches its genetic
  lifespan. All the nutrients it holds go back to its square.

## Genes

Each organism carries `growth`, `breed`, `range` (grass), `germ` (grass),
`mutation` and `lifespan`. Every gene mutates on every birth: the child's
value is the parent's scaled by a random factor in `[1 − m, 1 + m]`, where `m`
is the parent's `mutation` gene (default 0.05). The mutation gene mutates the
same way, so the mutation rate evolves too. Faster growth and a longer
lifespan both raise metabolic cost, and a longer seed range raises seed cost,
so evolution has trade-offs.

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
