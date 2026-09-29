import { CELL_PX, GRID_H, GRID_W, PARAMS, TICKS_PER_SECOND } from "./sim/config";
import { ALGAE_UNUSED_GENES, GENE_COUNT, GENE_NAMES } from "./sim/genes";
import { ALGAE, GRASS, SEED, World, type GroupStats, type RegionStats } from "./sim/world";
import { Renderer, type View } from "./render";
import { formatSetting, fromSlider, SETTINGS, SLIDER_STEPS, toSlider } from "./settings";

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
const statsLife = $<HTMLTableElement>("statsLife");
const statsWorld = $<HTMLTableElement>("statsWorld");
const statsWater = $<HTMLTableElement>("statsWater");
const statsNutrients = $<HTMLTableElement>("statsNutrients");
const genesTable = $<HTMLTableElement>("genes");
const inspectEl = $<HTMLDivElement>("inspect");
const selectionEl = $<HTMLDivElement>("selection");
const rateInput = $<HTMLInputElement>("rate");
const sizeInput = $<HTMLInputElement>("size");
const rateVal = $<HTMLSpanElement>("rateVal");
const sizeVal = $<HTMLSpanElement>("sizeVal");
const brushEl = $<HTMLDivElement>("brush");
const manualRainBox = $<HTMLInputElement>("manualRain");

const rainToggle = $<HTMLButtonElement>("rainToggle");
const toolButtons = Array.from(document.querySelectorAll<HTMLButtonElement>(".tool"));

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

type Tool = "select" | "rain" | "dryer";
let tool: Tool = "select";
/** Mouse position over the map in (fractional) grid squares, or null. */
let mouse: { x: number; y: number } | null = null;
/** True while the mouse button is held with the rain or dryer tool. */
let painting = false;

/** Brush rate slider (0..100) -> water per square per tick at the centre, log scale. */
function brushRate(): number {
  return 1e-4 * 10 ** (Number(rateInput.value) / 40);
}

function brushSize(): number {
  return Number(sizeInput.value);
}

/** Applies the rain / dryer brush for `ticks` ticks' worth of time. */
function applyBrush(ticks: number): void {
  if (!painting || !mouse || tool === "select") return;
  const amount = brushRate() * ticks;
  if (tool === "rain") world.water.addWater(mouse.x, mouse.y, brushSize(), amount);
  else world.water.removeWater(mouse.x, mouse.y, brushSize(), amount);
}

function setTool(t: Tool): void {
  tool = t;
  painting = false;
  dragStart = null;
  for (const b of toolButtons) b.setAttribute("aria-pressed", String(b.dataset.tool === t));
  brushEl.classList.toggle("disabled", t === "select");
  rateInput.disabled = sizeInput.disabled = t === "select";
  draw();
}

function refreshBrushLabels(): void {
  rateVal.textContent = `${(brushRate() * TICKS_PER_SECOND).toFixed(3)}/s`;
  sizeVal.textContent = `${brushSize()} sq`;
}
/**
 * Settings panel: one slider per simulation variable, grouped into
 * collapsible sections, built from the table in settings.ts.
 */
function buildSettings(): () => void {
  const root = $<HTMLDivElement>("settings");
  const refreshers: Array<() => void> = [];
  const groups = new Map<string, HTMLElement>();
  for (const s of SETTINGS) {
    let body = groups.get(s.group);
    if (!body) {
      const details = document.createElement("details");
      details.className = "settings-group";
      const summary = document.createElement("summary");
      summary.textContent = s.group;
      if (s.group.startsWith("New world")) {
        summary.title = "These only take effect when you press Restart or New world.";
      }
      details.append(summary);
      body = document.createElement("div");
      details.append(body);
      root.append(details);
      groups.set(s.group, body);
    }
    const row = document.createElement("label");
    row.className = "setting";
    const tip = s.tip + (s.newWorld ? " Takes effect when you press Restart or New world." : "");
    row.title = tip;
    const name = document.createElement("span");
    name.className = "setting-name";
    name.textContent = s.label;
    const input = document.createElement("input");
    input.type = "range";
    input.min = "0";
    input.max = String(SLIDER_STEPS);
    input.setAttribute("aria-label", s.label);
    const value = document.createElement("span");
    value.className = "setting-value";
    const refresh = () => {
      const v = s.get();
      input.value = String(toSlider(s, v));
      value.textContent = formatSetting(s, v);
      row.classList.toggle("changed", Math.abs(v - (s.defaultValue ?? v)) > 1e-12 * Math.max(1, Math.abs(v)));
    };
    input.addEventListener("input", () => {
      s.set(fromSlider(s, Number(input.value)));
      value.textContent = formatSetting(s, s.get());
      row.classList.toggle("changed", Math.abs(s.get() - (s.defaultValue ?? 0)) > 1e-12 * Math.max(1, Math.abs(s.get())));
    });
    row.append(name, input, value);
    body.append(row);
    refreshers.push(refresh);
    refresh();
  }
  return () => refreshers.forEach((r) => r());
}

