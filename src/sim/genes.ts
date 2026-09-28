import type { Rng } from "./rng";

/** Gene indices. Every organism stores GENE_COUNT floats. */
export const G_GROWTH = 0; // nutrients taken up per tick while growing
export const G_BREED = 1; // chance per tick of breeding once fully grown
export const G_RANGE = 2; // max seed throw distance in squares (grass only)
export const G_GERM = 3; // ticks a seed waits before germinating (grass only)
export const G_MUTATION = 4; // chance that each gene mutates in a child
export const G_LIFESPAN = 5; // age (ticks) at which the organism dies
export const GENE_COUNT = 6;

export const GENE_NAMES = ["growth", "breed", "range", "germ", "mutation", "lifespan"];

/** [min, max] clamp for each gene so evolution can't produce nonsense values. */
export const GENE_LIMITS: ReadonlyArray<readonly [number, number]> = [
  [0.0005, 0.05],
  [0.0005, 0.2],
  [1, 40],
  [1, 800],
  [0.001, 1],
  [100, 30000],
];

export const GRASS_DEFAULTS = [0.008, 0.01, 8, 80, 0.2, 3000];
export const ALGAE_DEFAULTS = [0.006, 0.02, 1, 1, 0.2, 2000];

/**
 * Copies genes from parent slot `src` to child slot `dst`, where each gene
 * has a chance (the parent's mutation gene) of drifting slightly.
 */
export function inheritGenes(
  genes: Float32Array,
  src: number,
  dst: number,
  rng: Rng,
  step: number,
): void {
  const s = src * GENE_COUNT;
  const d = dst * GENE_COUNT;
  const rate = genes[s + G_MUTATION];
  for (let g = 0; g < GENE_COUNT; g++) {
    let v = genes[s + g];
    if (rng() < rate) {
      v *= 1 + (rng() * 2 - 1) * step;
      const [lo, hi] = GENE_LIMITS[g];
      v = v < lo ? lo : v > hi ? hi : v;
    }
    genes[d + g] = v;
  }
}

export function setGenes(genes: Float32Array, dst: number, values: readonly number[]): void {
  genes.set(values, dst * GENE_COUNT);
}
