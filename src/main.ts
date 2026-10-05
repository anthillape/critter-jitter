import { applyWorldSize, CELL_PX, GRID_H, GRID_W, PARAMS, STARTER_POPULATION, TICKS_PER_SECOND } from "./sim/config";
import { ALGAE_UNUSED_GENES, GENE_COUNT, GENE_NAMES } from "./sim/genes";
import { ALGAE, GRASS, SEED, World, type GroupStats, type RegionStats } from "./sim/world";
import { Renderer, type View } from "./render";
import { formatSetting, fromSlider, SETTINGS, setCritterTraitsHook, SLIDER_STEPS, toSlider, type Setting } from "./settings";
import { bodyMass, sheepSide, CritterSystem, Mode, MODE_NAMES, T_LITTER, type Corpse, type Critter } from "./sim/critters";
import type { CritterCounts } from "./sim/world";
import { Sound, SOUNDS, type SoundName } from "./sound";
import { setupCards } from "./cards";
import type { Chooser, Gardener } from "./sim/gardener";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>("world");
const mapFrame = $<HTMLDivElement>("mapFrame");

/**
 * Fits the map canvas into its frame: the largest size with the map's
 * shape (same squares and pixels, only the display size changes), so
 * mouse positions still map straight onto squares.
 */
function fitMap(): void {
  const aspect = GRID_W / GRID_H;
  const fw = mapFrame.clientWidth - 2; // the canvas's 1px border
  const fh = mapFrame.clientHeight - 2;
  if (fw <= 0 || fh <= 0) return;
  const w = Math.min(fw, fh * aspect);
  canvas.style.width = `${Math.floor(w)}px`;
  canvas.style.height = `${Math.floor(w / aspect)}px`;
}

// Dragging the frame's corner sets an inline size: remember it. Double-
// clicking the corner goes back to automatic sizing.
const MAP_SIZE_KEY = "critterJitter.mapSize";
try {
  const saved = JSON.parse(localStorage.getItem(MAP_SIZE_KEY) ?? "null");
  if (saved && saved.w > 0 && saved.h > 0) {
    mapFrame.style.width = `${saved.w}px`;
    mapFrame.style.height = `${saved.h}px`;
  }
} catch {
  // Storage unavailable: automatic sizing.
}
new ResizeObserver(() => {
  fitMap();
  if (mapFrame.style.width && mapFrame.style.height) {
    try {
      localStorage.setItem(MAP_SIZE_KEY, JSON.stringify({ w: mapFrame.offsetWidth, h: mapFrame.offsetHeight }));
    } catch {
      // Storage unavailable: it just won't be remembered.
    }
  }
}).observe(mapFrame);
mapFrame.addEventListener("dblclick", (e) => {
  const r = mapFrame.getBoundingClientRect();
  if (r.right - e.clientX > 18 || r.bottom - e.clientY > 18) return; // only on the corner grip
  mapFrame.style.width = "";
  mapFrame.style.height = "";
  try {
    localStorage.removeItem(MAP_SIZE_KEY);
  } catch {
    // Nothing to forget.
  }
});
const ctx = canvas.getContext("2d")!;
ctx.imageSmoothingEnabled = false;
const chart = $<HTMLCanvasElement>("chart");
const chartCtx = chart.getContext("2d")!;
const waterChart = $<HTMLCanvasElement>("waterChart");
const waterChartCtx = waterChart.getContext("2d")!;
const fishChart = $<HTMLCanvasElement>("fishChart");
const fishChartCtx = fishChart.getContext("2d")!;
const statsFish = $<HTMLTableElement>("statsFish");
const fishTraits = $<HTMLTableElement>("fishTraits");
const sharkChart = $<HTMLCanvasElement>("sharkChart");
const sharkChartCtx = sharkChart.getContext("2d")!;
const statsSharks = $<HTMLTableElement>("statsSharks");
const sharkTraits = $<HTMLTableElement>("sharkTraits");
const sheepChart = $<HTMLCanvasElement>("sheepChart");
const sheepChartCtx = sheepChart.getContext("2d")!;
const statsSheep = $<HTMLTableElement>("statsSheep");
const sheepTraits = $<HTMLTableElement>("sheepTraits");
const catChart = $<HTMLCanvasElement>("catChart");
const catChartCtx = catChart.getContext("2d")!;
const statsCats = $<HTMLTableElement>("statsCats");
const catTraits = $<HTMLTableElement>("catTraits");
const rocChart = $<HTMLCanvasElement>("rocChart");
const rocChartCtx = rocChart.getContext("2d")!;
const statsRocs = $<HTMLTableElement>("statsRocs");
const rocTraits = $<HTMLTableElement>("rocTraits");
const statsGardener = $<HTMLTableElement>("statsGardener");
const gardenerThoughts = $<HTMLUListElement>("gardenerThoughts");
const gardenerTabs = $<HTMLDivElement>("gardenerTabs");
const gardenerView = $<HTMLUListElement>("gardenerView");
const gardenerPlaces = $<HTMLUListElement>("gardenerPlaces");
const brainSel = $<HTMLSelectElement>("brain");
const brainStatus = $<HTMLParagraphElement>("brainStatus");
const playBtn = $<HTMLButtonElement>("play");
const speedSel = $<HTMLSelectElement>("speed");
const viewSel = $<HTMLSelectElement>("view");
const seedInput = $<HTMLInputElement>("seed");
const statsLife = $<HTMLTableElement>("statsLife");
const statsWorld = $<HTMLTableElement>("statsWorld");
const statsWater = $<HTMLTableElement>("statsWater");
const speedStatus = $<HTMLSpanElement>("speedStatus");
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
const wildGenesBox = $<HTMLInputElement>("wildGenes");

const rainToggle = $<HTMLButtonElement>("rainToggle");
const toolButtons = Array.from(document.querySelectorAll<HTMLButtonElement>(".tool"));

const STATS_EVERY = 20; // frames between stats refreshes
const HISTORY = 320;

let world: World;
let renderer: Renderer;
let running = false;
/** False while setting up on the Start tab (the map is just a preview). */
let started = false;
let frame = 0;
let hover = -1;
/** Selected rectangle in grid squares (inclusive corners), or null. */
let selection: { x0: number; y0: number; x1: number; y1: number } | null = null;
let dragStart: { x: number; y: number } | null = null;
interface Sample {
  grass: number;
  seeds: number;
  algae: number;
  cloud: number;
  surface: number;
  soil: number;
  fish: number;
  sharks: number;
  sheep: number;
  cats: number;
  rocs: number;
  /** It rained at some point since the previous sample. */
  rained: boolean;
  /** Nutrients and energy held by each holder (see FLOW_SERIES), for the distribution charts. */
  nutrients: Record<string, number>;
  energy: Record<string, number>;
}
type NumericKey = { [K in keyof Sample]: Sample[K] extends number ? K : never }[keyof Sample];

/**
 * Holders for the nutrient and energy charts. The seven living holders use
 * the categorical palette in its validated slot order (blue, orange, aqua,
 * yellow, magenta, green, violet; checked for colour-blind separation on
 * the chart background), each given to the species it suits. The
 * environment's lines are neutral and dashed, so they never compete with a
 * species colour.
 */
interface FlowSeries {
  key: string;
  label: string;
  colour: string;
  dash?: number[];
}
const LIFE_SERIES: FlowSeries[] = [
  { key: "fish", label: "Fish", colour: "#3987e5" },
  { key: "cats", label: "Cats", colour: "#d95926" },
  { key: "algae", label: "Algae", colour: "#199e70" },
  { key: "sheep", label: "Sheep", colour: "#c98500" },
  { key: "rocs", label: "Rocs", colour: "#d55181" },
  { key: "grass", label: "Grass", colour: "#008300" },
  { key: "sharks", label: "Sharks", colour: "#9085e9" },
];
const NUTRIENT_SERIES: FlowSeries[] = [
  { key: "ground", label: "Ground", colour: "#a39683", dash: [5, 3] },
  { key: "water", label: "Water", colour: "#d8d0c2", dash: [2, 3] },
  ...LIFE_SERIES,
];
const ENERGY_SERIES: FlowSeries[] = LIFE_SERIES;
let history: Sample[] = [];
/** Set whenever a tick rains; cleared each time a sample is taken. */
let rainedSinceSample = false;

type Tool = "select" | "rain" | "dryer" | "seeds" | "algae" | "fish" | "sharks" | "sheep" | "cats" | "rocs" | "gardener" | "destroy";
const TOOL_KEYS: Record<string, Tool> = { s: "select", r: "rain", d: "dryer", g: "seeds", a: "algae", f: "fish", k: "sharks", h: "sheep", c: "cats", b: "rocs", p: "gardener", x: "destroy" };
const SPRAY_TOOLS: ReadonlySet<Tool> = new Set(["seeds", "algae", "fish", "sharks", "sheep", "cats", "rocs"]);
const BRUSH_COLOURS: Record<Exclude<Tool, "select">, string> = {
  rain: "rgba(120,180,255,0.9)",
  dryer: "rgba(255,170,80,0.9)",
  seeds: "rgba(235,215,110,0.9)",
  algae: "rgba(90,210,190,0.9)",
  fish: "rgba(240,130,100,0.9)",
  sharks: "rgba(170,190,215,0.9)",
  sheep: "rgba(245,240,230,0.9)",
  cats: "rgba(200,150,110,0.9)",
  rocs: "rgba(210,170,100,0.9)",
  gardener: "rgba(224,72,58,0.95)",
  destroy: "rgba(255,80,70,0.95)",
};
/** Fractional sprays owed but not yet placed (so low rates still spray). */
let sprayOwed = 0;
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

