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
(starting standing water, soil layers, starting soil wetness, starting cloud
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
down rather than stuttering, and the achieved speed (with "can't keep up")
is shown next to the speed control. All rates in `PARAMS` are per tick.

## Layers

1. **Ground**: every square has a height of 1–16 from seeded Perlin fBm noise,
   generated once per world seed and never changed. Brown, lighter on higher
   ground, darker the more saturated it is.
2. **Water**: there is no special water height. The starting standing water
   is poured into the lowest ground, filling it to one flat level, and after
   that water is dynamic (see *Water cycle*). A square
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

## Animals: fish, sharks and sheep

Fish are small, drawn as 3-pixel lines that wiggle while they move.
Their colour comes from their hue, saturation and lightness genes, so
families show up as colour groups.

- **Energy.** Each fish has a short-term energy store and a fat reserve
  (both capped: the fat cap is genetic). Spare energy is turned into fat at
  a genetic rate, and fat is drawn on when energy runs low. Moving costs
  ½·m·v², where mass is body size plus fat, so fat fish pay more to move.
  Staying alive costs energy per unit of mass. Metabolism also sheds a little
  body nutrient into the water every tick, so fish must keep eating.
- **Behaviour.**
  - *Roaming*: with nothing in sight, a fish roams randomly at its genetic
    roaming speed.
  - *Hungry*: when fat drops below its hunger threshold, it looks for the
    nearest algae within 7 squares every so often, swims to it at top speed,
    and eats it in one go (the algae's nutrients and energy).
  - *Looking for a mate*: once it's old and fat enough (both genetic) it
    looks, less often, for another ready fish within 14 squares.
  - Fish can't move on land and slowly starve there. They pass through
    each other freely, and can sit on a square with grass.
- **Breeding.** Both fish must be ready. Any two can mate (no sexes),
  except a fish and its own parent. They make up to their preferred litter
  size (the parents' genetic average), as long as they can afford it. Each
  parent gives each child its genetic share of its nutrients and energy.
  Children appear straight away between the parents, and the parents then
  rest for a while before mating again.
- **Death.** Fish die of old age (genetic lifespan), starvation, or
  running out of body nutrients. Any remaining energy is lost, and the body
  rots, returning its nutrients to the square gradually. Dead bodies stay
  where they died, turn grey, and fade out as they decompose.
- **Genome.** Fish have 16 traits (fat store max, fat storing, minimum /
  top / roaming speed, colour hue, breeding age, fat needed to breed, hunger
  threshold, lifespan, share given to each child, litter size, mutation
  size, body size, colour saturation / lightness). A fish has 23 genes, and
  each gene nudges a third of the traits (5) up or down, so several genes
  overlap on each trait. The genes act on top of editable defaults (Settings
  → *Fish traits*). A child gets 11 random genes from each parent, each
  mutated slightly by the parents' mutation size, plus one brand-new random
  gene, making 23 again.

### Sharks

Sharks hunt fish (and sheep caught swimming). They have the same lifecycle
as fish (fat, hunger, mates, breeding, old age, rotting bodies) and the same
kind of genome: 23 genes, each nudging a third of their traits. A hungry
shark locks on to the nearest prey it can see (up to 20 squares away) and
follows it until it catches it, loses sight of it, or the prey escapes (a
sheep reaching land). They're fast, efficient swimmers: moving costs them
far less per unit of mass than it costs fish. They have two extra traits:

- **Boost likelihood**: once a shark has closed to within 5 squares of the
  prey it's locked on to (*Boost range*), this is the chance it bursts into
  a boost.
- **Boost power**: the boost speed as a multiple of its top speed.

While boosting, a shark burns several times its normal upkeep, on top of the
higher ½·m·v² cost of moving faster, for a set number of ticks. A caught fish
is eaten whole: the shark gets its energy, fat and nutrients, plus extra
energy from digesting its body. Sharks are bigger than fish and drawn
shark-shaped (seen from above: tapered body, pectoral fins, and a forked
tail that sweeps as they swim). Their colour is genetic too, defaulting to grey-blue.

Baby sharks are born at 15% of their adult size and grow into it while they
have spare energy, paying energy for each unit of body mass they add. They
can breed once nearly full-grown. Adult size is genetic (*Body size*,
default 6, up to 20). A shark's current mass sets how much energy it spends
moving (½·m·v²) and staying alive, and how much energy it gives when eaten,
so big sharks cost more to run. Sharks are drawn in proportion to their
current size. Birth size, growth speed and growth cost are settings for each
species; fish are born full-size by default.

Sharks glide. They turn gradually (a slow turn rate), speed up and slow down
smoothly, keep a steady course while roaming and only change course now and
then. They look ahead for land and turn away before reaching the shore, and
curve toward prey, turning harder only in the last few squares. They're
drawn centred on their position, so they rotate about their middle.
Fish use the same steering with nimble settings, so they stay quick and
twitchy. The turn rate, acceleration, how often and how far they change
course, and how far ahead they look for land are all in Settings for each
species.

### Sheep

Sheep live on land and graze grass. They have the same lifecycle and kind
of genome as fish and sharks (23 genes, each nudging a third of their 17
traits, including *Swimming ability*). They are drawn as little rounded squares of fleece, 4 pixels
across at the default size, with a black head at the front. Their colour
genome has only a hue: sheep are always pastel shades.

- **Meandering.** A sheep walks slowly in a general direction, and its path
  wanders to and fro within an arc around that direction. The arc is
  genetic (*Meander arc*, 20–90°). The general direction changes now and
  then.
- **Grazing.** A hungry sheep (fat below its hunger threshold) that walks
  onto grass stops and grazes. Each tick it takes a bite (*Bite size*, in
  nutrients, with the same share of the plant's energy), so the grass shrinks
  over several ticks. Once the plant is grazed below *Grazed down to*, the
  sheep eats the rest and the plant is gone. A sheep keeps grazing a plant
  it has started until the plant is gone or its fat store is full.
- **Finding grass.** Every so often a hungry sheep looks over the grass
  within its genetic *Grass sight* (10–30 squares), and turns its general
  direction toward the grassiest of eight directions.
- **Water.** When a sheep sees water ahead (or reaches the edge), it turns
  right round, 170–190° to the left or right, and walks off that way.
- **Swimming.** A sheep caught in water (by a flood, say) swims at half its
  walking speed, always toward the nearest shore. Sharks can catch and eat
  it while it's in the water. Swimming ability is genetic (0–1): better
  swimmers spend less energy swimming (*Cost of swimming*, down to a
  quarter at ability 1) but more walking (*Walking cost of swimming
  ability*: up to twice the cost by default).
- **Mates.** When ready to breed, it walks to the nearest other ready sheep.

Fish, sharks and sheep run on the same code (`src/sim/critters.ts`). Each
species has its own traits, settings (Settings → *Fish* / *Sharks* /
*Sheep*, and their trait defaults), diet and habitat.

Nutrients stay conserved: starting fish and sharks gather theirs from
the water and starting sheep from the ground, and everything a critter eats, sheds or leaves behind is
accounted for.

## Water cycle

The total amount of water is constant apart from the tools (the panel shows it). It is split
between three places:

- **Standing water** flows downhill everywhere by the same rule: each
  square sends water to lower neighbours (all eight, judged by ground plus
  water level), favouring the steepest way (*Channelling*), and never more
  than would level the two squares. Streams, ponds and lakes all come out of
  that one rule; nothing is levelled or routed specially.
- **Soil water** sits in a column of soil layers under every square (3 by
  default, each holding up to 1). Standing water soaks into the top layer,
  more slowly as it fills. Within a column, water seeps down slowly under
  gravity, and capillary pressure pulls it back up toward a drier layer
  above. Water that doesn't fit is pushed up the column, and out of the top
  it comes back out as a spring. The deepest layer is groundwater: it flows
  sideways toward lower ground by the difference in head. The ground is
  drawn and plants feel only the top layer; the whole column counts towards
  water totals.
- **Evaporation** takes the same amount from every square each tick: from
  standing water if there is any, otherwise from the top soil layer.
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

The world starts with 17% of its water in the clouds. The starting standing
water (1.3 deep averaged over the world by default) fills the lowest ground,
the soil under it starts full and the rest starts 40% wet.

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
  *Seeds*, *Algae*, *Fish*, *Sharks* and *Sheep*, which drop things at random
  points inside the brush circle. Seeds only take on empty land and algae
  only in empty water, each taking its nutrients from the square it lands on.
  Animals get random genomes. Fish and sharks land only in water and sheep
  only on land, and they gather their body nutrients from the squares
  around them. Anything that can't be
  supplied is skipped, so nutrients stay conserved. Sprayed seeds and algae
  get the starting genes. Keys S / R / D / G / A / F / K / H switch between the
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