function applyWeatherSettings(): void {
  world.water.manual = manualRainBox.checked;
  world.water.manualRain = false;
  rainToggle.disabled = !manualRainBox.checked;
  rainToggle.textContent = "Start rain";
}

function newWorld(seed: number): void {
  world = new World(seed);
  renderer = new Renderer(world);
  seedInput.value = String(seed);
  history = [];
  selection = null;
  applyWeatherSettings();
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
  if (mouse && tool !== "select") {
    // Brush outline: blue for rain, orange for the dryer.
    ctx.strokeStyle = tool === "rain" ? "rgba(120,180,255,0.9)" : "rgba(255,170,80,0.9)";
    ctx.lineWidth = painting ? 2 : 1;
    ctx.setLineDash(painting ? [] : [5, 4]);
    ctx.beginPath();
    ctx.arc((mouse.x + 0.5) * CELL_PX, (mouse.y + 0.5) * CELL_PX, brushSize() * CELL_PX, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 1;
  }
}

const FRAME_BUDGET_MS = 35; // max time spent simulating per frame

// Real-time clock: ticks are owed at TICKS_PER_SECOND x speed per second of
// wall time, however fast the machine is. If it can't keep up, the owed
// ticks are dropped (the world runs slower) and the panel says so.
let lastFrame = performance.now();
let owed = 0;
let rateWindow = { start: performance.now(), ticks: 0, behind: false };
let measuredRate = 0;
let fallingBehind = false;

function loop(now: number): void {
  const dt = Math.min(0.25, (now - lastFrame) / 1000); // cap after tab switches
  lastFrame = now;
  if (running) {
    const target = TICKS_PER_SECOND * Number(speedSel.value);
    owed += dt * target;
    const start = performance.now();
    while (owed >= 1) {
      applyBrush(1);
      world.step();
      owed--;
      rateWindow.ticks++;
      if (performance.now() - start > FRAME_BUDGET_MS) {
        rateWindow.behind = true;
        owed = Math.min(owed, 1); // drop the backlog rather than spiral
        break;
      }
    }
  } else {
    owed = 0;
    // Tools still work while paused, at the 1x game rate.
    applyBrush(dt * TICKS_PER_SECOND);
  }
  draw();
  if (++frame % STATS_EVERY === 0) {
    const elapsed = (performance.now() - rateWindow.start) / 1000;
    measuredRate = running ? rateWindow.ticks / elapsed : 0;
    fallingBehind = running && rateWindow.behind;
    rateWindow = { start: performance.now(), ticks: 0, behind: false };
    refreshStats();
  }
  if (hover >= 0) showInspect();
  requestAnimationFrame(loop);
}

function formatGameTime(tick: number): string {
  const secs = Math.floor(tick / TICKS_PER_SECOND);
  const m = Math.floor(secs / 60);
  return `${m}:${String(secs % 60).padStart(2, "0")}`;
}

function refreshStats(): void {
  const s = world.stats();
  history.push({ grass: s.grass, seeds: s.seeds, algae: s.algae });
  if (history.length > HISTORY) history.shift();

  const table = (rows: Array<[string, string]>) =>
    rows.map(([k, v]) => `<tr><td class="muted">${k}</td><td>${v}</td></tr>`).join("");
  statsLife.innerHTML = table([
    ["Grass", s.grass.toLocaleString()],
    ["Seeds waiting", s.seeds.toLocaleString()],
    ["Algae", s.algae.toLocaleString()],
    ["Births / deaths (last 20 frames)", `${s.grassBirths + s.algaeBirths} / ${s.grassDeaths + s.algaeDeaths}`],
    ["Deaths: starved / old age / drowned or stranded", `${s.starved} / ${s.oldAge} / ${s.habitatLost}`],
  ]);
  statsWorld.innerHTML = table([
    ["Game time", `${formatGameTime(s.tick)} (tick ${s.tick.toLocaleString()})`],
    ["Speed", running
      ? `${(measuredRate / TICKS_PER_SECOND).toFixed(1)}× of ${speedSel.value}×${fallingBehind ? " · can't keep up" : ""}`
      : "paused"],
    ["Wind", windText()],
  ]);
  statsWater.innerHTML = table([
    ["Lakes & puddles", `${s.waterSurface.toFixed(0)} (${s.waterSquares.toLocaleString()} squares)`],
    ["In soil", s.waterSoil.toFixed(0)],
    ["In clouds", `${s.waterCloud.toFixed(0)} (${((100 * s.waterCloud) / s.waterTotal).toFixed(1)}%)${s.raining ? " · raining" : ""}${world.water.manual ? " · manual" : ""}`],
    ["Total (conserved; tools add / remove)", s.waterTotal.toFixed(3)],
  ]);
  statsNutrients.innerHTML = table([
    ["In the ground", s.nutrientsGround.toFixed(1)],
    ["In the water", s.nutrientsWater.toFixed(1)],
    ["In grass & algae", s.nutrientsFlora.toFixed(1)],
    ["Total (conserved)", s.nutrientsTotal.toFixed(3)],
  ]);

  const all = world.regionStats(0, 0, GRID_W - 1, GRID_H - 1);
  genesTable.innerHTML = geneRows(all.grass, all.algae);
  refreshSelection();
  drawChart();
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

function windText(): string {
  const w = world.wind;
  const from = w.fromBearing;
  const name = COMPASS[Math.round(from / 45) % 8];
  // Arrow points the way the wind is blowing.
  const arrow = `<span class="arrow" style="transform: rotate(${w.angle}rad)">→</span>`;
  return `${arrow} from ${name} (${from.toFixed(0)}°) · ${(w.speed / PARAMS.windSpeed).toFixed(2)}× mean speed`;
}

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
      const a = ALGAE_UNUSED_GENES.has(j) ? "n/a" : geneCell(algae, j, spread);
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
    ["Mean water depth", r.water ? r.meanWaterDepth.toFixed(2) : "–"],
    ["Water (surface + soil)", r.waterVolume.toFixed(1)],
    ["Mean cloud cover", `${(r.meanCloud * 100).toFixed(0)}%`],
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
  const wtr = world.water;
  line1 += wtr.isWater(i)
    ? ` · water depth ${wtr.surface[i].toFixed(2)}`
    : ` · saturation ${(wtr.saturation(i) * 100).toFixed(0)}%` + (wtr.surface[i] > 0.005 ? ` · puddle ${wtr.surface[i].toFixed(2)}` : "");
  line1 += ` · cloud ${(wtr.cloudAt(x, y) * 100).toFixed(0)}%`;
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
$<HTMLButtonElement>("restart").addEventListener("click", () => newWorld(world.terrain.seed));
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
  if (tool === "select") dragStart = eventCell(e);
  else painting = true;
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
  painting = false;
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
  const r = canvas.getBoundingClientRect();
  mouse = { x: ((e.clientX - r.left) / r.width) * GRID_W - 0.5, y: ((e.clientY - r.top) / r.height) * GRID_H - 0.5 };
  showInspect();
});
canvas.addEventListener("mouseleave", () => {
  hover = -1;
  mouse = null;
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
  } else if (e.key === "s" || e.key === "r" || e.key === "d") {
    setTool(e.key === "s" ? "select" : e.key === "r" ? "rain" : "dryer");
  } else if (e.key >= "1" && e.key <= "6") {
    viewSel.selectedIndex = Number(e.key) - 1;
    draw();
  }
});

