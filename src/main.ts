import { CELL_PX, GRID_H, GRID_W, PARAMS } from "./sim/config";
import { GENE_COUNT, GENE_NAMES } from "./sim/genes";
import { ALGAE, GRASS, SEED, World, type GroupStats, type RegionStats } from "./sim/world";
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
const selectionEl = $<HTMLDivElement>("selection");

const STATS_EVERY = 20; // frames between stats refreshes
const HISTORY = 320;

let world: World;
let renderer: Renderer;
let running = true;
let frame = 0;
let hover = -1;
/** Selected rectangle in grid squares (inclusive corners), or null. */
let selection: { x0: number; y0: number; x1: number; y1: number } | null = null;
let dragStart: { x: number; y: number } | null = null;
let history: Array<{ grass: number; seeds: number; algae: number }> = [];

function newWorld(seed: number): void {
  world = new World(seed);
  renderer = new Renderer(world);
  seedInput.value = String(seed);
  history = [];
  selection = null;
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
  if (selection) {
    const { x0, y0, x1, y1 } = selection;
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(x0 * CELL_PX, y0 * CELL_PX, (x1 - x0 + 1) * CELL_PX, (y1 - y0 + 1) * CELL_PX);
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x0 * CELL_PX + 0.5, y0 * CELL_PX + 0.5, (x1 - x0 + 1) * CELL_PX - 1, (y1 - y0 + 1) * CELL_PX - 1);
    ctx.setLineDash([]);
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

  const all = world.regionStats(0, 0, GRID_W - 1, GRID_H - 1);
  genesTable.innerHTML = geneRows(all.grass, all.algae);
  refreshSelection();
  drawChart();
}

const ALGAE_UNUSED = new Set([2, 3]); // range and germ only matter for grass

function fmtNum(v: number): string {
  const a = Math.abs(v);
  return a !== 0 && (a < 0.01 || a >= 10000) ? v.toExponential(2) : v.toPrecision(3);
}

function geneCell(g: GroupStats, j: number, spread: boolean): string {
  if (!g.count) return "–";
  const s = g.genes[j];
  let out = `${fmtNum(s.mean)} <span class="muted">±${fmtNum(s.sd)}</span>`;
  if (spread) out += `<br><span class="muted small">${fmtNum(s.min)} – ${fmtNum(s.max)}</span>`;
  return out;
}

/** Gene table rows: mean ± standard deviation (and min–max when `spread`). */
function geneRows(grass: GroupStats, algae: GroupStats, spread = false): string {
  return `<tr><td class="muted">gene</td><td class="muted">grass</td><td class="muted">algae</td></tr>` +
    GENE_NAMES.map((name, j) => {
      const a = ALGAE_UNUSED.has(j) ? "n/a" : geneCell(algae, j, spread);
      return `<tr><td class="muted">${name}</td><td>${geneCell(grass, j, spread)}</td><td>${a}</td></tr>`;
    }).join("");
}

function refreshSelection(): void {
  if (!selection) {
    selectionEl.innerHTML = `<p class="hint">Drag on the map to select an area. Click or press Esc to clear.</p>`;
    return;
  }
  const { x0, y0, x1, y1 } = selection;
  const r: RegionStats = world.regionStats(x0, y0, x1, y1);
  const pct = (n: number) => `${((n / r.squares) * 100).toFixed(0)}%`;
  const group = (label: string, g: GroupStats, maxN: number, ageLabel: string): Array<[string, string]> => {
    if (!g.count) return [[label, "0"]];
    const rows: Array<[string, string]> = [[label, `${g.count} (${pct(g.count)} of squares)`]];
    if (maxN > 0) rows.push(["&nbsp;&nbsp;mean size", `${((g.meanNutrients / maxN) * 100).toFixed(0)}%`]);
    rows.push(["&nbsp;&nbsp;mean energy", g.meanEnergy.toFixed(2)], [`&nbsp;&nbsp;${ageLabel}`, g.meanAge.toFixed(0)]);
    return rows;
  };
  const rows: Array<[string, string]> = [
    ["Area", `${x1 - x0 + 1}×${y1 - y0 + 1} at (${x0},${y0}) · ${r.squares} squares`],
    ["Land / water", `${r.land} / ${r.water}`],
    ["Mean height", r.meanHeight.toFixed(2)],
    ["Mean land saturation", r.land ? `${(r.meanLandMoisture * 100).toFixed(0)}%` : "–"],
    ["Mean square energy", r.meanEnergy.toFixed(2)],
    ["Nutrients: ground", `${r.groundNutrients.toFixed(2)}${r.land ? ` (${(r.groundNutrients / r.land).toFixed(3)}/sq)` : ""}`],
    ["Nutrients: water", `${r.waterNutrients.toFixed(2)}${r.water ? ` (${(r.waterNutrients / r.water).toFixed(3)}/sq)` : ""}`],
    ["Nutrients: in flora", r.floraNutrients.toFixed(2)],
    ...group("Grass", r.grass, PARAMS.grassMaxN, "mean age"),
    ...group("Seeds", r.seeds, 0, "mean ticks to germinate"),
    ...group("Algae", r.algae, PARAMS.algaeMaxN, "mean age"),
  ];
  selectionEl.innerHTML =
    `<table>${rows.map(([k, v]) => `<tr><td class="muted">${k}</td><td>${v}</td></tr>`).join("")}</table>` +
    `<h2>Genes in selection <span class="small">(mean ±sd, min – max)</span></h2>` +
    `<table>${geneRows(r.grass, r.algae, true)}</table>`;
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
function eventCell(e: MouseEvent): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  const x = Math.floor(((e.clientX - r.left) / r.width) * GRID_W);
  const y = Math.floor(((e.clientY - r.top) / r.height) * GRID_H);
  return { x: Math.max(0, Math.min(GRID_W - 1, x)), y: Math.max(0, Math.min(GRID_H - 1, y)) };
}

function setSelection(sel: typeof selection): void {
  selection = sel;
  refreshSelection();
  draw();
}

canvas.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  dragStart = eventCell(e);
});
window.addEventListener("mousemove", (e) => {
  if (!dragStart) return;
  const c = eventCell(e);
  selection = {
    x0: Math.min(dragStart.x, c.x), y0: Math.min(dragStart.y, c.y),
    x1: Math.max(dragStart.x, c.x), y1: Math.max(dragStart.y, c.y),
  };
  draw();
});
window.addEventListener("mouseup", (e) => {
  if (!dragStart) return;
  const c = eventCell(e);
  // A click without a drag clears the selection.
  const clicked = c.x === dragStart.x && c.y === dragStart.y;
  dragStart = null;
  setSelection(clicked ? null : selection);
});
canvas.addEventListener("mousemove", (e) => {
  const { x, y } = eventCell(e);
  hover = y * GRID_W + x;
  showInspect();
});
canvas.addEventListener("mouseleave", () => {
  hover = -1;
  inspectEl.textContent = "Hover the map to inspect a square";
});
window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === "Escape") {
    setSelection(null);
  } else if (e.key === " ") {
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
