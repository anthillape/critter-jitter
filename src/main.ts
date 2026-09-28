import { CELL_PX, GRID_H, GRID_W, PARAMS } from "./sim/config";
import { GENE_COUNT, GENE_NAMES } from "./sim/genes";
import { ALGAE, GRASS, SEED, World } from "./sim/world";
import { Renderer, type View } from "./render";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>("world");
const ctx = canvas.getContext("2d")!;
ctx.imageSmoothingEnabled = false;
const chart = $<HTMLCanvasElement>("chart");
const chartCtx = chart.getContext("2d")!;
const playBtn = $<HTMLButtonElement>("play");
const speedSel = $<HTMLSelectElement>("speed");
const viewSel = $<HTMLSelectElement>("view");
const seedInput = $<HTMLInputElement>("seed");
const statsTable = $<HTMLTableElement>("stats");
const genesTable = $<HTMLTableElement>("genes");
const inspectEl = $<HTMLDivElement>("inspect");

const STATS_EVERY = 20; // frames between stats refreshes
const HISTORY = 320;

let world: World;
let renderer: Renderer;
let running = true;
let frame = 0;
let hover = -1;
let history: Array<{ grass: number; seeds: number; algae: number }> = [];

function newWorld(seed: number): void {
  world = new World(seed);
  renderer = new Renderer(world);
  seedInput.value = String(seed);
  history = [];
  draw();
  refreshStats();
}

function draw(): void {
  renderer.draw(viewSel.value as View);
  ctx.drawImage(renderer.canvas, 0, 0, GRID_W * CELL_PX, GRID_H * CELL_PX);
  if (hover >= 0) {
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    const x = (hover % GRID_W) * CELL_PX;
    const y = Math.floor(hover / GRID_W) * CELL_PX;
    ctx.strokeRect(x - 2.5, y - 2.5, CELL_PX + 5, CELL_PX + 5);
  }
}

function loop(): void {
  if (running) {
    // Run up to `speed` ticks, but keep frames responsive on slow machines.
    const speed = Number(speedSel.value);
    const start = performance.now();
    for (let k = 0; k < speed; k++) {
      world.step();
      if (performance.now() - start > 30) break;
    }
  }
  draw();
  if (++frame % STATS_EVERY === 0) refreshStats();
  if (hover >= 0) showInspect();
  requestAnimationFrame(loop);
}

function refreshStats(): void {
  const s = world.stats();
  history.push({ grass: s.grass, seeds: s.seeds, algae: s.algae });
  if (history.length > HISTORY) history.shift();

  const rows: Array<[string, string]> = [
    ["Tick", s.tick.toLocaleString()],
    ["Grass", s.grass.toLocaleString()],
    ["Seeds waiting", s.seeds.toLocaleString()],
    ["Algae", s.algae.toLocaleString()],
    ["Births / deaths (last 20 frames)", `${s.grassBirths + s.algaeBirths} / ${s.grassDeaths + s.algaeDeaths}`],
    ["Deaths: starved / old age (same)", `${s.starved} / ${s.oldAge}`],
    ["Nutrients: ground", s.nutrientsGround.toFixed(1)],
    ["Nutrients: water", s.nutrientsWater.toFixed(1)],
    ["Nutrients: in flora", s.nutrientsFlora.toFixed(1)],
    ["Nutrients: total (conserved)", s.nutrientsTotal.toFixed(3)],
  ];
  statsTable.innerHTML = rows.map(([k, v]) => `<tr><td class="muted">${k}</td><td>${v}</td></tr>`).join("");

  const grass = world.meanGenes(GRASS);
  const algae = world.meanGenes(ALGAE);
  const fmt = (g: number[] | null, j: number) => (g ? g[j].toPrecision(3) : "–");
  genesTable.innerHTML =
    `<tr><td class="muted">gene</td><td class="muted">grass</td><td class="muted">algae</td></tr>` +
    GENE_NAMES.map((name, j) => {
      const algaeCell = j === 2 || j === 3 ? "n/a" : fmt(algae, j);
      return `<tr><td class="muted">${name}</td><td>${fmt(grass, j)}</td><td>${algaeCell}</td></tr>`;
    }).join("");
  drawChart();
}

