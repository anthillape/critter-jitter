import { GRID_W } from "./config";
import type { Navigator } from "./navigate";
import type { World } from "./world";

/**
 * The gardener's survey of the world: the separate land masses and bodies
 * of water (contiguous areas on the route planner's coarse grid, so a
 * one-square stream doesn't split a land mass), and what lives in each.
 */

export const SPECIES_NAMES = ["fish", "shark", "sheep", "cat", "roc"] as const;
export type SpeciesName = (typeof SPECIES_NAMES)[number];

/** Who eats what. Rocs fly, so they hunt over any land or water. */
export const DIET: Record<SpeciesName, { plant?: "grass" | "algae"; prey?: SpeciesName[] }> = {
  fish: { plant: "algae" },
  sheep: { plant: "grass" },
  shark: { prey: ["fish", "sheep"] },
  cat: { prey: ["sheep", "roc"] },
  roc: { prey: ["fish", "sheep"] },
};

/** Where each species lives ("air": anywhere, it flies). */
export const HABITAT: Record<SpeciesName, "water" | "land" | "air"> = {
  fish: "water",
  shark: "water",
  sheep: "land",
  cat: "land",
  roc: "air",
};

/** The species that eat `s`. */
export function predatorsOf(s: SpeciesName): SpeciesName[] {
  return SPECIES_NAMES.filter((q) => DIET[q].prey?.includes(s));
}

export interface Region {
  id: number;
  water: boolean;
  /** Squares it covers (roughly: coarse cells × 9). */
  size: number;
  /** A short name with a compass direction, e.g. "lake 2 (north-west)". */
  name: string;
  grass: number;
  seeds: number;
  algae: number;
  /** Empty, damp land squares where seeds would do well. */
  bare: number;
  animals: Record<SpeciesName, number>;
  /** Where its plant food is thickest (or its middle, if it has none). */
  foodSpot: { x: number; y: number };
  /** Where its bare damp ground is thickest. */
  bareSpot: { x: number; y: number };
  /** Where most of its seeds lie. */
  seedSpot: { x: number; y: number };
}

export interface Survey {
  regions: Region[];
  /** Regions big enough to matter (not puddles or islets). */
  major: Region[];
  /** The region an (x, y) point is in. */
  at(x: number, y: number): Region;
  /** The region an animal was in when the survey was taken. */
  of(c: { x: number; y: number }): Region;
}

const MAJOR_CELLS = 15; // coarse cells (about 135 squares) for a region to count as a land mass or a lake

const cache = new WeakMap<World, { tick: number; s: Survey }>();

/** The survey for this tick, shared by every gardener (worked out at most once per tick). */
export function survey(w: World, nav: Navigator): Survey {
  const c = cache.get(w);
  if (c && c.tick === w.tick) return c.s;
  const s = takeSurvey(w, nav);
  cache.set(w, { tick: w.tick, s });
  return s;
}