for (const b of toolButtons) b.addEventListener("click", () => setTool(b.dataset.tool as Tool));
rateInput.addEventListener("input", refreshBrushLabels);
sizeInput.addEventListener("input", () => {
  refreshBrushLabels();
  draw();
});
manualRainBox.addEventListener("change", applyWeatherSettings);
rainToggle.addEventListener("click", () => {
  world.water.manualRain = !world.water.manualRain;
  rainToggle.textContent = world.water.manualRain ? "Stop rain" : "Start rain";
});

// Sidebar tabs (the chosen tab is remembered in this browser).
const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
function selectTab(tab: HTMLButtonElement): void {
  for (const t of tabs) {
    const selected = t === tab;
    t.setAttribute("aria-selected", String(selected));
    $<HTMLElement>(t.getAttribute("aria-controls")!).hidden = !selected;
  }
  try {
    localStorage.setItem("critter-jitter-tab", tab.id);
  } catch {
    // storage unavailable: just don't remember
  }
}
for (const t of tabs) t.addEventListener("click", () => selectTab(t));
try {
  const saved = localStorage.getItem("critter-jitter-tab");
  const t = tabs.find((x) => x.id === saved);
  if (t) selectTab(t);
} catch {
  // storage unavailable
}

const refreshSettings = buildSettings();
$<HTMLButtonElement>("resetSettings").addEventListener("click", () => {
  for (const s of SETTINGS) if (s.defaultValue !== undefined) s.set(s.defaultValue);
  refreshSettings();
});

refreshBrushLabels();
newWorld(1337);
setTool("select");
requestAnimationFrame((t) => {
  lastFrame = t;
  requestAnimationFrame(loop);
});