function drawChart(): void {
  const w = chart.width;
  const h = chart.height;
  chartCtx.clearRect(0, 0, w, h);
  if (history.length < 2) return;
  let max = 1;
  for (const p of history) max = Math.max(max, p.grass, p.seeds, p.algae);
  const series: Array<[keyof (typeof history)[number], string]> = [
    ["grass", "#6fbf3a"],
    ["seeds", "#e3cf7a"],
    ["algae", "#3fa7a0"],
  ];
  for (const [key, color] of series) {
    chartCtx.strokeStyle = color;
    chartCtx.lineWidth = 1.5;
    chartCtx.beginPath();
    history.forEach((p, i) => {
      const x = (i / (HISTORY - 1)) * w;
      const y = h - 4 - (p[key] / max) * (h - 8);
      if (i === 0) chartCtx.moveTo(x, y);
      else chartCtx.lineTo(x, y);
    });
    chartCtx.stroke();
  }
}

function showInspect(): void {
  const i = hover;
  const t = world.terrain;
  const x = i % GRID_W;
  const y = Math.floor(i / GRID_W);
  let line1 = `(${x},${y}) height ${t.height[i]}`;
  line1 += t.water[i] ? ` · water depth ${t.depth[i]}` : ` · saturation ${(t.moisture[i] * 100).toFixed(0)}%`;
  line1 += ` · nutrients ${world.nutrients[i].toFixed(3)} · energy ${world.energy[i].toFixed(2)}`;
  const k = world.kind[i];
  let line2 = "";
  if (k !== 0) {
    const name = k === GRASS ? "grass" : k === SEED ? "seed" : "algae";
    const maxN = k === ALGAE ? PARAMS.algaeMaxN : PARAMS.grassMaxN;
    const g = world.genes.subarray(i * GENE_COUNT, (i + 1) * GENE_COUNT);
    line2 = `${name}: `;
    line2 += k === SEED
      ? `germinates in ${world.age[i]} ticks`
      : `age ${world.age[i]} · size ${((world.floraN[i] / maxN) * 100).toFixed(0)}% · energy ${world.floraE[i].toFixed(2)}`;
    line2 += ` · genes ` + GENE_NAMES.map((n, j) => `${n} ${g[j].toPrecision(3)}`).join(", ");
  }
  inspectEl.textContent = line1 + (line2 ? "\n" + line2 : "");
}

function setRunning(r: boolean): void {
  running = r;
  playBtn.textContent = r ? "Pause" : "Play";
}

playBtn.addEventListener("click", () => setRunning(!running));
$<HTMLButtonElement>("step").addEventListener("click", () => {
  setRunning(false);
  world.step();
  refreshStats();
});
$<HTMLButtonElement>("regen").addEventListener("click", () => {
  const typed = Number(seedInput.value);
  const seed = Number.isFinite(typed) && typed !== world.terrain.seed ? typed : Math.floor(Math.random() * 1e6);
  newWorld(seed);
});
viewSel.addEventListener("change", draw);
canvas.addEventListener("mousemove", (e) => {
  const r = canvas.getBoundingClientRect();
  const x = Math.floor(((e.clientX - r.left) / r.width) * GRID_W);
  const y = Math.floor(((e.clientY - r.top) / r.height) * GRID_H);
  hover = x >= 0 && y >= 0 && x < GRID_W && y < GRID_H ? y * GRID_W + x : -1;
  if (hover >= 0) showInspect();
});
canvas.addEventListener("mouseleave", () => {
  hover = -1;
  inspectEl.textContent = "Hover the map to inspect a square";
});
window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === " ") {
    e.preventDefault();
    setRunning(!running);
  } else if (e.key === ".") {
    setRunning(false);
    world.step();
    refreshStats();
  } else if (e.key >= "1" && e.key <= "5") {
    viewSel.selectedIndex = Number(e.key) - 1;
    draw();
  }
});

newWorld(1337);
requestAnimationFrame(loop);