function takeSurvey(w: World, nav: Navigator): Survey {
  nav.refresh(w.tick);
  const { cw, ch } = nav;
  const cells = cw * ch;
  const label = new Int32Array(cells).fill(-1);
  const queue = new Int32Array(cells);
  const regions: Region[] = [];
  const sumX: number[] = [], sumY: number[] = [];
  // Flood-fill contiguous land and water (4-connected).
  for (let c0 = 0; c0 < cells; c0++) {
    if (label[c0] >= 0) continue;
    const water = nav.isWaterCell(c0);
    const id = regions.length;
    let head = 0, tail = 0, n = 0, sx = 0, sy = 0;
    label[c0] = id;
    queue[tail++] = c0;
    while (head < tail) {
      const c = queue[head++];
      n++;
      const cx = c % cw, cy = (c / cw) | 0;
      sx += cx;
      sy += cy;
      const nb = [cx > 0 ? c - 1 : -1, cx < cw - 1 ? c + 1 : -1, cy > 0 ? c - cw : -1, cy < ch - 1 ? c + cw : -1];
      for (const d of nb) {
        if (d < 0 || label[d] >= 0 || nav.isWaterCell(d) !== water) continue;
        label[d] = id;
        queue[tail++] = d;
      }
    }
    sumX.push(sx);
    sumY.push(sy);
    const mid = { x: 0, y: 0 };
    regions.push({
      id, water, size: n * 9, name: "",
      grass: 0, seeds: 0, algae: 0, bare: 0,
      animals: { fish: 0, shark: 0, sheep: 0, cat: 0, roc: 0 },
      foodSpot: mid, bareSpot: mid, seedSpot: mid,
    });
  }
  // Plants and bare ground per cell.
  const food = new Float32Array(cells), bare = new Float32Array(cells), seeds = new Float32Array(cells);
  for (let i = 0; i < w.kind.length; i++) {
    const c = nav.cellOf(i % GRID_W, (i / GRID_W) | 0);
    const r = regions[label[c]];
    const k = w.kind[i];
    if (k === 2) (r.grass++, food[c]++);
    else if (k === 1) (r.seeds++, food[c]++, seeds[c]++);
    else if (k === 3) (r.algae++, food[c]++);
    else if (k === 0 && !w.water.isWater(i) && w.water.saturation(i) > 0.3) (r.bare++, bare[c]++);
  }
  // The densest cell of each kind per region (or the cell nearest its middle).
  const centreOf = (c: number) => ({ x: (c % cw) * 3 + 1.5, y: ((c / cw) | 0) * 3 + 1.5 });
  const bestFood = new Float32Array(regions.length).fill(-1);
  const bestBare = new Float32Array(regions.length).fill(-1);
  const bestSeed = new Float32Array(regions.length).fill(-1);
  const nearMid = new Float32Array(regions.length).fill(Infinity);
  for (let c = 0; c < cells; c++) {
    const id = label[c];
    const r = regions[id];
    const n = r.size / 9;
    const d = (c % cw - sumX[id] / n) ** 2 + (((c / cw) | 0) - sumY[id] / n) ** 2;
    if (d < nearMid[id]) {
      nearMid[id] = d;
      if (bestFood[id] <= 0) r.foodSpot = centreOf(c);
      if (bestBare[id] <= 0) r.bareSpot = centreOf(c);
      if (bestSeed[id] <= 0) r.seedSpot = centreOf(c);
    }
    if (food[c] > 0 && food[c] > bestFood[id]) (bestFood[id] = food[c]), (r.foodSpot = centreOf(c));
    if (bare[c] > 0 && bare[c] > bestBare[id]) (bestBare[id] = bare[c]), (r.bareSpot = centreOf(c));
    if (seeds[c] > 0 && seeds[c] > bestSeed[id]) (bestSeed[id] = seeds[c]), (r.seedSpot = centreOf(c));
  }
  // Animals.
  const sys = { fish: w.fish, shark: w.sharks, sheep: w.sheep, cat: w.cats, roc: w.rocs };
  for (const s of SPECIES_NAMES) {
    for (const c of sys[s].critters) regions[label[nav.cellOf(c.x, c.y)]].animals[s]++;
  }
  // Names: numbered by size within land and water, with a compass direction.
  const major = regions.filter((r) => r.size >= MAJOR_CELLS * 9).sort((a, b) => b.size - a.size);
  let lands = 0, lakes = 0;
  const isMajor = new Set(major);
  for (const r of [...major, ...regions.filter((q) => !isMajor.has(q))]) {
    const n = r.size / 9;
    const where = compass(sumX[r.id] / n / cw, sumY[r.id] / n / ch);
    r.name = !isMajor.has(r)
      ? `${r.water ? "a pond" : "an islet"} (${where})`
      : r.water ? `lake ${++lakes} (${where})` : `land ${String.fromCharCode(65 + (lands++ % 26))} (${where})`;
  }
  // Which region each animal is in (looked up a lot when weighing options).
  const where = new Map<object, Region>();
  for (const s of SPECIES_NAMES) for (const c of sys[s].critters) where.set(c, regions[label[nav.cellOf(c.x, c.y)]]);
  return {
    regions,
    major,
    at: (x, y) => regions[label[nav.cellOf(x, y)]],
    of: (c) => where.get(c) ?? regions[label[nav.cellOf(c.x, c.y)]],
  };
}

function compass(fx: number, fy: number): string {
  const ns = fy < 0.33 ? "north" : fy > 0.67 ? "south" : "";
  const ew = fx < 0.33 ? "west" : fx > 0.67 ? "east" : "";
  return ns && ew ? `${ns}-${ew}` : ns || ew || "middle";
}

/** Food in a region for a species: its plants, or its prey there. */
export function foodIn(r: Region, s: SpeciesName): number {
  const d = DIET[s];
  if (d.plant) return d.plant === "grass" ? r.grass + r.seeds : r.algae;
  return (d.prey ?? []).reduce((a, q) => a + r.animals[q], 0);
}

/** Whether a species can live in a region. */
export function suits(r: Region, s: SpeciesName): boolean {
  const h = HABITAT[s];
  return h === "air" || (h === "water") === r.water;
}
