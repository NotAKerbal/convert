import type { FileData, FileFormat, FormatHandler } from "../FormatHandler.ts";
import {
  EMPTY_TEXT_MESSAGE,
  KOKORO_DEFAULT_VOICE,
  KOKORO_DOWNLOAD_MB,
  NO_IMAGE_TEXT_MESSAGE,
  NarrationError,
  cleanOcrText,
  decodeTextBytes,
  encodeWavPcm16,
  prepareNarration,
  type NarrationChunk,
} from "../lib/narration.ts";
import { NARRATION_HANDLER_NAME } from "../lib/routeSearch.ts";
import type { NarrationWorkerMessage, NarrationWorkerRequest } from "./narration.worker.ts";

// Reads text files and the text in images aloud with Kokoro, a small neural
// text-to-speech model that runs entirely in the browser. Nothing is
// downloaded until the first narration; the model is then cached.

/** Free the model's memory after this long without a narration request. */
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

const image = (name: string, format: string, extension: string, mime: string): FileFormat =>
  ({ name, format, extension, mime, from: true, to: false, internal: "image" });

const megabytes = (bytes: number) => Math.round(bytes / (1024 * 1024));

interface SpeakResult { samples: Float32Array; sampleRate: number; device: string; dtype: string }

/** Owns the Kokoro worker: starts it on demand and stops it when idle. */
class KokoroSpeaker {
  #worker: Worker | null = null;
  #nextId = 1;
  #idleTimer: ReturnType<typeof setTimeout> | null = null;
  #pending = new Map<number, {
    resolve: (result: SpeakResult) => void;
    reject: (err: Error) => void;
    onMessage: (message: NarrationWorkerMessage) => void;
  }>();

  #start() {
    if (this.#worker) return this.#worker;
    const worker = new Worker(new URL("./narration.worker.ts", import.meta.url), { type: "module" });
    worker.addEventListener("message", (event: MessageEvent<NarrationWorkerMessage>) => {
      const message = event.data;
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      if (message.type === "done") {
        this.#pending.delete(message.id);
        pending.resolve(message);
      } else if (message.type === "error") {
        this.#pending.delete(message.id);
        pending.reject(new Error(message.message));
      } else {
        pending.onMessage(message);
      }
    });
    worker.addEventListener("error", (event) => {
      event.preventDefault();
      this.#fail(new Error(event.message || "The speech worker stopped unexpectedly."));
    });
    this.#worker = worker;
    return worker;
  }

  #fail(err: Error) {
    for (const pending of this.#pending.values()) pending.reject(err);
    this.#pending.clear();
    this.dispose();
  }

  dispose() {
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    this.#idleTimer = null;
    this.#worker?.terminate();
    this.#worker = null;
  }

  speak(chunks: NarrationChunk[], onMessage: (message: NarrationWorkerMessage) => void) {
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    this.#idleTimer = null;
    const worker = this.#start();
    const id = this.#nextId++;
    return new Promise<SpeakResult>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject, onMessage });
      const request: NarrationWorkerRequest = { type: "speak", id, chunks, voice: KOKORO_DEFAULT_VOICE };
      worker.postMessage(request);
    }).finally(() => {
      if (this.#pending.size === 0) {
        this.#idleTimer = setTimeout(() => this.dispose(), IDLE_TIMEOUT_MS);
      }
    });
  }
}

class narrationHandler implements FormatHandler {

  public name: string = NARRATION_HANDLER_NAME;
  public supportedFormats: FileFormat[] = [
    { name: "Plain Text", format: "text", extension: "txt", mime: "text/plain", from: true, to: false, internal: "text" },
    image("Portable Network Graphics", "png", "png", "image/png"),
    image("Joint Photographic Experts Group JFIF", "jpeg", "jpg", "image/jpeg"),
    image("WebP", "webp", "webp", "image/webp"),
    image("CompuServe Graphics Interchange Format (GIF)", "gif", "gif", "image/gif"),
    image("Windows Bitmap", "bmp", "bmp", "image/bmp"),
    image("Scalable Vector Graphics", "svg", "svg", "image/svg+xml"),
    {
      name: "Waveform Audio File Format (spoken narration)",
      format: "wav",
      extension: "wav",
      mime: "audio/wav",
      from: false,
      to: true,
      internal: "speech"
    },
  ];
  public ready: boolean = false;
  public onProgress?: (message: string) => void;

  #speaker = new KokoroSpeaker();

  // Deliberately cheap: OCR and the voice model load on first conversion.
  async init() {
    this.ready = true;
  }

  async doConvert(
    inputFiles: FileData[],
    inputFormat: FileFormat,
    outputFormat: FileFormat
  ): Promise<FileData[]> {
    if (outputFormat.internal !== "speech") throw new Error("Narration only produces WAV audio.");
    const outputFiles: FileData[] = [];
    const prefix = (i: number) => (inputFiles.length > 1 ? `${inputFiles[i].name}: ` : "");

    for (let i = 0; i < inputFiles.length; i++) {
      const file = inputFiles[i];
      const report = (message: string) => this.onProgress?.(prefix(i) + message);

      let chunks: NarrationChunk[];
      if (inputFormat.internal === "text") {
        chunks = prepareNarration(decodeTextBytes(file.bytes), EMPTY_TEXT_MESSAGE).chunks;
      } else {
        let recognized: { text: string; confidence: number };
        try {
          const { recognizeImageText } = await import("./narrationOcr.ts");
          recognized = await recognizeImageText(file.bytes, inputFormat.mime, report);
        } catch (err) {
          throw new NarrationError(`Couldn't read text from ${file.name}: ${errorText(err)}`);
        }
        const prepared = prepareNarration(cleanOcrText(recognized.text), NO_IMAGE_TEXT_MESSAGE);
        console.info(`[narration] OCR confidence ${Math.round(recognized.confidence)}%:`, prepared.text);
        chunks = prepared.chunks;
      }

      let result: SpeakResult;
      try {
        result = await this.#speaker.speak(chunks, (message) => {
          if (message.type === "loading") {
            const expected = KOKORO_DOWNLOAD_MB[message.device];
            report(
              `Loading the Kokoro voice model (${megabytes(message.loaded)} of ${megabytes(message.total) || expected} MB). `
              + `The first narration downloads it once from Hugging Face; after that it is cached in your browser.`
            );
          } else if (message.type === "loaded") {
            const threading = self.crossOriginIsolated ? "multi-threaded" : "single-threaded";
            console.info(`[narration] Kokoro ready on ${message.device} (${message.dtype}, ${threading})`);
            report(`Voice model ready (${message.device === "webgpu" ? "WebGPU" : "CPU"}). Starting narration`);
          } else if (message.type === "chunk") {
            report(`Speaking part ${message.index + 1} of ${message.total}`);
          }
        });
      } catch (err) {
        throw new NarrationError(
          `Narration failed: ${errorText(err)}. The voice model is downloaded from Hugging Face on first use, `
          + `so check your connection and try again.`
        );
      }
      console.info(`[narration] Spoke ${chunks.length} chunk(s) with Kokoro on ${result.device} (${result.dtype})`);

      const name = file.name.replace(/\.[^.]*$/, "") + "." + outputFormat.extension;
      outputFiles.push({ name, bytes: encodeWavPcm16(result.samples, result.sampleRate) });
    }

    return outputFiles;
  }
}

function errorText(err: unknown) {
  const text = err instanceof Error ? err.message : String(err);
  return text.replace(/[.\s]+$/, "") || "unknown error";
}

export default narrationHandler;
