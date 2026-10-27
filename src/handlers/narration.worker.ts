import { KokoroTTS, env } from "kokoro-js";
import {
  KOKORO_DEFAULT_VOICE,
  KOKORO_MODEL_ID,
  KOKORO_SAMPLE_RATE,
  halveChunkText,
  hasSpeakableText,
  joinAudioSegments,
  type NarrationChunk,
} from "../lib/narration.ts";

// Runs Kokoro text-to-speech off the main thread. The model is downloaded
// from the Hugging Face Hub on first use (then served from the browser cache)
// and kept loaded for later requests until the page terminates this worker.

export type NarrationWorkerRequest = {
  type: "speak";
  id: number;
  chunks: NarrationChunk[];
  voice?: string;
};

export type NarrationWorkerMessage =
  | { type: "loading"; id: number; device: Device; loaded: number; total: number }
  | { type: "loaded"; id: number; device: Device; dtype: string }
  | { type: "chunk"; id: number; index: number; total: number }
  | { type: "done"; id: number; samples: Float32Array; sampleRate: number; device: Device; dtype: string }
  | { type: "error"; id: number; message: string };

type Device = "webgpu" | "wasm";
interface LoadedModel { tts: KokoroTTS; device: Device; dtype: "fp32" | "q8"; maxTokens: number }

// Serve ONNX Runtime from this site (copied by scripts/copy-wasm.mjs) rather
// than the CDN transformers.js would otherwise use.
env.wasmPaths = new URL("/wasm/ort/", self.location.origin).href;

class ChunkTooLongError extends Error {}

const post = (message: NarrationWorkerMessage, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(message, transfer);

let model: Promise<LoadedModel> | null = null;

async function hasWebGPU() {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return Boolean(gpu && (await gpu.requestAdapter()));
  } catch {
    return false;
  }
}

async function loadModel(device: Device, id: number): Promise<LoadedModel> {
  // WebGPU runs the full-precision model (recommended by Kokoro for WebGPU);
  // the WASM fallback uses the 8-bit model, which is far faster on CPU.
  const dtype = device === "webgpu" ? "fp32" : "q8";
  const files = new Map<string, { loaded: number; total: number }>();
  const tts = await KokoroTTS.from_pretrained(KOKORO_MODEL_ID, {
    dtype,
    device,
    progress_callback: (info) => {
      if (info.status !== "progress") return;
      files.set(info.file, { loaded: info.loaded, total: info.total });
      let loaded = 0, total = 0;
      for (const file of files.values()) { loaded += file.loaded; total += file.total; }
      post({ type: "loading", id, device, loaded, total });
    },
  });

  // Kokoro truncates input beyond its context window without telling us.
  // Refuse such input instead so the caller can split it and keep every word.
  const tokenizer = tts.tokenizer;
  const maxTokens = Number.isFinite(tokenizer.model_max_length) && tokenizer.model_max_length < 4096
    ? tokenizer.model_max_length
    : 512;
  const guarded = (text: string, options: Record<string, unknown> = {}) => {
    const encoded = tokenizer(text, { ...options, truncation: false });
    if ((encoded.input_ids.dims.at(-1) ?? 0) > maxTokens) throw new ChunkTooLongError();
    return encoded;
  };
  (tts as unknown as { tokenizer: unknown }).tokenizer = guarded;

  post({ type: "loaded", id, device, dtype });
  return { tts, device, dtype, maxTokens };
}

async function getModel(id: number) {
  if (!model) {
    model = (async () => {
      if (await hasWebGPU()) {
        try {
          return await loadModel("webgpu", id);
        } catch (err) {
          console.warn("Kokoro failed to load on WebGPU; falling back to WASM.", err);
        }
      }
      return loadModel("wasm", id);
    })();
    model.catch(() => { model = null; });
  }
  return model;
}

async function speak(loaded: LoadedModel, text: string, voice: string): Promise<Float32Array[]> {
  if (!hasSpeakableText(text)) return [];
  try {
    const audio = await loaded.tts.generate(text, { voice: voice as never, speed: 1 });
    return [audio.audio];
  } catch (err) {
    if (!(err instanceof ChunkTooLongError)) throw err;
    const [first, second] = halveChunkText(text);
    return [...await speak(loaded, first, voice), ...await speak(loaded, second, voice)];
  }
}

async function handleSpeak({ id, chunks, voice = KOKORO_DEFAULT_VOICE }: NarrationWorkerRequest) {
  let loaded = await getModel(id);
  const segments: Array<{ samples: Float32Array; pauseAfterMs: number }> = [];
  for (let index = 0; index < chunks.length; index++) {
    post({ type: "chunk", id, index, total: chunks.length });
    let pieces: Float32Array[];
    try {
      pieces = await speak(loaded, chunks[index].text, voice);
    } catch (err) {
      // Some GPUs load the model but fail at inference. Retry on CPU once.
      if (loaded.device !== "webgpu") throw err;
      console.warn("Kokoro failed on WebGPU; retrying with WASM.", err);
      model = loadModel("wasm", id);
      loaded = await model;
      pieces = await speak(loaded, chunks[index].text, voice);
    }
    pieces.forEach((samples, i) => segments.push({
      samples,
      pauseAfterMs: i === pieces.length - 1 ? chunks[index].pauseAfterMs : 0,
    }));
  }
  const samples = joinAudioSegments(segments, KOKORO_SAMPLE_RATE);
  post({ type: "done", id, samples, sampleRate: KOKORO_SAMPLE_RATE, device: loaded.device, dtype: loaded.dtype }, [samples.buffer]);
}

self.addEventListener("message", (event: MessageEvent<NarrationWorkerRequest>) => {
  const request = event.data;
  if (request?.type !== "speak") return;
  handleSpeak(request).catch((err) => {
    post({ type: "error", id: request.id, message: err instanceof Error ? err.message : String(err) });
  });
});
