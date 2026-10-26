import type { FileData, FileFormat, FormatHandler } from "../FormatHandler.ts";
import normalizeMimeType from "../normalizeMimeType.ts";
import { replaceExtension } from "./handlerUtils.ts";

import { FFmpeg } from "@ffmpeg/ffmpeg";

function interleaveAudioBuffer(buffer: AudioBuffer): Float32Array {
  const { numberOfChannels, length } = buffer;
  const out = new Float32Array(length * numberOfChannels);
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numberOfChannels; ch++) {
      out[i * numberOfChannels + ch] = buffer.getChannelData(ch)[i];
    }
  }
  return out;
}

function floatTo16BitPCM(float32: Float32Array): Uint8Array {
  const buffer = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buffer);
  let offset = 0;
  for (let i = 0; i < float32.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

function writeWavHeader(
  samples: Uint8Array,
  sampleRate: number,
  channels: number,
  bitsPerSample: number,
) {
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const buffer = new ArrayBuffer(44 + samples.length);
  const view = new DataView(buffer);
  let p = 0;
  function writeString(s: string) {
    for (let i = 0; i < s.length; i++) view.setUint8(p++, s.charCodeAt(i));
  }
  writeString("RIFF");
  view.setUint32(p, 36 + samples.length, true);
  p += 4;
  writeString("WAVE");
  writeString("fmt ");
  view.setUint32(p, 16, true);
  p += 4; // Subchunk1Size
  view.setUint16(p, 1, true);
  p += 2; // PCM
  view.setUint16(p, channels, true);
  p += 2;
  view.setUint32(p, sampleRate, true);
  p += 4;
  view.setUint32(p, byteRate, true);
  p += 4;
  view.setUint16(p, blockAlign, true);
  p += 2;
  view.setUint16(p, bitsPerSample, true);
  p += 2;
  writeString("data");
  view.setUint32(p, samples.length, true);
  p += 4;
  // copy samples
  const outU8 = new Uint8Array(buffer);
  outU8.set(samples, 44);
  return outU8;
}

async function decodeWithBrowser(
  bytes: Uint8Array,
): Promise<{ samples: Float32Array; sampleRate: number; channels: number }> {
  if (
    typeof AudioContext === "undefined" &&
    typeof (window as any)?.AudioContext === "undefined"
  ) {
    throw new Error("AudioContext not available");
  }
  const audioCtx = new (globalThis as any).AudioContext();
  try {
    const ab = await audioCtx.decodeAudioData(bytes.buffer.slice(0));
    const samples = interleaveAudioBuffer(ab);
    const sampleRate = ab.sampleRate;
    const channels = ab.numberOfChannels;
    await audioCtx.close();
    return { samples, sampleRate, channels };
  } catch (e) {
    try {
      await audioCtx.close();
    } catch (_) {}
    throw e;
  }
}

export interface DecodedAudio {
  samples: Float32Array;
  sampleRate: number;
  channels: number;
}

/**
 * Parses a RIFF/WAVE file into interleaved Float32 samples, walking the chunk
 * list (encoders often insert LIST/fact chunks, so the data isn't always at
 * byte 44). Supports integer PCM (8/16/24/32-bit) and 32/64-bit float.
 */
export function parseWav(bytes: Uint8Array): DecodedAudio {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (bytes.length < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("Not a WAV file.");

  let format = 0, channels = 0, sampleRate = 0, bitsPerSample = 0;
  let dataOffset = -1, dataLength = 0;
  for (let p = 12; p + 8 <= bytes.length; ) {
    const id = tag(p);
    const size = view.getUint32(p + 4, true);
    const body = p + 8;
    if (id === "fmt ") {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bitsPerSample = view.getUint16(body + 14, true);
      // WAVE_FORMAT_EXTENSIBLE: the real format is the subformat GUID's first 2 bytes.
      if (format === 0xfffe && size >= 26) format = view.getUint16(body + 24, true);
    } else if (id === "data") {
      dataOffset = body;
      // Streaming writers may leave the size as 0 / 0xFFFFFFFF.
      dataLength = Math.min(size || Infinity, bytes.length - body);
      break;
    }
    p = body + size + (size & 1);
  }
  if (!channels || !sampleRate || dataOffset < 0) throw new Error("WAV file is missing fmt or data chunk.");

  const bytesPerSample = bitsPerSample / 8;
  const count = Math.floor(dataLength / bytesPerSample);
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const o = dataOffset + i * bytesPerSample;
    if (format === 3 && bitsPerSample === 32) samples[i] = view.getFloat32(o, true);
    else if (format === 3 && bitsPerSample === 64) samples[i] = view.getFloat64(o, true);
    else if (format === 1 && bitsPerSample === 8) samples[i] = (view.getUint8(o) - 128) / 128;
    else if (format === 1 && bitsPerSample === 16) samples[i] = view.getInt16(o, true) / 0x8000;
    else if (format === 1 && bitsPerSample === 24) {
      const v = view.getUint8(o) | (view.getUint8(o + 1) << 8) | (view.getInt8(o + 2) << 16);
      samples[i] = v / 0x800000;
    } else if (format === 1 && bitsPerSample === 32) samples[i] = view.getInt32(o, true) / 0x80000000;
    else throw new Error(`Unsupported WAV encoding (format ${format}, ${bitsPerSample}-bit).`);
  }
  return { samples, sampleRate, channels };
}

/** Decodes other audio through FFmpeg.wasm (same static worker setup as the FFmpeg handler). */
async function decodeWithFFmpeg(bytes: Uint8Array): Promise<DecodedAudio> {
  const ffmpeg = new FFmpeg();
  try {
    await ffmpeg.load({
      coreURL: "/wasm/ffmpeg-core.js",
      classWorkerURL: `${location.origin}/wasm/ffmpeg/worker.js`
    });
    await ffmpeg.writeFile("infile", bytes);
    const code = await ffmpeg.exec(["-hide_banner", "-i", "infile", "-vn", "-c:a", "pcm_f32le", "-f", "wav", "out.wav"]);
    if (code !== 0) throw new Error(`FFmpeg could not decode the audio (exit code ${code}).`);
    const out = await ffmpeg.readFile("out.wav");
    if (!(out instanceof Uint8Array)) throw new Error("FFmpeg produced no audio.");
    return parseWav(out);
  } finally {
    ffmpeg.terminate();
  }
}

/** Raw PCM carries no header, so these are the assumed stream parameters. */
const RAW_PCM_SAMPLE_RATE = 44100;
const RAW_PCM_CHANNELS = 1;

class floHandler implements FormatHandler {
  public name: string = "floHandler";
  public supportedFormats: FileFormat[] = [];
  public ready: boolean = false;
  #worker?: Worker;
  #workerReady?: Promise<void>;
  #rpcId: number = 1;
  #pending: Map<number, { resolve: (v: any) => void; reject: (e: any) => void }> = new Map();

  async init() {
    try {
      this.#worker = new Worker(new URL("./flo.worker.ts", import.meta.url), { type: "module" });
      this.#workerReady = new Promise((resolve, reject) => {
        this.#worker!.onmessage = (ev: MessageEvent) => {
          const m = ev.data as any;
          if (m && m.id === 0) {
            if (m.type === "ready") return resolve();
            if (m.type === "error") return reject(m.error);
          }
          // route other messages to pending map
          if (m && typeof m.id === 'number' && m.id !== 0) {
            const p = this.#pending.get(m.id);
            if (p) {
              if (m.type === 'decodeResult') p.resolve({ samples: m.samples, sampleRate: m.sampleRate, channels: m.channels });
              else if (m.type === 'encodeResult') p.resolve(m.bytes);
              else if (m.type === 'error') p.reject(m.error);
              this.#pending.delete(m.id);
            }
          }
        };
        // timeout
        setTimeout(() => reject('flo worker init timeout'), 15000);
      });
      await this.#workerReady;
      console.log("floHandler: reflo worker ready");
    } catch (e) {
      console.warn("floHandler: failed to start reflo worker:", e);
      this.#worker = undefined;
    }
    this.supportedFormats = [
      {
        name: "Flo Audio",
        format: "flo",
        extension: "flo",
        mime: normalizeMimeType("audio/flo"),
        from: true,
        to: true,
        internal: "flo",
      },
      {
        name: "WAV (signed 16-bit)",
        format: "wav",
        extension: "wav",
        mime: normalizeMimeType("audio/wav"),
        from: true,
        to: true,
        internal: "wav",
      },
      {
        name: "Raw PCM Float32LE",
        format: "f32le",
        extension: "pcm",
        mime: normalizeMimeType("video/f32le"),
        from: true,
        to: true,
        internal: "f32le",
      },
    ];
    this.ready = true;
  }

  private _workerDecode(bytes: Uint8Array): Promise<{ samples: Float32Array; sampleRate: number; channels: number }> {
    return new Promise((resolve, reject) => {
      if (!this.#worker) return reject('no worker');
      const id = this.#rpcId++;
      this.#pending.set(id, { resolve, reject });
      try {
        this.#worker.postMessage({ id, type: 'decode', bytes }, [bytes.buffer]);
      } catch (e) {
        this.#pending.delete(id);
        reject(e);
      }
    });
  }

  private _workerEncode(samples: Float32Array, sampleRate: number, channels: number, bitDepth: number): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      if (!this.#worker) return reject('no worker');
      const id = this.#rpcId++;
      this.#pending.set(id, { resolve, reject });
      try {
        this.#worker.postMessage({ id, type: 'encode', samples, sampleRate, channels, bitDepth }, [samples.buffer]);
      } catch (e) {
        this.#pending.delete(id);
        reject(e);
      }
    });
  }

  async #reflo() {
    const mod = await import("@flo-audio/reflo");
    await mod.default({ module_or_path: "/wasm/reflo_bg.wasm" });
    return mod;
  }

  async #decodeFlo(bytes: Uint8Array): Promise<DecodedAudio> {
    if (this.#worker) return await this._workerDecode(bytes);
    const mod = await this.#reflo();
    const info = mod.get_flo_file_info(bytes);
    return { samples: mod.decode(bytes), sampleRate: info.sample_rate, channels: info.channels };
  }

  async #encodeFlo(audio: DecodedAudio): Promise<Uint8Array> {
    if (this.#worker) return await this._workerEncode(audio.samples, audio.sampleRate, audio.channels, 32);
    const mod = await this.#reflo();
    return mod.encode(audio.samples, audio.sampleRate, audio.channels, 32, null);
  }

  async #decodeInput(bytes: Uint8Array, inputFormat: FileFormat): Promise<DecodedAudio> {
    if (inputFormat.internal === "f32le") {
      const aligned = new Uint8Array(bytes.byteLength - (bytes.byteLength % 4));
      aligned.set(bytes.subarray(0, aligned.length));
      return { samples: new Float32Array(aligned.buffer), sampleRate: RAW_PCM_SAMPLE_RATE, channels: RAW_PCM_CHANNELS };
    }
    // Parse WAV directly: Web Audio resamples to the device rate.
    try {
      return parseWav(bytes);
    } catch {}
    try {
      return await decodeWithBrowser(new Uint8Array(bytes));
    } catch {
      return await decodeWithFFmpeg(new Uint8Array(bytes));
    }
  }

  async doConvert(
    inputFiles: FileData[],
    inputFormat: FileFormat,
    outputFormat: FileFormat,
  ): Promise<FileData[]> {
    if (!inputFiles || inputFiles.length === 0) throw "No input files";
    if (inputFormat.internal === outputFormat.internal) throw "floHandler: input and output formats are the same.";

    const outputFiles: FileData[] = [];
    for (const file of inputFiles) {
      const bytes = new Uint8Array(file.bytes);
      const audio = inputFormat.internal === "flo"
        ? await this.#decodeFlo(bytes)
        : await this.#decodeInput(bytes, inputFormat);

      let out: Uint8Array;
      if (outputFormat.internal === "flo") {
        out = await this.#encodeFlo(audio);
      } else if (outputFormat.internal === "wav") {
        out = writeWavHeader(floatTo16BitPCM(audio.samples), audio.sampleRate, audio.channels, 16);
      } else if (outputFormat.internal === "f32le") {
        out = new Uint8Array(audio.samples.buffer.slice(
          audio.samples.byteOffset, audio.samples.byteOffset + audio.samples.byteLength
        ));
      } else {
        throw `floHandler: unsupported target ${outputFormat.format}`;
      }
      outputFiles.push({ bytes: new Uint8Array(out), name: replaceExtension(file.name, outputFormat.extension) });
    }
    return outputFiles;
  }
}

export default floHandler;


