import type { FileData, FileFormat, FormatHandler } from "../FormatHandler.ts";

import { FFmpeg } from "@ffmpeg/ffmpeg";
import type { LogEvent } from "@ffmpeg/ffmpeg";

import mime from "mime";
import normalizeMimeType from "../normalizeMimeType.ts";
import { replaceExtension } from "./handlerUtils.ts";

class FFmpegHandler implements FormatHandler {

  public name: string = "FFmpeg";
  public supportedFormats: FileFormat[] = [];
  public ready: boolean = false;

  #ffmpeg?: FFmpeg;

  #stdout: string = "";
  // Bound once so `off()` removes the same listener `on()` added; binding
  // inline leaked one listener per call and duplicated every log line.
  #handleStdout = (log: LogEvent) => {
    this.#stdout += log.message + "\n";
  };
  clearStdout () {
    this.#stdout = "";
  }
  async getStdout (callback: () => void | Promise<void>) {
    if (!this.#ffmpeg) return "";
    this.clearStdout();
    this.#ffmpeg.on("log", this.#handleStdout);
    try {
      await callback();
    } finally {
      this.#ffmpeg.off("log", this.#handleStdout);
    }
    return this.#stdout;
  }

  async loadFFmpeg () {
    if (!this.#ffmpeg) return;
    // `classWorkerURL` is resolved against the bundle's `import.meta.url`, which
    // webpack rewrites to a `file://` path — so it must be an absolute URL with
    // an origin. `coreURL` is fetched from inside the worker (an http origin),
    // so a root-relative path is fine there.
    const origin = typeof location !== "undefined" ? location.origin : "";
    return await this.#ffmpeg.load({
      coreURL: "/wasm/ffmpeg-core.js",
      // Static, unbundled ESM worker (see scripts/copy-wasm.mjs).
      classWorkerURL: `${origin}/wasm/ffmpeg/worker.js`
    });
  }
  terminateFFmpeg () {
    if (!this.#ffmpeg) return;
    this.#ffmpeg.terminate();
  }
  async reloadFFmpeg () {
    if (!this.#ffmpeg) return;
    this.terminateFFmpeg();
    await this.loadFFmpeg();
  }
  /**
   * FFmpeg tends to run out of memory (?) with an "index out of bounds"
   * message sometimes. Other times it just stalls, irrespective of any timeout.
   *
   * This wrapper restarts FFmpeg when it crashes with that OOB error, and
   * forces a Promise-level timeout as a fallback for when it stalls.
   * @param args CLI arguments, same as in `FFmpeg.exec()`.
   * @param timeout Max execution time in milliseconds. `-1` for no timeout (default).
   * @param attempts Amount of times to attempt execution. Default is 1.
   */
  async execSafe (args: string[], timeout: number = -1, attempts: number = 1): Promise<void> {
    if (!this.#ffmpeg) throw "Handler not initialized.";
    try {
      if (timeout === -1) {
        await this.#ffmpeg.exec(args);
      } else {
        await Promise.race([
          this.#ffmpeg.exec(args, timeout),
          new Promise((_, reject) => setTimeout(reject, timeout))
        ]);
      }
    } catch (e) {
      if (!e || (
        typeof e === "string"
        && e.includes("out of bounds")
        && attempts > 1
      )) {
        await this.reloadFFmpeg();
        return await this.execSafe(args, timeout, attempts - 1);
      }
      console.error(e);
      throw e;
    }
  }

  #initPromise?: Promise<void>;

  /**
   * Probing every muxer takes a while, and the background warm-up can overlap
   * with a conversion that also calls `init()`. Share one in-flight run so two
   * probes don't fight over (and terminate) the same FFmpeg instance.
   */
  init () {
    this.#initPromise ??= this.#init().catch((e) => {
      this.#initPromise = undefined;
      throw e;
    });
    return this.#initPromise;
  }

  async #init () {

    this.supportedFormats = [];
    this.#ffmpeg = new FFmpeg();
    await this.loadFFmpeg();

    const getMuxerDetails = async (muxer: string) => {

      const stdout = await this.getStdout(async () => {
        await this.execSafe(["-hide_banner", "-h", "muxer=" + muxer], 3000, 5);
      });

      return {
        extension: stdout.split("Common extensions: ")[1].split(".")[0].split(",")[0],
        mimeType: stdout.split("Mime type: ")[1].split("\n")[0].split(".").slice(0, -1).join(".")
      };
    }

    const stdout = await this.getStdout(async () => {
      await this.execSafe(["-formats", "-hide_banner"], 3000, 5);
    });
    const lines = stdout.split(" --\n")[1].split("\n");

    for (let line of lines) {

      let len;
      do {
        len = line.length;
        line = line.replaceAll("  ", " ");
      } while (len !== line.length);
      line = line.trim();

      const parts = line.split(" ");
      if (parts.length < 2) continue;

      const flags = parts[0];
      const description = parts.slice(2).join(" ");
      const formats = parts[1].split(",");

      if (description.startsWith("piped ")) continue;

      for (const format of formats) {

        let primaryFormat = formats[0];
        if (primaryFormat === "png") primaryFormat = "apng";

        let extension, mimeType;
        try {
          const details = await getMuxerDetails(primaryFormat);
          extension = details.extension;
          mimeType = details.mimeType;
        } catch (e) {
          extension = format;
          mimeType = mime.getType(format) || ("video/" + format);
        }
        mimeType = normalizeMimeType(mimeType);
        // The shared Matroska/WebM demuxer reports Matroska's extension/MIME
        // for both aliases. Preserve WebM's identity for browser detection.
        if (format === "webm") {
          extension = "webm";
          mimeType = "video/webm";
        }

        this.supportedFormats.push({
          name: description + (formats.length > 1 ? (" / " + format) : ""),
          format,
          extension,
          mime: mimeType,
          from: flags.includes("D"),
          to: flags.includes("E"),
          internal: format
        });

      }

    }

    // ====== Manual fine-tuning ======

    const prioritize = ["webm", "mp4", "gif"];
    prioritize.reverse();

    this.supportedFormats.sort((a, b) => {
      const priorityIndexA = prioritize.indexOf(a.format);
      const priorityIndexB = prioritize.indexOf(b.format);
      return priorityIndexB - priorityIndexA;
    });

    // AV1 doesn't seem to be included in WASM FFmpeg
    const avifIndex = this.supportedFormats.findIndex(c => c.mime === "image/avif");
    if (avifIndex !== -1) this.supportedFormats.splice(avifIndex, 1);

    // Add .qta (QuickTime Audio) support - uses same mov demuxer
    this.supportedFormats.push({
      name: "QuickTime Audio",
      format: "qta",
      extension: "qta",
      mime: "video/quicktime",
      from: true,
      to: true,
      internal: "mov"
    });

    // These containers share demuxers but browsers use different MIME labels
    // and extensions. Without input aliases, audio/ogg falls through to the
    // spectrogram bridge and .webm/.oga/.opus files can go undetected.
    for (const [format, extension, mimeType, internal] of [
      ["webm", "webm", "audio/webm", "webm"],
      ["ogg", "ogg", "audio/ogg", "ogg"],
      ["oga", "oga", "audio/ogg", "ogg"],
      ["ogv", "ogv", "video/ogg", "ogg"],
      ["opus", "opus", "audio/ogg", "ogg"],
      ["mp2", "mp2", "audio/mpeg", "mp3"],
    ]) {
      this.supportedFormats.push({ name: `${format.toUpperCase()} media`, format, extension,
        mime: mimeType, internal, from: true, to: false });
    }

    this.#ffmpeg.terminate();

    this.ready = true;
  }

  async doConvert (
    inputFiles: FileData[],
    inputFormat: FileFormat,
    outputFormat: FileFormat,
    args?: string[]
  ): Promise<FileData[]> {

    if (!this.#ffmpeg) {
      throw "Handler not initialized.";
    }
    if (inputFiles.length === 0) throw "No input files.";

    await this.reloadFFmpeg();

    let forceFPS = 0;
    if (inputFormat.mime === "image/png" || inputFormat.mime === "image/jpeg") {
      forceFPS = inputFiles.length < 30 ? 1 : 30;
    }

    let fileIndex = 0;
    let listString = "";
    for (const file of inputFiles) {
      const entryName = `file_${fileIndex++}.${inputFormat.extension}`;
      await this.#ffmpeg.writeFile(entryName, new Uint8Array(file.bytes));
      listString += `file '${entryName}'\n`;
      if (forceFPS) listString += `duration ${1 / forceFPS}\n`;
    }
    await this.#ffmpeg.writeFile("list.txt", new TextEncoder().encode(listString));

    // A single non-still input is opened directly: the concat demuxer only
    // carries streams it can concatenate (it drops e.g. subtitles and data
    // streams) and rewrites timestamps. Stills and multi-file input still need
    // concat to become an image sequence.
    // Headerless raw PCM can't be probed, so name its demuxer explicitly.
    const rawDemuxer = /^([suf](8|16|24|32|64)(le|be)?|alaw|mulaw)$/.test(inputFormat.internal)
      ? ["-f", inputFormat.internal]
      : [];
    const input = inputFiles.length === 1 && !forceFPS
      ? [...rawDemuxer, "-i", "file_0." + inputFormat.extension]
      : ["-f", "concat", "-safe", "0", "-i", "list.txt"];
    const command = ["-hide_banner", ...input, "-f", outputFormat.internal];
    if (outputFormat.mime === "video/mp4") {
      command.push("-pix_fmt", "yuv420p");
    }
    // Ripping audio out of a video: drop the video stream entirely.
    if (outputFormat.mime.startsWith("audio/") && !inputFormat.mime.startsWith("audio/")) {
      command.push("-vn");
    }
    if (args) command.push(...args);
    command.push("output");

    let exitCode = 0;
    const stdout = await this.getStdout(async () => {
      exitCode = await this.#ffmpeg!.exec(command);
    });

    for (let i = 0; i < fileIndex; i ++) {
      const entryName = `file_${i}.${inputFormat.extension}`;
      await this.#ffmpeg.deleteFile(entryName).catch(() => {});
    }

    if (exitCode !== 0 || stdout.includes("Conversion failed!\n")) {
      await this.#ffmpeg.deleteFile("list.txt").catch(() => {});
      await this.#ffmpeg.deleteFile("output").catch(() => {});

      const oldArgs = args ? args : []
      // Directly opened inputs keep subtitle/data streams the target
      // container may not accept; retry without them.
      if (
        !oldArgs.includes("-sn")
        && (stdout.includes("Could not find tag for codec") || stdout.includes("not currently supported in container"))
      ) {
        return this.doConvert(inputFiles, inputFormat, outputFormat, [...oldArgs, "-sn", "-dn"]);
      }
      if (stdout.includes(" not divisible by") && !oldArgs.includes("-vf")) {
        const division = stdout.split(" not divisible by ")[1].split(" ")[0];
        return this.doConvert(inputFiles, inputFormat, outputFormat, [...oldArgs, "-vf", `pad=ceil(iw/${division})*${division}:ceil(ih/${division})*${division}`]);
      }
      if (stdout.includes("width and height must be a multiple of") && !oldArgs.includes("-vf")) {
        const division = stdout.split("width and height must be a multiple of ")[1].split(" ")[0].split("")[0];
        return this.doConvert(inputFiles, inputFormat, outputFormat, [...oldArgs, "-vf", `pad=ceil(iw/${division})*${division}:ceil(ih/${division})*${division}`]);
      }
      if (stdout.includes("Valid sizes are") && !oldArgs.includes("-s")) {
        const newSize = stdout.split("Valid sizes are ")[1].split(".")[0].split(" ").pop();
        if (typeof newSize !== "string") throw stdout;
        return this.doConvert(inputFiles, inputFormat, outputFormat, [...oldArgs, "-s", newSize]);
      }

      throw stdout || `FFmpeg exited with code ${exitCode}.`;
    }

    let bytes: Uint8Array;

    // Validate that output file exists before attempting to read
    let fileData;
    try {
      fileData = await this.#ffmpeg.readFile("output");
    } catch (e) {
      throw `Output file not created: ${e}`;
    }

    if (!fileData || (fileData instanceof Uint8Array && fileData.length === 0)) {
      throw "FFmpeg failed to produce output file";
    }
    if (!(fileData instanceof Uint8Array)) {
      const encoder = new TextEncoder();
      bytes = encoder.encode(fileData);
    } else {
      bytes = new Uint8Array(fileData?.buffer);
    }

    await this.#ffmpeg.deleteFile("output");
    await this.#ffmpeg.deleteFile("list.txt").catch(() => {});

    const name = replaceExtension(inputFiles[0].name, outputFormat.extension);

    return [{ bytes, name }];

  }

}

export default FFmpegHandler;
