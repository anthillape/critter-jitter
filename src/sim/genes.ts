import type { Rng } from "./rng";

/** Gene indices. Every organism stores GENE_COUNT floats. */
export const G_GROWTH = 0; // nutrients taken up per tick while growing
export const G_BREED = 1; // chance per tick of breeding once fully grown
export const G_RANGE = 2; // max seed throw distance in squares (grass only)
export const G_GERM = 3; // ticks a seed waits before germinating (grass only)
export const G_MUTATION = 4; // max fractional change applied to every gene in a child
export const G_LIFESPAN = 5; // age (ticks) at which the organism dies
export const G_WATER_PREF = 6; // soil saturation (0..1) the plant works best at (grass only)
export const G_WATER_TOL = 7; // how far from its preference it still copes (grass only)
export const GENE_COUNT = 8;

export const GENE_NAMES = ["growth", "breed", "range", "germ", "mutation", "lifespan", "water pref", "water tol"];
/** Genes that have no effect on algae. */
export const ALGAE_UNUSED_GENES: ReadonlySet<number> = new Set([G_RANGE, G_GERM, G_WATER_PREF, G_WATER_TOL]);

/** [min, max] clamp for each gene so evolution can't produce nonsense values. */
export const GENE_LIMITS: ReadonlyArray<readonly [number, number]> = [
  [0.0005, 0.05],
  [0.0005, 0.2],
  [1, 40],
  [1, 800],
  [0.002, 0.5],
  [100, 30000],
  [0.01, 1],
  [0.05, 1],
];

/** Starting genes for new worlds (editable in the settings panel). */
export const GRASS_DEFAULTS = [0.008, 0.01, 8, 80, 0.05, 3000, 0.525, 0.35];
export const ALGAE_DEFAULTS = [0.006, 0.02, 1, 1, 0.05, 2000, 1, 1];

/**
 * Copies genes from parent slot `src` to child slot `dst`. Every gene mutates
 * on every birth: it is scaled by a random factor in [1 - m, 1 + m], where m
 * is the parent's mutation gene (which mutates the same way).
 */
export function inheritGenes(genes: Float32Array, src: number, dst: number, rng: Rng): void {
  const s = src * GENE_COUNT;
  const d = dst * GENE_COUNT;
  const m = genes[s + G_MUTATION];
  for (let g = 0; g < GENE_COUNT; g++) {
    const [lo, hi] = GENE_LIMITS[g];
    const v = genes[s + g] * (1 + (rng() * 2 - 1) * m);
    genes[d + g] = v < lo ? lo : v > hi ? hi : v;
  }
}

export function setGenes(genes: Float32Array, dst: number, values: readonly number[]): void {
  genes.set(values, dst * GENE_COUNT);
}