/** Spray tools: rate slider (0..100) -> particles per second over the whole brush, log scale. */
function sprayPerSecond(): number {
  return 2 * 10 ** (Number(rateInput.value) / 40);
}

/** Applies the current brush for `ticks` ticks' worth of time. */
function applyBrush(ticks: number): void {
  if (!painting || !mouse || tool === "select" || tool === "gardener") return;
  if (tool === "destroy") {
    world.destroyLife(mouse.x, mouse.y, brushSize());
    return;
  }
  if (tool === "rain" || tool === "dryer") {
    const amount = brushRate() * ticks;
    if (tool === "rain") world.water.addWater(mouse.x, mouse.y, brushSize(), amount);
    else world.water.removeWater(mouse.x, mouse.y, brushSize(), amount);
    return;
  }
  // Spray: particles land at random points spread evenly over the circle.
  sprayOwed += (sprayPerSecond() / TICKS_PER_SECOND) * ticks;
  const r = brushSize();
  for (; sprayOwed >= 1; sprayOwed--) {
    const angle = Math.random() * Math.PI * 2;
    const dist = r * Math.sqrt(Math.random());
    const x = Math.round(mouse.x + Math.cos(angle) * dist);
    const y = Math.round(mouse.y + Math.sin(angle) * dist);
    if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) continue;
    const i = y * GRID_W + x;
    const wild = wildGenesBox.checked;
    if (tool === "seeds") world.addSeed(i, world.rng, wild);
    else if (tool === "algae") world.addAlgae(i, wild);
    else if (tool === "fish") world.fish.spawnRandom(x + Math.random(), y + Math.random(), wild);
    else if (tool === "sharks") world.sharks.spawnRandom(x + Math.random(), y + Math.random(), wild);
    else if (tool === "sheep") world.sheep.spawnRandom(x + Math.random(), y + Math.random(), wild);
    else if (tool === "cats") world.cats.spawnRandom(x + Math.random(), y + Math.random(), wild);
    else world.rocs.spawnRandom(x + Math.random(), y + Math.random(), wild);
  }
}

function setTool(t: Tool): void {
  tool = t;
  painting = false;
  dragStart = null;
  for (const b of toolButtons) b.setAttribute("aria-pressed", String(b.dataset.tool === t));
  brushEl.classList.toggle("disabled", t === "select");
  rateInput.disabled = sizeInput.disabled = t === "select";
  if (t === "destroy") rateInput.disabled = true; // it clears everything under it at once
  if (t === "gardener") rateInput.disabled = sizeInput.disabled = true; // one per click
  sprayOwed = 0;
  refreshBrushLabels();
  draw();
}

function refreshBrushLabels(): void {
  rateVal.textContent = tool === "destroy" || tool === "gardener" ? "–" : SPRAY_TOOLS.has(tool)
    ? `${Math.round(sprayPerSecond())} per s`
    : `${(brushRate() * TICKS_PER_SECOND).toFixed(3)}/s`;
  sizeVal.textContent = tool === "gardener" ? "–" : `${brushSize()} sq`;
}
/**
 * Settings panel: one slider per simulation variable, grouped into
 * collapsible sections, built from the table in settings.ts.
 */
