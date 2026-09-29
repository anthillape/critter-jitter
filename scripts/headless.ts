// Runs the simulation without a browser and prints population / nutrient
// stats, for tuning parameters: `npm run sim -- [seed] [ticks] [every]`
import { applyWorldSize, CELL_COUNT, GRID_H, GRID_W, PARAMS, WORLD_SIZE } from "../src/sim/config";
import { World, type GroupStats } from "../src/sim/world";
import { GENE_NAMES } from "../src/sim/genes";

const seed = Number(process.argv[2] ?? 1337);
const ticks = Number(process.argv[3] ?? 20000);
const every = Number(process.argv[4] ?? 1000);

// Optional size: npm run sim -- seed ticks every width height
if (process.argv[5]) WORLD_SIZE.width = Number(process.argv[5]);
if (process.argv[6]) WORLD_SIZE.height = Number(process.argv[6]);
applyWorldSize();
// Optional overrides, e.g. SIM_PARAMS='{"initialFish":0}'
if (process.env.SIM_PARAMS) Object.assign(PARAMS, JSON.parse(process.env.SIM_PARAMS));
const t0 = performance.now();
const world = new World(seed);
let waterCells = 0;
for (let i = 0; i < CELL_COUNT; i++) if (world.water.isWater(i)) waterCells++;
console.log(`init ${(performance.now() - t0).toFixed(0)}ms  water ${(100 * waterCells / CELL_COUNT).toFixed(1)}%  total water ${world.water.total.toFixed(0)}`);
const start = world.stats();
console.log(`nutrients total ${start.nutrientsTotal.toFixed(6)}`);

const fmt = (g: GroupStats) =>
  g.count ? g.genes.map((v, j) => `${GENE_NAMES[j]}=${v.mean.toPrecision(3)}±${v.sd.toPrecision(2)}`).join(" ") : "-";

let t1 = performance.now();
for (let k = 1; k <= ticks; k++) {
  world.step();
  if (k % every === 0) {
    const s = world.stats();
    const ms = (performance.now() - t1) / every;
    t1 = performance.now();
    console.log(
      `t=${s.tick} seeds=${s.seeds} grass=${s.grass} algae=${s.algae} ` +
      `\n    fish=${s.fish.alive} (b/d ${s.fish.births}/${s.fish.deaths}, starved ${s.fish.starved}, old ${s.fish.oldAge}, eaten ${s.fish.eaten}) ` +
      `algae=${s.algae} sharks=${s.sharks.alive} (b/d ${s.sharks.births}/${s.sharks.deaths}, starved ${s.sharks.starved}, old ${s.sharks.oldAge}) ` +
      `sheep=${s.sheep.alive} (b/d ${s.sheep.births}/${s.sheep.deaths}, starved ${s.sheep.starved}, old ${s.sheep.oldAge})\n    ` +
      `gB/gD=${s.grassBirths}/${s.grassDeaths} aB/aD=${s.algaeBirths}/${s.algaeDeaths} ` +
      `starved=${s.starved} old=${s.oldAge} N[g/w/f]=${s.nutrientsGround.toFixed(0)}/${s.nutrientsWater.toFixed(0)}/${s.nutrientsFlora.toFixed(0)} ` +
      `drift=${(s.nutrientsTotal - start.nutrientsTotal).toExponential(1)} lost=${s.habitatLost}\n    ` +
      `water sq=${s.waterSquares} surf/soil/cloud=${s.waterSurface.toFixed(0)}/${s.waterSoil.toFixed(0)}/${s.waterCloud.toFixed(0)} ` +
      `(${(100 * s.waterCloud / s.waterTotal).toFixed(1)}% cloud${s.raining ? ", RAIN" : ""}) wdrift=${(s.waterTotal - world.water.total).toExponential(1)} ` +
      `${ms.toFixed(2)}ms/tick`,
    );
  }
}
const all = world.regionStats(0, 0, GRID_W - 1, GRID_H - 1);
console.log("grass genes:", fmt(all.grass));
console.log("algae genes:", fmt(all.algae));
