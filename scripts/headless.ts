// Runs the simulation without a browser and prints population / nutrient
// stats, for tuning parameters: `npm run sim -- [seed] [ticks] [every]`
import { CELL_COUNT } from "../src/sim/config";
import { ALGAE, GRASS, World } from "../src/sim/world";
import { GENE_NAMES } from "../src/sim/genes";

const seed = Number(process.argv[2] ?? 1337);
const ticks = Number(process.argv[3] ?? 20000);
const every = Number(process.argv[4] ?? 1000);

const t0 = performance.now();
const world = new World(seed);
const t = world.terrain;
let waterCells = 0, wet = 0;
for (let i = 0; i < CELL_COUNT; i++) {
  if (t.water[i]) waterCells++;
  else if (t.moisture[i] > 0) wet++;
}
console.log(`terrain ${(performance.now() - t0).toFixed(0)}ms  water ${(100 * waterCells / CELL_COUNT).toFixed(1)}%  wet land ${(100 * wet / CELL_COUNT).toFixed(1)}%`);
const start = world.stats();
console.log(`nutrients total ${start.nutrientsTotal.toFixed(6)}`);

const fmt = (g: number[] | null) =>
  g ? g.map((v, j) => `${GENE_NAMES[j]}=${v.toPrecision(3)}`).join(" ") : "-";

let t1 = performance.now();
for (let k = 1; k <= ticks; k++) {
  world.step();
  if (k % every === 0) {
    const s = world.stats();
    const ms = (performance.now() - t1) / every;
    t1 = performance.now();
    console.log(
      `t=${s.tick} seeds=${s.seeds} grass=${s.grass} algae=${s.algae} ` +
      `gB/gD=${s.grassBirths}/${s.grassDeaths} aB/aD=${s.algaeBirths}/${s.algaeDeaths} ` +
      `starved=${s.starved} old=${s.oldAge} N[g/w/f]=${s.nutrientsGround.toFixed(0)}/${s.nutrientsWater.toFixed(0)}/${s.nutrientsFlora.toFixed(0)} ` +
      `drift=${(s.nutrientsTotal - start.nutrientsTotal).toExponential(1)} ${ms.toFixed(2)}ms/tick`,
    );
  }
}
console.log("grass genes:", fmt(world.meanGenes(GRASS)));
console.log("algae genes:", fmt(world.meanGenes(ALGAE)));