function buildSettings(rootId: string, include: (s: Setting) => boolean, onChange: () => void = () => {}): () => void {
  const root = $<HTMLDivElement>(rootId);
  const refreshers: Array<() => void> = [];
  const groups = new Map<string, HTMLElement>();
  for (const s of SETTINGS.filter(include)) {
    let body = groups.get(s.group);
    if (!body) {
      const details = document.createElement("details");
      details.className = "settings-group";
      // On the Start tab, show the main starting conditions open.
      details.open = rootId === "startSettings" && s.group !== "Starting genes";
      const summary = document.createElement("summary");
      summary.textContent = s.group;
      details.append(summary);
      body = document.createElement("div");
      details.append(body);
      root.append(details);
      groups.set(s.group, body);
    }
    const row = document.createElement("label");
    row.className = "setting";
    row.title = s.tip;
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
      onChange();
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
  previewDirty = false;
  applyWorldSize();
  canvas.width = GRID_W * CELL_PX;
  canvas.height = GRID_H * CELL_PX;
  mapFrame.style.setProperty("--map-aspect", String(GRID_W / GRID_H)); // lets CSS shrink it to fit the window
  fitMap();
  ctx.imageSmoothingEnabled = false;
  hover = -1;
  world = new World(seed);
  renderer = new Renderer(world);
  seedInput.value = String(seed);
  history = [];
  selection = null;
  applyWeatherSettings();
  attachBrain();
  draw();
  refreshStats();
  refreshStartSummary();
}

// ---------------------------------------------------------------------------
// The gardener's optional language-model brain (see brain.worker.ts). It's
// only loaded when chosen; until it's ready, and whenever it can't answer,
// the built-in rules decide.

let brainWorker: Worker | null = null;
let brainReady = false;
let brainAsks = 0;
const brainWaiting = new Map<number, (text: string | null) => void>();

function startBrain(): void {
  if (brainWorker) return;
  brainStatus.textContent = "Starting the model…";
  brainWorker = new Worker(new URL("./brain.worker.ts", import.meta.url), { type: "module" });
  brainWorker.onmessage = (e: MessageEvent) => {
    const m = e.data as { type: string; text?: string; device?: string; id?: number; message?: string };
    if (m.type === "progress") brainStatus.textContent = m.text!;
    else if (m.type === "ready") {
      brainReady = true;
      brainStatus.textContent = `Model ready (running on the ${m.device}). It makes the gardener's next decisions.`;
      attachBrain();
    } else if (m.type === "answer") {
      brainWaiting.get(m.id!)?.(m.text!);
      brainWaiting.delete(m.id!);
    } else if (m.type === "error") {
      if (m.id !== undefined) {
        brainWaiting.get(m.id)?.(null);
        brainWaiting.delete(m.id);
      }
      if (!brainReady) brainStatus.textContent = `Couldn't load the model (${m.message}). The built-in rules decide instead.`;
    }
  };
  brainWorker.onerror = (e) => {
    brainStatus.textContent = `The model stopped working (${e.message || "unknown error"}). The built-in rules decide instead.`;
    brainWorker?.terminate();
    brainWorker = null;
    brainReady = false;
    for (const f of brainWaiting.values()) f(null);
    brainWaiting.clear();
    attachBrain();
  };
  brainWorker.postMessage({ type: "load" });
}

/** Asks the model to pick an option: the first number in its reply (none if there's no number, or no reply within 30 seconds). */
const modelChooser: Chooser = (p) =>
  new Promise((resolve) => {
    if (!brainWorker || !brainReady) return resolve({ pick: null, answer: "(the model isn't loaded)" });
    const id = ++brainAsks;
    const timer = window.setTimeout(() => {
      brainWaiting.delete(id);
      resolve({ pick: null, answer: "(no answer within 30 seconds)" });
    }, 30000);
    brainWaiting.set(id, (text) => {
      clearTimeout(timer);
      const m = text?.match(/\d+/);
      resolve({ pick: m ? Number(m[0]) : null, answer: text ?? "(the model failed)" });
    });
    brainWorker.postMessage({ type: "ask", id, system: p.system, user: p.user });
  });

/** Hands the gardener the model as their brain (once it's ready and chosen), else the rules. */
function attachBrain(): void {
  for (const g of world.gardeners) g.chooser = brainSel.value === "model" && brainReady ? modelChooser : null;
}

// The card's Thoughts / How they see it tabs.
for (const [tab, panel] of [["gtab-thoughts", "gpanel-thoughts"], ["gtab-view", "gpanel-view"]]) {
  $<HTMLButtonElement>(tab).addEventListener("click", () => {
    for (const [t2, p2] of [["gtab-thoughts", "gpanel-thoughts"], ["gtab-view", "gpanel-view"]]) {
      $<HTMLButtonElement>(t2).setAttribute("aria-selected", String(t2 === tab));
      $<HTMLDivElement>(p2).hidden = p2 !== panel;
    }
  });
}

brainSel.addEventListener("change", () => {
  if (brainSel.value === "model") startBrain();
  else brainStatus.textContent = "";
  attachBrain();
});

const startSummary = $<HTMLTableElement>("startSummary");
const startBtn = $<HTMLButtonElement>("startBtn");
const startHint = $<HTMLParagraphElement>("startHint");

/** Describes the (preview or current) world on the Start tab. */
function refreshStartSummary(): void {
  const s = world.stats();
  const lakes = (100 * s.waterSquares) / (GRID_W * GRID_H);
  const t = s.waterTotal;
  const share = (v: number) => `${Math.round(v).toLocaleString()} (${((100 * v) / t).toFixed(0)}%)`;
  startSummary.innerHTML = [
    ["Land / lakes", `${(100 - lakes).toFixed(0)}% / ${lakes.toFixed(0)}%`],
    ["Total water", Math.round(t).toLocaleString()],
    ["&nbsp;&nbsp;in lakes", share(s.waterSurface)],
    ["&nbsp;&nbsp;in the ground", share(s.waterSoil)],
    ["&nbsp;&nbsp;in clouds", share(s.waterCloud)],
    ["Total nutrients", Math.round(s.nutrientsTotal).toLocaleString()],
    ["Grass seeds / algae", `${s.seeds.toLocaleString()} / ${s.algae.toLocaleString()}`],
    ["Animals", (() => {
      const a = ([["fish", s.fish.alive], ["sharks", s.sharks.alive], ["sheep", s.sheep.alive], ["cats", s.cats.alive], ["rocs", s.rocs.alive]] as const)
        .filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`);
      return a.length ? a.join(", ") : "none";
    })()],
    ["Gardeners", String(world.gardeners.length || "none")],
  ].map(([k, v]) => `<tr><td class="muted">${k}</td><td>${v}</td></tr>`).join("");
}

function currentSeed(): number {
  const typed = Math.floor(Number(seedInput.value));
  return Number.isFinite(typed) ? typed : world.terrain.seed;
}

let previewTimer = 0;
/** Starting conditions changed since the preview was built. */
let previewDirty = false;
/** Starting conditions changed: rebuild the preview (only before starting). */
function startConditionsChanged(): void {
  previewDirty = true;
  if (started) return;
  clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => newWorld(currentSeed()), 250);
}

/** Start button: begin the previewed world, or build a fresh one if already running. */
function startWorld(): void {
  clearTimeout(previewTimer);
  if (started || previewDirty || world.terrain.seed !== currentSeed() || world.tick > 0) newWorld(currentSeed());
  started = true;
  setRunning(true);
  refreshStartPanel();
  selectTab($<HTMLButtonElement>("tab-world"));
}

/** Back to the Start tab with a paused preview of a new world. */
function setUpNewWorld(): void {
  started = false;
  setRunning(false);
  newWorld(currentSeed());
  refreshStartPanel();
  selectTab($<HTMLButtonElement>("tab-start"));
}

function refreshStartPanel(): void {
  startBtn.textContent = started ? "Start a new world" : "Start";
  startHint.textContent = started
    ? "A world is running. Change the starting conditions and press Start a new world to replace it, or use Set up a new world on the World tab to preview first."
    : "Set up the starting conditions, then press Start. The map shows a preview. Hover a name for what it does.";
}

function draw(): void {
  renderer.draw(viewSel.value as View);
  ctx.drawImage(renderer.canvas, 0, 0, GRID_W * CELL_PX, GRID_H * CELL_PX);
  drawSpores();
  drawRocShadows(); // under everything that walks or swims
  drawSheep();
  drawCats();
  drawFish();
  drawSharks();
  drawGardeners();
  drawRocs(); // on top: they fly over everything
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
    // Brush outline, coloured by tool.
    ctx.strokeStyle = BRUSH_COLOURS[tool];
    ctx.lineWidth = painting ? 2 : 1;
    ctx.setLineDash(painting ? [] : [5, 4]);
    ctx.beginPath();
    ctx.arc((mouse.x + 0.5) * CELL_PX, (mouse.y + 0.5) * CELL_PX, (tool === "gardener" ? 2 : brushSize()) * CELL_PX, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 1;
  }
}

/** Colour of a dead body: grey, fading out as it decomposes. */
function corpseColour(c: Corpse): string {
  const left = c.startNutrients > 0 ? c.nutrients / c.startNutrients : 0;
  return `rgba(95,95,92,${(0.8 * Math.min(1, left)).toFixed(3)})`;
}

/**
 * Fish are 3-pixel lines pointing the way they swim, wiggling side to
 * side while they move. Dead ones lie still, grey, fading as they rot.
 */
function drawFish(): void {
  const sw = world.fish;
  ctx.lineWidth = 1.3;
  ctx.lineCap = "round";
  for (const c of sw.corpses) drawFishShape(c.x, c.y, c.heading, 0, corpseColour(c));
  for (const s of sw.critters) {
    if (!s.alive) continue;
    // Side-to-side wiggle, only while moving.
    drawFishShape(s.x, s.y, s.heading, s.speed > 0 ? Math.sin(s.phase) * 0.9 : 0, s.colour);
  }
  ctx.lineWidth = 1;
}

function drawFishShape(x: number, y: number, heading: number, w: number, colour: string): void {
  const hx = x * CELL_PX;
  const hy = y * CELL_PX;
  const dx = Math.cos(heading);
  const dy = Math.sin(heading);
  ctx.strokeStyle = colour;
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(hx - dx * 1.5 - dy * w, hy - dy * 1.5 + dx * w);
  ctx.lineTo(hx - dx * 3 + dy * w, hy - dy * 3 - dx * w);
  ctx.stroke();
}

/**
 * Sheep are rounded squares of pastel fleece (8 pixels across at the
 * default size, bigger or smaller with body size) with a black head at the
 * front. Dead ones lie still, grey, fading as they rot.
 */
function drawSheep(): void {
  const sys = world.sheep;
  for (const c of sys.corpses) drawSheepShape(c.x, c.y, c.heading, c.mass, corpseColour(c), null);
  for (const s of sys.critters) {
    if (s.alive) drawSheepShape(s.x, s.y, s.heading, bodyMass(s), s.colour, "#111");
  }
}

function drawSheepShape(x: number, y: number, heading: number, mass: number, colour: string, head: string | null): void {
  const side = sheepSide(mass) * CELL_PX; // same size the simulation collides with
  const hs = side * 0.45; // head size
  ctx.save();
  ctx.translate(x * CELL_PX, y * CELL_PX);
  ctx.rotate(heading);
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.roundRect(-side / 2, -side / 2, side, side, side * 0.3);
  ctx.fill();
  // A round head at the front.
  ctx.fillStyle = head ?? colour;
  ctx.beginPath();
  ctx.arc(side / 2 + hs * 0.1, 0, hs * 0.55, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Algae spores: faint pale-green specks drifting in the water. */
function drawSpores(): void {
  const list = world.spores.spores;
  if (!list.length) return;
  ctx.fillStyle = "rgba(190, 230, 180, 0.16)"; // barely there
  ctx.beginPath();
  for (const s of list) ctx.rect(s.x * CELL_PX - 0.5, s.y * CELL_PX - 0.5, 1, 1);
  ctx.fill();
}

/**
 * Cats are bigger and longer than sheep: a dark rounded body with a round
 * head of the same colour at the front, and a short curly tail (2/3 of the
 * body length) whose curl drifts slowly and randomly. Dead ones lie still,
 * grey, fading, tail limp.
 */
function drawCats(): void {
  const sys = world.cats;
  for (const c of sys.corpses) drawCatShape(c.x, c.y, c.heading, c.mass, corpseColour(c), c.x * 7.3 + c.y * 3.1, null);
  for (const s of sys.critters) {
    if (s.alive) drawCatShape(s.x, s.y, s.heading, bodyMass(s), s.colour, s.id, s.mode === Mode.Resting ? null : world.tick); // resting: tail still
  }
}

/**
 * A gardener as a little pixel-art person (7 x 11 canvas pixels, drawn on
 * whole pixels), seen from the front, back or side depending on which way
 * they're heading. Walking runs a 4-frame cycle from the distance they've
 * covered: legs stepping, arms swinging opposite. Rowing shows them seated
 * and pulling the oars; carrying the boat, arms raised to hold it overhead.
 */
function drawPerson(g: Gardener, px: number, py: number, pose: "walking" | "rowing" | "carrying" | "dead"): void {
  const cloak = cloakOf(g);
  const SKIN = "#f0c49a", HAIR = "#4a2e1a", LEGS = "#3b3249", BELT = "#2a1d12", EYE = "#1b1410";
  // Sprite origin: feet at (px, py + 3).
  const ox = Math.round(px) - 3;
  const oy = Math.round(py) - 8;
  if (pose === "dead") {
    // Lying on their side, greyed.
    ctx.fillStyle = "rgba(150,150,150,0.85)";
    ctx.fillRect(ox - 2, oy + 7, 10, 3);
    ctx.fillStyle = "rgba(190,190,190,0.85)";
    ctx.fillRect(ox - 4, oy + 7, 2, 3);
    return;
  }
  const dx = Math.cos(g.heading), dy = Math.sin(g.heading);
  const facing = Math.abs(dx) > Math.abs(dy) ? "side" : dy > 0 ? "front" : "back";
  const mirror = facing === "side" && dx < 0;
  const px1 = (x: number, y: number, w: number, h: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(ox + (mirror ? 7 - x - w : x), oy + y, w, h);
  };
  // Walking: frame 0 and 2 stand straight, 1 and 3 step (opposite legs and arms).
  const frame = pose === "walking" && g.moving ? Math.floor(g.stride / 0.9) % 4 : 0;
  const step = frame === 1 ? 1 : frame === 3 ? -1 : 0;
  const row = pose === "rowing" && g.moving ? Math.floor(g.stride / 0.7) % 2 : 0;

  // A soft shadow on the ground.
  if (pose !== "rowing") {
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(ox + 1, oy + 11, 5, 1);
  }
  // Head: hair, then the face (front), back of the head, or a profile.
  px1(1, 0, 5, 2, HAIR);
  if (facing === "back") px1(1, 2, 5, 2, HAIR);
  else if (facing === "front") {
    px1(1, 2, 5, 2, SKIN);
    px1(1, 2, 1, 1, HAIR);
    px1(5, 2, 1, 1, HAIR);
    px1(2, 2, 1, 1, EYE);
    px1(4, 2, 1, 1, EYE);
  } else {
    px1(1, 2, 2, 2, HAIR);
    px1(3, 2, 3, 2, SKIN);
    px1(4, 2, 1, 1, EYE);
  }
  // Body: cloak and belt.
  px1(1, 4, 5, 4, cloak);
  px1(1, 7, 5, 1, BELT);
  // Arms.
  if (pose === "carrying") {
    // Both raised to hold the boat overhead.
    px1(0, 0, 1, 5, cloak);
    px1(6, 0, 1, 5, cloak);
    px1(0, 0, 1, 1, SKIN);
    px1(6, 0, 1, 1, SKIN);
  } else if (pose === "rowing") {
    // Pulling the oars: hands forward, then back to the chest.
    const reach = row ? 1 : 0;
    px1(0, 4, 1, 2, cloak);
    px1(6, 4, 1, 2, cloak);
    px1(0 - reach, 6, 1, 1, SKIN);
    px1(6 + reach, 6, 1, 1, SKIN);
  } else if (facing === "side") {
    // The near arm swings forward and back with the stride.
    px1(3, 4, 1, 3, cloak);
    px1(3 + step, 7, 1, 1, SKIN);
  } else {
    // Front or back: arms swing, one up as the other comes down.
    px1(0, 4, 1, 3 + step, cloak);
    px1(6, 4, 1, 3 - step, cloak);
    px1(0, 7 + step, 1, 1, SKIN);
    px1(6, 7 - step, 1, 1, SKIN);
  }
  if (pose === "rowing") return; // legs are in the boat
  // Legs: stepping.
  if (facing === "side") {
    px1(2 - step, 8, 1, 3, LEGS);
    px1(4 + step, 8, 1, 3, LEGS);
    px1(2 - step, 10, 2, 1, BELT);
    px1(4 + step, 10, 2, 1, BELT);
  } else {
    px1(2, 8, 1, step > 0 ? 2 : 3, LEGS);
    px1(4, 8, 1, step < 0 ? 2 : 3, LEGS);
    px1(2, step > 0 ? 9 : 10, 1, 1, BELT);
    px1(4, step < 0 ? 9 : 10, 1, 1, BELT);
  }
}

/** A wooden rowing boat seen from above, centred on (x, y) in pixels. */
function drawBoat(x: number, y: number, heading: number, alpha: number): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(heading);
  ctx.fillStyle = "#8a5a2b";
  ctx.strokeStyle = "#4a2f14";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(8, 0);
  ctx.quadraticCurveTo(3, -3.4, -6, -2.6);
  ctx.lineTo(-6, 2.6);
  ctx.quadraticCurveTo(3, 3.4, 8, 0);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#b07a42";
  ctx.fillRect(-1, -2.4, 1.6, 4.8); // the seat
  ctx.restore();
}

/** Cloak colours, one per gardener (the first is red), so they can be told apart. */
const CLOAKS = ["#e0483a", "#3a7be0", "#e8c53a", "#a05ee0", "#3ac2a6", "#e0853a", "#e03aa5", "#8fd63a"];
const cloakOf = (g: Gardener) => CLOAKS[(g.number - 1) % CLOAKS.length];

function drawGardeners(): void {
  for (const g of world.gardeners) drawGardener(g);
}

/**
 * A gardener: a person in a coloured cloak seen from above, with their boat
 * (under them while rowing, over their head while carrying it, or left on
 * the shore), anything they carry, a spear in flight, and a faint dashed
 * line to where they're heading.
 */
function drawGardener(g: Gardener): void {
  const px = g.x * CELL_PX;
  const py = g.y * CELL_PX;
  if (!g.hasBoat) drawBoat(g.boatX * CELL_PX, g.boatY * CELL_PX, g.boatHeading, 1);
  if (!g.alive) {
    drawPerson(g, px, py, "dead");
    return;
  }
  const aim = g.aim();
  if (aim) {
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.setLineDash([3, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(aim.x * CELL_PX, aim.y * CELL_PX);
    ctx.stroke();
    ctx.restore();
  }
  if (g.carcass) {
    ctx.fillStyle = "rgba(170,170,170,0.9)";
    ctx.beginPath();
    ctx.arc(g.carcass.x * CELL_PX, g.carcass.y * CELL_PX, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  const rowing = g.hasBoat && g.mode() === "rowing";
  if (rowing) drawBoat(px, py, g.heading, 1);
  const carrying = g.hasBoat && !rowing;
  drawPerson(g, px, py, rowing ? "rowing" : carrying ? "carrying" : "walking");
  if (carrying) drawBoat(px, py - 7, g.heading, 0.85); // held up overhead
  if (g.carried.length === 1) {
    // One animal, carried in the arms.
    ctx.fillStyle = g.carried[0].c.colour;
    ctx.strokeStyle = "#fff";
    ctx.beginPath();
    ctx.arc(px + 3, py - 3, 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (g.carried.length > 1) {
    // A net bag over the shoulder, with the catch showing through.
    const bx = px + 4, by = py - 4, br = 3.2;
    ctx.fillStyle = "rgba(230,220,190,0.25)";
    ctx.strokeStyle = "rgba(240,232,205,0.9)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    for (let k = 0; k < Math.min(6, g.carried.length); k++) {
      const a = k * 2.4;
      ctx.fillStyle = g.carried[k].c.colour;
      ctx.fillRect(bx + Math.cos(a) * 1.6 - 0.6, by + Math.sin(a) * 1.6 - 0.6, 1.2, 1.2);
    }
  }
  if (g.net) drawNet(g, px, py);
  if (g.seeds.length) {
    ctx.fillStyle = "#efe6b8";
    for (let k = 0; k < Math.min(5, g.seeds.length); k++) ctx.fillRect(px - 4 + k * 1.5, py + 3, 1, 1);
  }
  if (g.spear) {
    const s = g.spear;
    const f = 1 - s.t / 12; // how far it has flown
    const sx = (s.x0 + (s.x1 - s.x0) * f) * CELL_PX;
    const sy = (s.y0 + (s.y1 - s.y0) * f) * CELL_PX;
    const a = Math.atan2(s.y1 - s.y0, s.x1 - s.x0);
    ctx.strokeStyle = "#f4ead0";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx - Math.cos(a) * 6, sy - Math.sin(a) * 6);
    ctx.lineTo(sx, sy);
    ctx.stroke();
  }
}

/**
 * A cast net: it flies out from the gardener for the first few ticks, then
 * lies as a meshed circle where it landed, fading as it's gathered in.
 */
function drawNet(g: Gardener, px: number, py: number): void {
  const n = g.net!;
  const flying = Math.max(0, (n.t - 22) / 8); // 1 just thrown .. 0 landed
  const cx = (n.x + (g.x - n.x) * flying) * CELL_PX;
  const cy = (n.y + (g.y - n.y) * flying) * CELL_PX;
  const r = n.r * CELL_PX * (1 - 0.6 * flying);
  ctx.save();
  ctx.globalAlpha = Math.min(1, n.t / 12);
  ctx.strokeStyle = "rgba(240,232,205,0.9)";
  ctx.lineWidth = 0.7;
  // The line back to the gardener.
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(cx, cy);
  ctx.stroke();
  // Rim and mesh.
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.clip();
  ctx.beginPath();
  for (let d = -r; d <= r; d += 2.5) {
    ctx.moveTo(cx + d - r, cy - r);
    ctx.lineTo(cx + d + r, cy + r);
    ctx.moveTo(cx + d + r, cy - r);
    ctx.lineTo(cx + d - r, cy + r);
  }
  ctx.globalAlpha *= 0.6;
  ctx.stroke();
  ctx.restore();
}

/**
 * `seed` makes each cat's tail move differently; `tick` animates the curl
 * (game time, so it freezes while paused), or null for a still tail.
 */
function drawCatShape(x: number, y: number, heading: number, mass: number, colour: string, seed: number, tick: number | null): void {
  const k = Math.max(0.4, Math.sqrt(mass / 4));
  const len = 7 * k;
  const wid = 3 * k;
  const head = 2 * k; // head radius: a little wider than the body, so it shows
  ctx.save();
  ctx.translate(x * CELL_PX, y * CELL_PX);
  ctx.rotate(heading);
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.roundRect(-len / 2, -wid / 2, len, wid, wid * 0.45);
  ctx.moveTo(len / 2 + head * 0.7 + head, 0);
  ctx.arc(len / 2 + head * 0.7, 0, head, 0, Math.PI * 2);
  ctx.fill();
  // Tail: a chain of short segments from the rump. Two slow sines at odd
  // frequencies (offset per cat) set how it swings and how tightly it curls,
  // curling more toward the tip.
  const t = tick ?? 0;
  const swing = 0.5 * Math.sin(t * 0.009 + seed * 1.7);
  const curl = tick === null ? 1.2 : 2.6 * (0.65 * Math.sin(t * 0.011 + seed * 2.3) + 0.35 * Math.sin(t * 0.0043 + seed * 0.9));
  const segs = 8;
  const step = (len * 2) / 3 / segs;
  let tx = -len / 2 + wid * 0.2;
  let ty = 0;
  let dir = Math.PI + swing;
  ctx.strokeStyle = colour;
  ctx.lineWidth = Math.max(1, wid * 0.4);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  for (let i = 1; i <= segs; i++) {
    dir += (curl * 2 * i) / (segs * (segs + 1)); // the turns add up to `curl`, weighted toward the tip
    tx += Math.cos(dir) * step;
    ty += Math.sin(dir) * step;
    ctx.lineTo(tx, ty);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Rocs, seen from above: a body with a small head and a fan tail. Flying,
 * their wings are spread (sweeping in and out as they flap, when turning or
 * speeding up); landed, the wings are folded along the body. Dead ones lie
 * still, grey, fading.
 */
function drawRocs(): void {
  const sys = world.rocs;
  for (const c of sys.corpses) drawRocShape(c.x, c.y, c.heading, c.mass, corpseColour(c), false, 0, 0);
  for (const r of sys.critters) {
    if (r.alive) drawRocShape(r.x, r.y, r.heading, bodyMass(r), r.colour, r.flying, r.tailAmp, r.phase);
  }
}

/**
 * Every roc casts a dark, blurry shadow. The higher it flies, the bigger,
 * fainter and blurrier the shadow, and the further it falls to the bottom
 * left (the sun is up and to the right).
 */
function drawRocShadows(): void {
  for (const r of world.rocs.critters) {
    if (!r.alive) continue;
    const a = r.alt;
    ctx.save();
    ctx.globalAlpha = Math.max(0.3, 0.8 - a * 0.1);
    ctx.filter = `blur(${(0.6 + a * 0.45).toFixed(1)}px)`;
    const ox = -1.5 - a * 3; // pixels left...
    const oy = 1.5 + a * 3; // ...and down
    ctx.translate((r.x) * CELL_PX + ox, (r.y) * CELL_PX + oy);
    const k = 1 + a * 0.12;
    ctx.scale(k, k);
    drawRocShape(0, 0, r.heading, bodyMass(r), "#000", r.flying, r.tailAmp, r.phase);
    ctx.restore();
  }
}

function drawRocShape(x: number, y: number, heading: number, mass: number, colour: string, flying: boolean, flap: number, phase: number): void {
  const L = 4 + 10 * Math.sqrt(Math.max(0.1, mass) / 8); // body length in pixels (14 at default size)
  // Wing span: wide open when gliding, sweeping in and out while flapping, folded on the ground.
  const beat = 0.5 + 0.5 * Math.sin(phase);
  const span = flying ? L * 1.5 * (1 - 0.45 * flap * beat) : L * 0.35;
  const sweep = flying ? L * (0.15 + 0.25 * flap * beat) : L * 0.35; // how far back the wingtips sit
  const draw = (dx: number, dy: number, fill: string) => {
    ctx.save();
    ctx.translate(x * CELL_PX + dx, y * CELL_PX + dy);
    ctx.rotate(heading);
    ctx.fillStyle = fill;
    ctx.beginPath();
    // Body.
    ctx.ellipse(0, 0, L * 0.45, L * 0.14, 0, 0, Math.PI * 2);
    // Head.
    ctx.moveTo(L * 0.62, 0);
    ctx.arc(L * 0.5, 0, L * 0.12, 0, Math.PI * 2);
    // Fan tail.
    ctx.moveTo(-L * 0.4, 0);
    ctx.lineTo(-L * 0.68, L * 0.16);
    ctx.lineTo(-L * 0.68, -L * 0.16);
    ctx.closePath();
    // Wings: from the shoulders out to swept-back tips.
    for (const side of [1, -1]) {
      ctx.moveTo(L * 0.2, 0);
      ctx.lineTo(L * 0.05, side * span * 0.55); // leading edge, bending back to the tip
      ctx.lineTo(-sweep, side * span);
      ctx.lineTo(-L * 0.28, side * span * 0.35); // broad trailing edge
      ctx.lineTo(-L * 0.25, 0);
      ctx.closePath();
    }
    ctx.fill();
    ctx.restore();
  };
  draw(0, 0, colour);
}

/**
 * Sharks, seen from above: a tapered body with pectoral fins and a forked
 * tail that sweeps side to side as they swim. Length grows with body size.
 * Dead sharks lie still,
 * grey, fading as they rot.
 */
function drawSharks(): void {
  const sh = world.sharks;
  for (const c of sh.corpses) drawSharkShape(c.x, c.y, c.heading, c.mass, 0, corpseColour(c));
  for (const s of sh.critters) {
    if (!s.alive) continue;
    drawSharkShape(s.x, s.y, s.heading, bodyMass(s), Math.sin(s.phase) * s.tailAmp, s.colour);
  }
}

/** `wiggle` is -1..1 (tail sweep); the shape is centred on (x, y). */
function drawSharkShape(x: number, y: number, heading: number, mass: number, wiggle: number, colour: string): void {
  const L = 4 + 3 * mass; // pixels nose to tail: grows with the shark
  const W = L * 0.26;
  const w = wiggle * W * 0.55;
  ctx.save();
  ctx.translate(x * CELL_PX, y * CELL_PX);
  ctx.rotate(heading);
  // Its position is the middle of the body, so it turns about its centre.
  ctx.translate(0.5 * L, 0);
  ctx.fillStyle = colour;
  ctx.beginPath();
  // Body: pointed nose, widest a third of the way back, narrowing to the tail.
  ctx.moveTo(0, 0);
  ctx.lineTo(-0.3 * L, 0.5 * W);
  ctx.lineTo(-0.72 * L, 0.18 * W + w * 0.5);
  ctx.lineTo(-0.8 * L, w * 0.8);
  ctx.lineTo(-0.72 * L, -0.18 * W + w * 0.5);
  ctx.lineTo(-0.3 * L, -0.5 * W);
  ctx.closePath();
  // Pectoral fins.
  ctx.moveTo(-0.28 * L, 0.45 * W);
  ctx.lineTo(-0.46 * L, 1.05 * W);
  ctx.lineTo(-0.42 * L, 0.4 * W);
  ctx.moveTo(-0.28 * L, -0.45 * W);
  ctx.lineTo(-0.46 * L, -1.05 * W);
  ctx.lineTo(-0.42 * L, -0.4 * W);
  // Forked tail, swept by the wiggle.
  ctx.moveTo(-0.78 * L, w * 0.8);
  ctx.lineTo(-1.0 * L, w * 1.3 + 0.55 * W);
  ctx.lineTo(-0.9 * L, w * 1.1);
  ctx.lineTo(-1.0 * L, w * 1.3 - 0.55 * W);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// --- Sound (starts off: browsers only allow audio after the player clicks) ---
const sound = new Sound();
const soundBtn = $<HTMLButtonElement>("sound");
function setSound(on: boolean): void {
  sound.setEnabled(on);
  soundBtn.textContent = on ? "Sound on" : "Sound off";
  soundBtn.setAttribute("aria-pressed", String(on));
}
soundBtn.addEventListener("click", () => setSound(!sound.enabled));

/** Tools & weather tab: a switch, volume slider and ▶ preview for each sound. */
function buildSoundControls(): void {
  const box = $<HTMLDivElement>("soundSettings");
  box.textContent = "";
  for (const { key, label, tip } of SOUNDS) {
    const s = sound.settings[key];
    const row = document.createElement("div");
    row.className = "sound-row";
    row.title = tip;
    const name = document.createElement("label");
    name.className = "sound-name";
    const on = document.createElement("input");
    on.type = "checkbox";
    on.checked = s.on;
    name.append(on, ` ${label}`);
    const vol = document.createElement("input");
    vol.type = "range";
    vol.min = "0";
    vol.max = "100";
    vol.value = String(Math.round(s.volume * 100));
    vol.setAttribute("aria-label", `${label} volume`);
    const val = document.createElement("span");
    val.className = "setting-value";
    const show = () => {
      val.textContent = `${vol.value}%`;
      row.classList.toggle("off", !on.checked);
    };
    on.addEventListener("change", () => {
      sound.setSound(key, { on: on.checked });
      show();
    });
    vol.addEventListener("input", () => {
      sound.setSound(key, { volume: Number(vol.value) / 100 });
      show();
    });
    const play = document.createElement("button");
    play.textContent = "▶";
    play.title = `Play the ${label.toLowerCase()} sound`;
    play.addEventListener("click", () => sound.preview(key));
    show();
    row.append(name, vol, val, play);
    box.append(row);
  }
  const reset = document.createElement("button");
  reset.textContent = "Reset sounds";
  reset.title = "Switch every sound back on at its default volume (rain loudest)";
  reset.addEventListener("click", () => {
    sound.resetSounds();
    buildSoundControls();
  });
  box.append(reset);
}
buildSoundControls();

/** Plays sounds for what the animals did since the last frame, then clears their event counts. */
function playAnimalSounds(dt: number): void {
  const pan = (x: number) => (x / GRID_W) * 2 - 1;
  const cues: Array<[CritterSystem, "births" | "deaths" | "kills", SoundName]> = [
    [world.fish, "deaths", "plop"],
    [world.fish, "births", "unplop"],
    [world.sharks, "kills", "chomp"],
    [world.sharks, "births", "jaws"],
    [world.sheep, "deaths", "sadBaa"],
    [world.sheep, "births", "highBaa"],
    [world.cats, "kills", "roar"],
    [world.cats, "births", "meow"],
  ];
  for (const [sys, event, name] of cues) if (sys.sounds[event] > 0) sound.play(name, pan(sys.sounds.x));
  for (const sys of [world.fish, world.sharks, world.sheep, world.cats]) {
    sys.sounds.births = sys.sounds.deaths = sys.sounds.kills = 0;
  }
  sound.update(running ? world.water.rainFade : 0, dt);
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
      if (world.water.raining) rainedSinceSample = true;
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
  playAnimalSounds(dt);
  requestAnimationFrame(loop);
}

function formatGameTime(tick: number): string {
  const secs = Math.floor(tick / TICKS_PER_SECOND);
  const m = Math.floor(secs / 60);
  return `${m}:${String(secs % 60).padStart(2, "0")}`;
}

function refreshStats(): void {
  const s = world.stats();
  history.push({
    grass: s.grass, seeds: s.seeds, algae: s.algae,
    cloud: s.waterCloud, surface: s.waterSurface, soil: s.waterSoil, fish: s.fish.alive, sharks: s.sharks.alive, sheep: s.sheep.alive, cats: s.cats.alive, rocs: s.rocs.alive,
    rained: rainedSinceSample || s.raining,
    nutrients: {
      ground: s.nutrientsGround, water: s.nutrientsWater, grass: s.nutrientsGrass, algae: s.nutrientsAlgae,
      fish: world.fish.nutrientTotal(), sharks: world.sharks.nutrientTotal(), sheep: world.sheep.nutrientTotal(),
      cats: world.cats.nutrientTotal(), rocs: world.rocs.nutrientTotal(),
    },
    energy: {
      grass: s.energyGrass, algae: s.energyAlgae,
      fish: world.fish.energyTotal(), sharks: world.sharks.energyTotal(), sheep: world.sheep.energyTotal(),
      cats: world.cats.energyTotal(), rocs: world.rocs.energyTotal(),
    },
  });
  rainedSinceSample = false;
  if (history.length > HISTORY) history.shift();

  const table = (rows: Array<[string, string]>) =>
    rows.map(([k, v]) => `<tr><td class="muted">${k}</td><td>${v}</td></tr>`).join("");
  statsLife.innerHTML = table([
    ["Grass", s.grass.toLocaleString()],
    ["Seeds waiting", s.seeds.toLocaleString()],
    ["Algae spores drifting", s.spores.toLocaleString()],
    ["Algae", s.algae.toLocaleString()],
    ["Births / deaths (last 20 frames)", `${s.grassBirths + s.algaeBirths} / ${s.grassDeaths + s.algaeDeaths}`],
    ["Deaths: starved / old age / drowned or stranded", `${s.starved} / ${s.oldAge} / ${s.habitatLost}`],
  ]);
  statsWorld.innerHTML = table([
    ["Game time", `${formatGameTime(s.tick)} (tick ${s.tick.toLocaleString()})`],
    ["Wind", windText()],
  ]);
  // Achieved speed, shown next to the speed control.
  speedStatus.textContent = !started ? "" : running
    ? `running ${(measuredRate / TICKS_PER_SECOND).toFixed(1)}×${fallingBehind ? " · can't keep up" : ""}`
    : "paused";
  speedStatus.classList.toggle("behind", running && fallingBehind);
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
    ["In animals (alive & dead)", s.nutrientsAnimals.toFixed(1)],
    ["Total (conserved)", s.nutrientsTotal.toFixed(3)],
  ]);

  const all = world.regionStats(0, 0, GRID_W - 1, GRID_H - 1);
  genesTable.innerHTML = geneRows(all.grass, all.algae);
  refreshSelection();
  drawLineChart(chartCtx, chart, [
    ["grass", "#6fbf3a"],
    ["seeds", "#e3cf7a"],
    ["algae", "#3fa7a0"],
  ]);
  critterCard(world.fish, s.fish, statsFish, fishTraits, "Fish", "Eaten by sharks");
  critterCard(world.sharks, s.sharks, statsSharks, sharkTraits, "Sharks", null);
  critterCard(world.sheep, s.sheep, statsSheep, sheepTraits, "Sheep", "Eaten by cats, or by sharks while swimming");
  critterCard(world.cats, s.cats, statsCats, catTraits, "Cats", null);
  critterCard(world.rocs, s.rocs, statsRocs, rocTraits, "Rocs", "Eaten by cats (while landed)");
  gardenerCard();
  drawLineChart(fishChartCtx, fishChart, [["fish", "#e07a5f"]]);
  drawLineChart(sharkChartCtx, sharkChart, [["sharks", "#aabed7"]]);
  drawLineChart(sheepChartCtx, sheepChart, [["sheep", "#f0e6d8"]]);
  drawLineChart(catChartCtx, catChart, [["cats", "#c8966e"]]);
  drawLineChart(rocChartCtx, rocChart, [["rocs", "#d2aa64"]]);
  drawFlowChart(nutrientFlow);
  drawFlowChart(energyFlow);
  drawLineChart(waterChartCtx, waterChart, [
    ["cloud", "#e4ded2"],
    ["surface", "#4f94e0"],
    ["soil", "#b98548"],
  ], true);
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
    ["Nutrients: ground", `${r.groundNutrients.toFixed(2)}${r.land ? ` (${(r.groundNutrients / r.land).toFixed(3)}/sq)` : ""}`],
    ["Nutrients: water", `${r.waterNutrients.toFixed(2)}${r.water ? ` (${(r.waterNutrients / r.water).toFixed(3)}/sq)` : ""}`],
    ["Nutrients: in flora", r.floraNutrients.toFixed(2)],
    ...group("Grass", r.grass, PARAMS.grassMaxN, "mean age"),
    ...group("Seeds", r.seeds, 0, "mean ticks to germinate"),
    ...group("Algae", r.algae, PARAMS.algaeMaxN, "mean age"),
    ...critterRows(world.fish, "Fish", x0, y0, x1, y1),
    ...critterRows(world.sharks, "Sharks", x0, y0, x1, y1),
    ...critterRows(world.sheep, "Sheep", x0, y0, x1, y1),
    ...critterRows(world.cats, "Cats", x0, y0, x1, y1),
    ...critterRows(world.rocs, "Rocs", x0, y0, x1, y1),
  ];
  selectionEl.innerHTML =
    `<table>${rows.map(([k, v]) => `<tr><td class="muted">${k}</td><td>${v}</td></tr>`).join("")}</table>` +
    `<h2>Genes in selection <span class="small">(mean ±sd, min – max)</span></h2>` +
    `<table>${geneRows(r.grass, r.algae, true)}</table>`;
}

/**
 * Draws the recent history as lines on a shared scale from zero. With
 * `rainBands`, samples where it rained are shaded as vertical bands.
 */
/** Counts and mean traits for one critter species' card. */
function critterCard(
  sys: CritterSystem, n: CritterCounts, statsEl: HTMLTableElement, traitsEl: HTMLTableElement,
  title: string, eatenLabel: string | null,
): void {
  const rows: Array<[string, string]> = [
    [title, n.alive.toLocaleString()],
    ["Births / deaths (last 20 frames)", `${n.births} / ${n.deaths}`],
    ["Pregnant", sys.critters.filter((c) => c.alive && c.womb).length.toLocaleString()],
    ["Deaths: starved / old age", `${n.starved} / ${n.oldAge}`],
  ];
  if (eatenLabel) rows.push([eatenLabel, String(n.eaten)]);
  if (world.gardeners.length) rows.push([`Culled or taken by ${world.gardeners.length > 1 ? "gardeners" : "the gardener"}`, String(n.culled)]);
  rows.push(["Bodies rotting", n.corpses.toLocaleString()]);
  statsEl.innerHTML = rows.map(([k, v]) => `<tr><td class="muted">${k}</td><td>${v}</td></tr>`).join("");
  const defs = sys.species.traits;
  const ts = CritterSystem.traitStats(sys.critters.filter((c) => c.alive), defs);
  traitsEl.innerHTML = defs.map((d, t) =>
    `<tr><td class="muted" title="${d.tip}">${d.label}</td><td>${Number.isNaN(ts[t].mean) ? "–" : `${fmtNum(ts[t].mean)} <span class="muted">±${fmtNum(ts[t].sd)}</span>`}</td></tr>`,
  ).join("");
}

let gardenerShown = 0;
let thoughtsShown = "";
/** Thoughts (by tick and position) the viewer has opened or closed, so a refresh keeps them that way. */
const thoughtOpen = new Map<string, boolean>();

function gardenerCard(): void {
  const gs = world.gardeners;
  gardenerShown = Math.min(gardenerShown, Math.max(0, gs.length - 1));
  // One little tab per gardener, in their cloak colour (only when there's more than one).
  gardenerTabs.hidden = gs.length < 2;
  const tabKey = gs.map((g, k) => `${g.alive}${k === gardenerShown}`).join("|");
  if (gardenerTabs.dataset.key !== tabKey) {
    gardenerTabs.dataset.key = tabKey;
    gardenerTabs.replaceChildren(...gs.map((g, k) => {
      const b = document.createElement("button");
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(k === gardenerShown));
      b.title = `${g.name}${g.alive ? "" : " (dead)"}`;
      b.className = g.alive ? "" : "dead";
      const dot = document.createElement("span");
      dot.className = "cloak";
      dot.style.background = cloakOf(g);
      b.append(dot, String(g.number));
      b.addEventListener("click", () => {
        gardenerShown = k;
        thoughtsShown = "";
        gardenerCard();
      });
      return b;
    }));
  }
  const g = gs[gardenerShown];
  const alive = gs.filter((q) => q.alive).length;
  const rows: Array<[string, string]> = !g
    ? [["Gardener", "none (see Gardeners on the Settings tab)"]]
    : [
      ...(gs.length > 1 ? [["Gardeners", `${alive} alive of ${gs.length}`] as [string, string]] : []),
      [g.name, `<span class="cloak" style="background:${cloakOf(g)}"></span>${g.alive ? `alive, ${g.mode()}` : "dead"}`],
      ["Fat", `${Math.max(0, g.fat).toFixed(1)} of ${PARAMS.gardenerMaxFat}`],
      ["Doing", g.alive ? g.doing || "–" : "–"],
      ["Right now", g.status],
      ["Boat", g.hasBoat ? "with them" : `left at (${g.boatX | 0}, ${g.boatY | 0})`],
    ];
  statsGardener.innerHTML = rows.map(([k, v]) => `<tr><td class="muted">${k}</td><td>${v}</td></tr>`).join("");
  const items = (el: HTMLElement, lines: string[]) =>
    el.replaceChildren(...lines.map((t) => Object.assign(document.createElement("li"), { textContent: t })));
  items(gardenerView, !g ? [] : (["grass", "algae", "fish", "shark", "sheep", "cat", "roc"] as const)
    .map((n) => `${n === "roc" ? "Rocs (sacred)" : n === "shark" || n === "cat" ? `${n[0].toUpperCase()}${n.slice(1)}s` : `${n[0].toUpperCase()}${n.slice(1)}`}: ${g.outlookText(n)}`));
  items(gardenerPlaces, g ? g.regionLines().map((l) => l[0].toUpperCase() + l.slice(1)) : []);
  renderThoughts(g);
}

/** The gardener's recent thoughts, newest first: each decision opens to show the options they weighed. */
function renderThoughts(g: Gardener | undefined): void {
  const list = g ? g.thoughts.slice(-15).reverse() : [];
  const key = `${g?.name}|` + list.map((t) => `${t.tick}${t.chosen}${t.pending}${t.note ?? ""}`).join("|");
  if (key === thoughtsShown) return;
  thoughtsShown = key;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  };
  const newest = list.findIndex((t) => t.options.length > 0); // the latest decision starts open
  gardenerThoughts.replaceChildren(...list.map((t, k) => {
    const li = el("li");
    const when = el("span", "when", formatGameTime(t.tick));
    if (!t.options.length) {
      li.append(when, el("span", "noteline", t.note ?? ""));
      return li;
    }
    const id = `${g!.name}@${t.tick}#${t.options.length}`;
    const det = el("details");
    det.open = thoughtOpen.get(id) ?? k === newest;
    det.addEventListener("toggle", () => thoughtOpen.set(id, det.open));
    const sum = el("summary");
    const head = t.pending ? "Thinking it over (asking the model)…"
      : t.chosen >= 0 ? t.options[t.chosen].text
      : t.note ?? "Nothing taken.";
    sum.append(when, document.createTextNode(head));
    if (!t.pending && t.by) sum.append(el("span", "by", ` — ${t.by}`));
    det.append(sum);
    if (t.midTask) det.append(el("div", "noteline", "A look round mid-task: only options more pressing than the current one."));
    const ol = el("ol");
    const top = Math.max(...t.options.map((o) => o.utility), 1e-6);
    t.options.forEach((o, j) => {
      const item = el("li", j === t.chosen ? "chosen" : "", o.text);
      if (j === t.chosen) item.append(el("span", "tag", "chosen"));
      if (j === t.best && t.best !== t.chosen) item.append(el("span", "tag", "rules' pick"));
      const score = el("div", "score");
      const bar = el("span", "bar");
      bar.style.width = `${Math.max(2, (60 * o.utility) / top)}px`;
      score.append(bar, document.createTextNode(`score ${o.utility.toFixed(2)}`));
      item.append(score);
      ol.append(item);
    });
    det.append(ol);
    if (t.answer !== undefined) det.append(el("div", "answer", `The model answered: “${t.answer.trim()}”`));
    if (t.note && t.chosen < 0 && !t.pending) det.append(el("div", "noteline", t.note));
    li.append(det);
    return li;
  }));
  if (!list.length) gardenerThoughts.append(el("li", "noteline", "No thoughts yet."));
}

function critterRows(sys: CritterSystem, label: string, x0: number, y0: number, x1: number, y1: number): Array<[string, string]> {
  const inside = sys.critters.filter((s) => s.alive && s.x >= x0 && s.x < x1 + 1 && s.y >= y0 && s.y < y1 + 1);
  if (!inside.length) return [[label, "0"]];
  const mean = (f: (s: Critter) => number) => inside.reduce((a, s) => a + f(s), 0) / inside.length;
  return [
    [label, inside.length.toLocaleString()],
    ["&nbsp;&nbsp;mean fat", mean((s) => s.fat).toFixed(2)],
    ["&nbsp;&nbsp;mean age", mean((s) => s.age).toFixed(0)],
  ];
}

/** One distribution chart: its canvas, holders, which sample field it reads, and the hovered sample. */
interface FlowChart {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  tip: HTMLDivElement;
  legend: HTMLDivElement;
  series: FlowSeries[];
  pick: (p: Sample) => Record<string, number>;
  hover: number | null;
}

function flowChart(id: string, series: FlowSeries[], pick: (p: Sample) => Record<string, number>): FlowChart {
  const canvas = $<HTMLCanvasElement>(id);
  const fc: FlowChart = {
    canvas, ctx: canvas.getContext("2d")!, tip: canvas.parentElement!.querySelector<HTMLDivElement>(".chart-tip")!,
    legend: $<HTMLDivElement>(`${id}Legend`), series, pick, hover: null,
  };
  // Hover: a crosshair on the nearest sample and a tooltip with every holder's value there.
  canvas.addEventListener("mousemove", (e) => {
    if (history.length < 2) return;
    const r = canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * canvas.width;
    const plotX = (x - FLOW_LEFT) / (canvas.width - FLOW_LEFT - FLOW_RIGHT);
    fc.hover = Math.max(0, Math.min(history.length - 1, Math.round(plotX * (history.length - 1))));
    drawFlowChart(fc);
    showFlowTip(fc, e.clientX - r.left, e.clientY - r.top, r.width);
  });
  canvas.addEventListener("mouseleave", () => {
    fc.hover = null;
    fc.tip.hidden = true;
    drawFlowChart(fc);
  });
  return fc;
}

const FLOW_LEFT = 34; // room for the axis labels
const FLOW_RIGHT = 6;
const FLOW_TOP = 8;
const FLOW_BOTTOM = 8;

function fmtFlow(v: number): string {
  if (v >= 10000) return `${(v / 1000).toFixed(0)}k`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  if (v >= 100) return v.toFixed(0);
  if (v >= 1) return v.toFixed(1);
  return v.toFixed(2);
}

/**
 * Log-scale line chart of where nutrients or energy are held over time.
 * One y-axis (powers of ten); values at or below the bottom of the scale
 * leave a gap rather than a line along the floor.
 */
function drawFlowChart(fc: FlowChart): void {
  const { canvas, ctx: c } = fc;
  const w = canvas.width;
  const h = canvas.height;
  c.clearRect(0, 0, w, h);
  if (fc.hover !== null && fc.hover >= history.length) fc.hover = null; // history was reset
  if (history.length < 2) return;
  let lo = Infinity;
  let hi = 0;
  for (const p of history) {
    const v = fc.pick(p);
    for (const sr of fc.series) {
      const x = v[sr.key] ?? 0;
      if (x > 0.01) lo = Math.min(lo, x);
      hi = Math.max(hi, x);
    }
  }
  if (hi <= 0) return;
  const d0 = Math.floor(Math.log10(Math.max(0.01, Math.min(lo, hi))));
  const d1 = Math.max(d0 + 1, Math.ceil(Math.log10(hi)));
  const plotW = w - FLOW_LEFT - FLOW_RIGHT;
  const plotH = h - FLOW_TOP - FLOW_BOTTOM;
  const xAt = (i: number) => FLOW_LEFT + (i / (history.length - 1)) * plotW;
  const yAt = (v: number) => FLOW_TOP + plotH - ((Math.log10(v) - d0) / (d1 - d0)) * plotH;
  // Recessive grid: one line and label per power of ten.
  c.font = "10px system-ui, sans-serif";
  c.textAlign = "right";
  c.textBaseline = "middle";
  for (let d = d0; d <= d1; d++) {
    const y = yAt(10 ** d);
    c.strokeStyle = "rgba(233, 225, 211, 0.1)";
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(FLOW_LEFT, Math.round(y) + 0.5);
    c.lineTo(w - FLOW_RIGHT, Math.round(y) + 0.5);
    c.stroke();
    c.fillStyle = "rgba(233, 225, 211, 0.55)";
    c.fillText(fmtFlow(10 ** d), FLOW_LEFT - 4, y);
  }
  // Lines, 2px, environment first so the living lines sit on top.
  c.lineJoin = "round";
  c.lineCap = "round";
  for (const sr of fc.series) {
    c.strokeStyle = sr.colour;
    c.lineWidth = 2;
    c.setLineDash(sr.dash ?? []);
    c.beginPath();
    let drawing = false;
    history.forEach((p, i) => {
      const v = fc.pick(p)[sr.key] ?? 0;
      if (v <= 10 ** d0) {
        drawing = false;
        return;
      }
      if (drawing) c.lineTo(xAt(i), yAt(v));
      else c.moveTo(xAt(i), yAt(v));
      drawing = true;
    });
    c.stroke();
  }
  c.setLineDash([]);
  // Crosshair on the hovered sample, with a dot on each line.
  if (fc.hover !== null) {
    const x = xAt(fc.hover);
    c.strokeStyle = "rgba(233, 225, 211, 0.45)";
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(Math.round(x) + 0.5, FLOW_TOP);
    c.lineTo(Math.round(x) + 0.5, FLOW_TOP + plotH);
    c.stroke();
    const v = fc.pick(history[fc.hover]);
    for (const sr of fc.series) {
      const val = v[sr.key] ?? 0;
      if (val <= 10 ** d0) continue;
      c.fillStyle = sr.colour;
      c.strokeStyle = "#1a1611"; // surface ring so overlapping dots stay distinct
      c.lineWidth = 2;
      c.beginPath();
      c.arc(x, yAt(val), 3.5, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }
  }
  // Legend: every holder with its current value (text in text colours, not the series colour).
  const now = fc.pick(history[history.length - 1]);
  fc.legend.innerHTML = fc.series.map((sr) =>
    `<span class="item"><span class="line-swatch${sr.dash ? " dashed" : ""}" style="border-top-color:${sr.colour}"></span>${sr.label}<b>${fmtFlow(now[sr.key] ?? 0)}</b></span>`,
  ).join("");
}

function showFlowTip(fc: FlowChart, mx: number, my: number, width: number): void {
  if (fc.hover === null) return;
  const p = history[fc.hover];
  const v = fc.pick(p);
  const rows = fc.series
    .map((sr) => ({ sr, val: v[sr.key] ?? 0 }))
    .sort((a, b) => b.val - a.val)
    .map(({ sr, val }) => `<div class="row"><span class="line-swatch${sr.dash ? " dashed" : ""}" style="border-top-color:${sr.colour}"></span>${sr.label}<b>${fmtFlow(val)}</b></div>`)
    .join("");
  const ago = history.length - 1 - fc.hover;
  fc.tip.innerHTML = `<div class="muted">${ago === 0 ? "now" : `${ago} sample${ago === 1 ? "" : "s"} ago`}</div>${rows}`;
  fc.tip.hidden = false;
  // Keep the tooltip inside the card: flip to the left of the cursor near the right edge.
  const tw = fc.tip.offsetWidth;
  fc.tip.style.left = `${mx + 12 + tw > width ? Math.max(0, mx - tw - 12) : mx + 12}px`;
  fc.tip.style.top = `${Math.max(0, my - 20)}px`;
}

const nutrientFlow = flowChart("nutrientFlow", NUTRIENT_SERIES, (p) => p.nutrients);
const energyFlow = flowChart("energyFlow", ENERGY_SERIES, (p) => p.energy);

function drawLineChart(
  ctx2: CanvasRenderingContext2D,
  canvas2: HTMLCanvasElement,
  series: Array<[NumericKey, string]>,
  rainBands = false,
): void {
  const w = canvas2.width;
  const h = canvas2.height;
  ctx2.clearRect(0, 0, w, h);
  if (history.length < 2) return;
  // Stretch to the full width while the history is still filling up.
  const span = history.length - 1;
  const xAt = (i: number) => (i / span) * w;
  if (rainBands) {
    ctx2.fillStyle = "rgba(110, 150, 255, 0.22)";
    const step = w / span;
    history.forEach((p, i) => {
      if (p.rained) ctx2.fillRect(xAt(i) - step / 2, 0, step + 0.5, h);
    });
  }
  let max = 1;
  for (const p of history) for (const [key] of series) max = Math.max(max, p[key]);
  for (const [key, color] of series) {
    ctx2.strokeStyle = color;
    ctx2.lineWidth = 1.5;
    ctx2.beginPath();
    history.forEach((p, i) => {
      const y = h - 4 - (p[key] / max) * (h - 8);
      if (i === 0) ctx2.moveTo(xAt(i), y);
      else ctx2.lineTo(xAt(i), y);
    });
    ctx2.stroke();
  }
  // Scale label: the top of the chart.
  ctx2.fillStyle = "rgba(233, 225, 211, 0.55)";
  ctx2.font = "10px system-ui, sans-serif";
  ctx2.fillText(Math.round(max).toLocaleString(), 4, 11);
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
  line1 += ` · nutrients ${world.nutrients[i].toFixed(3)}`;
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
  const g = world.gardeners.find((q) => Math.hypot(q.x - x - 0.5, q.y - y - 0.5) < 4);
  if (g) {
    line2 += (line2 ? "\n" : "") + `${g.name} (${g.alive ? g.mode() : "dead"}): ${g.status} · fat ${Math.max(0, g.fat).toFixed(1)} · nutrients ${g.nutrients.toFixed(3)}` + (g.doing && g.alive ? `\n  doing: ${g.doing}` : "");
  }
  // The nearest critter under the cursor (sharks first, they're bigger).
  for (const sys of [world.rocs, world.sharks, world.cats, world.sheep, world.fish]) {
    const c = sys.nearest(x + 0.5, y + 0.5, sys === world.fish ? 2.5 : 4);
    if (!c) continue;
    const tr = sys.species.traits.map((d, j) => `${d.label.toLowerCase()} ${j === T_LITTER ? c.traits[j].toFixed(1) : fmtNum(c.traits[j])}`).join(", ");
    line2 += (line2 ? "\n" : "") +
      `${sys.species.name} #${c.id} (${c.mode === Mode.Stranded ? sys.species.stranded : MODE_NAMES[c.mode]}${c.boostLeft > 0 ? ", boosting" : ""}${c.pounceLeft > 0 ? ", pouncing" : ""}${sys === world.rocs ? (c.flying ? ", flying" : ", on the ground") : ""}): age ${c.age} · size ${bodyMass(c).toFixed(2)}${c.grown < 1 ? ` (${Math.round(c.grown * 100)}% grown)` : ""} · fat ${c.fat.toFixed(2)}${c.gutFat + c.gutN > 0.005 ? ` · digesting ${(c.gutFat + c.gutN).toFixed(2)}` : ""}${c.womb ? ` · pregnant with ${c.womb.young.length} (${Math.round((100 * c.womb.gotN) / (c.womb.gotN + c.womb.needN))}% along)` : ""} · nutrients ${c.nutrients.toFixed(3)}` +
      (c.parents[0] ? ` · parents #${c.parents[0]} & #${c.parents[1]}` : " · founder") + `\n  traits: ${tr}`;
    break;
  }
  inspectEl.textContent = line1 + (line2 ? "\n" + line2 : "");
}

function setRunning(r: boolean): void {
  running = r;
  playBtn.textContent = !started ? "Start" : r ? "Pause" : "Play";
}

playBtn.addEventListener("click", () => {
  if (!started) startWorld();
  else setRunning(!running);
});
$<HTMLButtonElement>("step").addEventListener("click", () => {
  setRunning(false);
  world.step();
  refreshStats();
});
$<HTMLButtonElement>("restart").addEventListener("click", () => {
  newWorld(world.terrain.seed);
  if (!started) startWorld();
});
$<HTMLButtonElement>("setupNew").addEventListener("click", setUpNewWorld);
$<HTMLButtonElement>("randomSeed").addEventListener("click", () => {
  seedInput.value = String(Math.floor(Math.random() * 1e6));
  startConditionsChanged();
});
seedInput.addEventListener("input", startConditionsChanged);
startBtn.addEventListener("click", startWorld);
viewSel.addEventListener("change", draw);
function eventCell(e: MouseEvent): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  const x = Math.floor(((e.clientX - r.left) / r.width) * GRID_W);
  const y = Math.floor(((e.clientY - r.top) / r.height) * GRID_H);
  return { x: Math.max(0, Math.min(GRID_W - 1, x)), y: Math.max(0, Math.min(GRID_H - 1, y)) };
}

/** Gardener tool: puts a gardener (with their boat) on the land clicked, or the nearest land. */
function placeGardener(e: MouseEvent): void {
  const { x, y } = eventCell(e);
  const g = world.addGardener(x, y);
  if (!g) {
    inspectEl.textContent = "No land near there for a gardener to stand on.";
    return;
  }
  attachBrain();
  gardenerShown = world.gardeners.indexOf(g);
  thoughtsShown = "";
  gardenerCard();
  draw();
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
  else if (tool === "gardener") placeGardener(e);
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
  if (e.key === "m") {
    setSound(!sound.enabled);
  } else if (e.key === "Escape") {
    setSelection(null);
  } else if (e.key === " ") {
    e.preventDefault();
    if (!started) startWorld();
    else setRunning(!running);
  } else if (e.key === ".") {
    setRunning(false);
    world.step();
    refreshStats();
  } else if (TOOL_KEYS[e.key]) {
    setTool(TOOL_KEYS[e.key]);
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

// Sidebar tabs.
const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('nav.tabs [role="tab"]'));
function selectTab(tab: HTMLButtonElement): void {
  for (const t of tabs) {
    const selected = t === tab;
    t.setAttribute("aria-selected", String(selected));
    $<HTMLElement>(t.getAttribute("aria-controls")!).hidden = !selected;
  }
}
for (const t of tabs) t.addEventListener("click", () => selectTab(t));

setupCards(document.querySelector<HTMLElement>(".cards")!);

setCritterTraitsHook(() => {
  world.fish.reexpress();
  world.sharks.reexpress();
  world.sheep.reexpress();
  world.cats.reexpress();
  world.rocs.reexpress();
});
const refreshSettings = buildSettings("settings", (s) => !s.newWorld);
const refreshStartSettings = buildSettings("startSettings", (s) => !!s.newWorld, startConditionsChanged);
$<HTMLButtonElement>("resetSettings").addEventListener("click", () => {
  for (const s of SETTINGS) if (!s.newWorld && s.defaultValue !== undefined) s.set(s.defaultValue);
  refreshSettings();
});
$<HTMLButtonElement>("starterPop").addEventListener("click", () => {
  Object.assign(PARAMS, STARTER_POPULATION);
  refreshStartSettings();
  startConditionsChanged();
});
$<HTMLButtonElement>("resetStart").addEventListener("click", () => {
  for (const s of SETTINGS) if (s.newWorld && s.defaultValue !== undefined) s.set(s.defaultValue);
  refreshStartSettings();
  startConditionsChanged();
});

refreshBrushLabels();
newWorld(1337);
setRunning(false);
refreshStartPanel();
setTool("select");
requestAnimationFrame((t) => {
  lastFrame = t;
  requestAnimationFrame(loop);
});
