/// <reference lib="webworker" />
/**
 * The gardener's optional brain: a tiny open language model
 * (SmolLM2-135M-Instruct, about 100 MB, downloaded once from Hugging Face
 * and cached by the browser) run entirely in the browser with
 * transformers.js, on the GPU (WebGPU) where available, else the CPU (WASM).
 * It's asked to pick one of a short list of numbered options and replies
 * with a number.
 *
 * Messages in:  { type: "load" } | { type: "ask", id, system, user }
 * Messages out: { type: "progress", text } | { type: "ready", device }
 *             | { type: "answer", id, text } | { type: "error", id?, message }
 */
import { pipeline, type TextGenerationPipeline } from "@huggingface/transformers";

const MODEL = "HuggingFaceTB/SmolLM2-135M-Instruct";
let gen: TextGenerationPipeline | null = null;
let loading: Promise<void> | null = null;

function post(m: unknown): void {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);
}

async function load(): Promise<void> {
  const files = new Map<string, number>();
  const progress = (e: { status: string; file?: string; progress?: number }) => {
    if (e.status === "progress" && e.file) {
      files.set(e.file, e.progress ?? 0);
      const all = [...files.values()];
      post({ type: "progress", text: `downloading the model: ${Math.round(all.reduce((a, b) => a + b, 0) / all.length)}%` });
    }
  };
  const gpu = "gpu" in navigator;
  const attempts: Array<{ device: "webgpu" | "wasm"; dtype: "q4" | "q8" | "fp32" }> = gpu
    ? [{ device: "webgpu", dtype: "q4" }, { device: "wasm", dtype: "q8" }]
    : [{ device: "wasm", dtype: "q8" }, { device: "wasm", dtype: "fp32" }];
  let last: unknown = null;
  for (const a of attempts) {
    try {
      post({ type: "progress", text: `loading the model (${a.device === "webgpu" ? "GPU" : "CPU"})…` });
      gen = (await pipeline("text-generation", MODEL, { device: a.device, dtype: a.dtype, progress_callback: progress })) as TextGenerationPipeline;
      post({ type: "ready", device: a.device === "webgpu" ? "GPU" : "CPU" });
      return;
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

self.onmessage = async (ev: MessageEvent) => {
  const m = ev.data as { type: string; id?: number; system?: string; user?: string };
  try {
    if (m.type === "load" || m.type === "ask") {
      loading ??= load();
      await loading;
    }
    if (m.type === "ask" && gen) {
      const out = await gen(
        [
          { role: "system", content: m.system! },
          { role: "user", content: m.user! },
        ],
        { max_new_tokens: 4, do_sample: false },
      );
      const msgs = (out as Array<{ generated_text: Array<{ role: string; content: string }> }>)[0].generated_text;
      post({ type: "answer", id: m.id, text: msgs[msgs.length - 1].content });
    }
  } catch (e) {
    loading = null;
    post({ type: "error", id: m.id, message: e instanceof Error ? e.message : String(e) });
  }
};
