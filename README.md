# Critter Jitter

A grid ecosystem simulation in HTML / CSS / TypeScript. The world is a grid
of squares drawn 3×3 pixels each. It starts as a 400×150 strip (1200×450
pixels), and its width and height can be changed on the Start tab. Stats and
graphs sit in masonry-style cards under the map, and a tabbed sidebar (Start,
World, Tools & weather, Settings, Help) fills the rest of the window.

The map stays in place while the cards scroll on their own underneath it (the
map shrinks to fit if the window is short). Click a card's title to collapse
or expand it, or drag the title to move the card: the other cards make room
as you drag, and it snaps into its new place when you let go. The order and
collapsed cards are remembered in the browser.

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
     water, and breeds by releasing **spores** (drawn as faint pale-green
     specks). A spore takes its nutrients and energy from the parent and
     drifts slowly through the water, its direction gradually wandering,
     bouncing off land and using no energy. Fish can't eat spores. Spores near
     a shark get caught in its wake: their direction swings toward the way
     the shark is heading. After its genetic spore time (default 5 s; the
     algae's use of the gene grass uses for germination) a spore settles as
     a new algae cell if the square it's on is free water; otherwise it
     dies (like a seed landing on an occupied square) and its nutrients
     return to the water. Deeper water gets less light.

## Animals: fish, sharks, sheep and cats

Fish are small, drawn as 3-pixel lines that wiggle while they move.
Their colour comes from their hue, saturation and lightness genes, so
families show up as colour groups.

**Hue is inherited directly** (for every animal): founders take their hue
from their genes, but a child's hue is the midpoint of its parents' hues
around the colour wheel (so red-orange and red-purple make red, not green),
nudged randomly by up to ±6° (*Hue mutation*, Settings → *Animal colours*).
Lineages therefore keep a family colour that drifts slowly over the
generations. Changing a species' *Colour hue* default only recolours
founders.

- **Fat is energy.** An animal has one energy store: its fat, up to a
  genetic maximum (*Fat store max*; anything beyond that is lost). Everything
  it eats goes into fat, and everything it does is paid from fat. Moving costs
  ½·m·v², where mass is body size plus a little for its fat, so fat animals pay
  a bit more to move. Staying alive costs fat per unit of mass. It starves
  when its fat runs out. Metabolism also sheds a little
  body nutrient into the water every tick, so fish must keep eating.
- **Behaviour.**
  - *Roaming*: with nothing in sight, a fish roams randomly at its genetic
    roaming speed.
  - *Hungry*: when fat drops below its hunger threshold, it looks for the
    nearest algae within 7 squares every so often, swims to it at top speed,
    and eats it in one go (the algae's nutrients, and its energy as fat).
  - *Looking for a mate*: once it's old and fat enough (both genetic) it
    looks, less often, for another ready fish within 14 squares.
  - Fish can't move on land and slowly starve there. They pass through
    each other freely, and can sit on a square with grass.
- **Breeding.** Both fish must be ready. Any two can mate (no sexes),
  except a fish and its own parent. They make up to their preferred litter
  size (the parents' genetic average), as long as they can afford it. Each
  parent gives each child its genetic share of its nutrients and fat.
  Children appear straight away between the parents, and the parents then
  rest for a while before mating again.
- **Death.** Fish die of old age (genetic lifespan), starvation, or
  running out of body nutrients. Any remaining fat is lost, and the body
  rots, returning its nutrients to the square gradually. Dead bodies stay
  where they died, turn grey, and fade out as they decompose.
- **Genome.** Fish have 15 traits (fat store max, minimum /
  top / roaming speed, colour hue, breeding age, fat needed to breed, hunger
  threshold, lifespan, share given to each child, litter size, mutation
  size, body size, colour saturation / lightness). A fish has 23 genes, and
  each gene nudges a third of the traits (5) up or down, so several genes
  overlap on each trait. The genes act on top of editable defaults (Settings
  → *Fish traits*). A child gets 11 random genes from each parent, each
  mutated by the parents' mutation size (default 0.45, so populations adapt
  within a few generations), plus one brand-new random gene, making 23 again.

### Sharks

Sharks hunt fish (and sheep caught swimming). They have the same lifecycle
as fish (fat, hunger, mates, breeding, old age, rotting bodies) and the same
kind of genome: 23 genes, each nudging a third of their traits. A hungry
shark locks on to the nearest prey it can see (up to 20 squares away) and
follows it until it catches it, loses sight of it, or the prey escapes (a
sheep reaching land). They're fast, efficient swimmers: moving costs them
far less per unit of mass than it costs fish. They have two extra traits:

- **Long-range sensing**: every 20 s or so (*Ticks between long-range
  looks*), a shark that is less than 35% full (*Too full to scan*) and has
  fewer than 4 fish within sight (*Fish nearby to skip scanning*) looks all
  round, in 32 straight lines across the water up to 100 squares (land blocks
  its view), counts the fish along each, and heads off the way it saw the
  most, for as long as it would take to get there.
- **Boost likelihood**: once a shark has closed to within 5 squares of the
  prey it's locked on to (*Boost range*), this is the chance it bursts into
  a boost.
- **Boost power**: the boost speed as a multiple of its top speed.

While boosting, a shark burns several times its normal upkeep, on top of the
higher ½·m·v² cost of moving faster, for a set number of ticks. A caught fish
is eaten whole: the shark gets all its fat (its energy) and its nutrients. Sharks are bigger than fish and drawn
shark-shaped (seen from above: tapered body, pectoral fins, and a forked
tail that sweeps as they swim). Their colour is genetic too, defaulting to grey-blue.

Baby sharks are born at 15% of their adult size and grow into it while they
aren't hungry, paying fat for each unit of body mass they add. They
can breed once nearly full-grown. Adult size is genetic (*Body size*,
default 6, up to 20). A shark's current mass sets how much fat it burns
moving (½·m·v²) and staying alive, so big sharks cost more to run. Sharks are drawn in proportion to their
current size. Birth size, growth speed and growth cost are settings for each
species; fish are born full-size by default.

Sharks glide. They swim in strokes: a few sweeps of the tail push them a
little faster than they want to go, then the tail goes still and they glide,
slowing gently, until they've dropped a quarter below that speed and take the
next stroke (at roaming speed, roughly a short stroke every 2 s). While
chasing prey, and while boosting, the tail beats without a break. The tail sweeps slowly (about
one full sweep per 0.7 s). Stroke length, tail beat speed, glide slowing
and how far they glide before the next stroke are settings. Sharks turn
gradually (a slow turn rate), keep a steady course while roaming and only
change course now and then. They look ahead for land and turn away before reaching the shore, and
curve toward prey, turning harder only in the last few squares. They're
drawn centred on their position, so they rotate about their middle.
Fish use the same steering with nimble settings, so they stay quick and
twitchy. The turn rate, acceleration, how often and how far they change
course, and how far ahead they look for land are all in Settings for each
species.

### Sheep

Sheep live on land and graze grass. They have the same lifecycle and kind
of genome as fish and sharks (23 genes, each nudging a third of their 16
traits, including *Swimming ability*). They are drawn as rounded squares of fleece, 8 pixels
(2.7 squares) across at the default size, with a black head at the front. Their colour
genome has only a hue: sheep are always pastel shades.

Sheep have solid bodies: they bump into each other rather than overlapping.
Each tick, any two sheep whose bodies overlap are pushed apart, half each (a
push that would shove one into water is skipped). A quadtree
(`src/sim/quadtree.ts`) finds each sheep's neighbours, so big flocks stay
cheap. Two sheep mate once their bodies touch, and a cat catches a sheep when
it reaches the sheep's body.

Sheep also like their space: unless it's looking for a mate, a sheep steers
away from any sheep within 3 squares of touching it (*Personal space*), more
strongly the closer they are (*Keeping apart*), so flocks spread out rather
than huddling.

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

### Cats

Cats hunt sheep on land. They're based on sheep: the same lifecycle,
meandering walk (with its genetic *Meander arc*), turning right round at
water, swimming for the shore when caught in water, and genetic *Swimming
ability*. They are bigger (body size 4 against the sheep's 2) and longer,
drawn as a long rounded body with a round head of the same colour and a
short curly tail (two-thirds of the body length) whose curl drifts slowly and
randomly, and their hue-only colour is always a dark shade.

- **Drawn to herds.** Like sharks sensing fish, every 10 s or so a cat that
  is less than half full and has fewer than 3 sheep within sight looks all
  round, in 32 straight lines across land up to 60 squares (water blocks its
  view), counts the sheep along each, and meanders off toward the biggest
  herd it saw.
- **Stalking.** A hungry cat locks on to the nearest sheep it can see (up
  to 40 squares away) and walks slowly after it at its *Stalking speed*.
- **Pouncing.** Once the sheep is within the cat's genetic *Pounce
  distance* (default 5 squares), the cat pounces: a fast dash (*Pounce
  speed*) in a fixed direction, toward where the sheep was. If it comes
  within a square of the sheep on the way, it catches and eats it (all its
  fat and nutrients). A missed
  pounce ends after the distance to the sheep, and the cat must rest
  (*Rest after pouncing*) before it can pounce again, though it keeps
  stalking. Pouncing costs fat like any movement (½·m·v²), so it's
  expensive.
- Sheep in water are out of a cat's reach, and so are sheep that reach
  water: a cat loses a sheep that isn't on land.

- Cats also pounce on **rocs** that have landed (a roc in the air is out of
  reach).

### Rocs

Rocs are huge birds that eat fish or sheep. They're long-lived (lifespan
40,000 ticks), big (body size 8) and can carry a lot of fat (default 40).
They're drawn from above as tawny birds: wings spread while flying, folded
when landed. Every roc casts a dark, blurry shadow; the higher it flies, the
bigger and fainter its shadow and the further it falls to the bottom left.

- **Flying and landing.** A roc flies anywhere over the map, over land and
  water alike, at its genetic *Flying speed*, cruising 4 height levels above
  the ground (*Flying height*). It climbs after taking off and descends
  before touching down (only over land). It lands only on land, where
  it walks and meanders at its separate genetic *Walking speed*, and burns
  half its upkeep (*Upkeep on the ground*). It never stands in water: if
  it finds itself in water it takes off. Every 5 s (*Ticks between flight
  decisions*) its genetic *Flying preference* (0–1) decides whether it takes
  off (on land) or lands (over land). It also takes off at once to chase a
  fish or to head for a crowd it sensed.
- **Flapping.** Its wings flap (sweeping in and out) only while it turns or
  speeds up; the rest of the time it glides.
- **Keeping off the edges.** Within 20 squares of the edge of the map
  (*Keeps away from the edge*), a flying roc steers back toward the middle,
  more strongly the nearer it gets, so it turns away in an arc (unless it's
  diving at prey).
- **Hunting.** A hungry roc dives at the nearest fish (only while flying) or
  sheep (flying or on foot) within 15 squares, diving at 1.5 times its
  flying speed (*Dive speed*) and dropping lower the closer it gets. It can
  only strike once it's down low, and only about 1 dive in 4 succeeds (*Dive
  success*); after a miss it climbs away and waits 2 s (*Rest after a miss*)
  before picking a new target. Catching a sheep on foot always succeeds. It has a big appetite: it keeps hunting until
  it has built up a big reserve, 65% of its fat store (*Hunts until this
  full*; its genetic hunger threshold applies if higher), and only breeds
  once it's that full.
- **Too fat to fly.** Past 70% of its fat store (*Too fat to fly*) it's too
  heavy to fly: it lands at the first land, stays on the ground and ignores
  fish, only walking after sheep.
- **Drawn to big crowds.** Like sharks and cats it scans far and wide (up to
  200 squares, seeing over everything from the air) and heads for the
  biggest crowd of fish or sheep, but only a very large one (at least 25
  seen; *Least seen worth the trip*).

The default world (seed 1337) keeps fish, sharks, sheep, cats and rocs
going for 15,000 ticks, but in some worlds cats and rocs together hunt the
sheep out.

Fish, sharks, sheep, cats and rocs run on the same code
(`src/sim/critters.ts`). Each species has its own traits, settings
(Settings → *Fish* / *Sharks* / *Sheep* / *Cats* / *Rocs*, and their trait
defaults), diet and habitat.

Nutrients stay conserved: starting fish and sharks gather theirs from
the water and starting sheep, cats and rocs from the ground, and everything a critter eats, sheds or leaves behind is
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
  *Seeds*, *Algae*, *Fish*, *Sharks*, *Sheep* and *Cats*, which drop things at random
  points inside the brush circle. Seeds only take on empty land and algae
  only in empty water, each taking its nutrients from the square it lands on.
  Animals get random genomes. Fish and sharks land only in water, and sheep
  and cats only on land, and they gather their body nutrients from the squares
  around them. Anything that can't be
  supplied is skipped, so nutrients stay conserved. Sprayed seeds and algae
  get the starting genes. The *Destructor* (hold) removes all life under
  the cursor at once: grass, seeds, algae, animals and their bodies, not
  counted as deaths, with their nutrients returned to the square. Keys
  S / R / D / X / G / A / F / K / H / C switch between the tools.
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

## Sound

The **Sound** button next to the speed control (or the M key) switches sound
on and off. It starts off, because browsers only allow audio after a click.
Every sound is synthesised in the browser with the Web Audio API (`src/sound.ts`);
there are no audio files. Sounds are panned left or right by where on the map
they happen.

- **Rain**: a hiss of falling rain with pattering drops, fading in and out
  with the rain (silent while paused).
- **Fish**: a plop when one dies, and a reversed plop when two breed.
- **Sharks**: a chomp when one catches prey, and the two-note *Jaws* theme
  when two breed.
- **Sheep**: a sad, falling baa when one dies (including being eaten), and a
  high baa when two breed.
- **Cats**: a roar when one catches a sheep, and a meow when two breed.

Grass and algae make no sound. In a busy world each sound plays at most every
so often (a plop every 70 ms, the Jaws theme every 6 s), so it doesn't turn
into noise.

Each sound can be switched on or off and has its own volume slider (Tools &
weather → *Sounds*), with a ▶ button to hear it once. By default the rain is
the loudest sound (100%) and the animal calls sit at 38–50%. *Reset sounds*
restores the defaults. These choices are remembered in the browser.

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
- **Richer ground helps plants.** The more nutrients in a plant's soil (or an
  algae cell's water), the better it does, with no upper limit: its upkeep
  and the energy it spends per nutrient when growing are divided by
  `1 + boost × nutrients ÷ reference`, and it grows that many times faster
  (*Nutrient richness boost*, default 1; *Richness reference*, default 0.5).
  So a square with 0.5 nutrients halves the costs and doubles growth, 1.0
  divides them by three, and so on.
- An organism dies when it can't pay its metabolism or reaches its genetic
  lifespan. All the nutrients it holds go back to its square.

## Genes

Each organism carries `growth`, `breed`, `range` (grass), `germ` (grass),
`mutation`, `lifespan`, `water pref` (grass) and `water tol` (grass). Every
gene mutates on every birth: the child's value is the parent's scaled by a
random factor in `[1 − m, 1 + m]`, where `m` is the parent's `mutation` gene
(default 0.15). The mutation gene mutates the same way, so the mutation rate
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
