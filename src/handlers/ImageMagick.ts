import {
  AlphaAction,
  initializeImageMagick,
  MagickColors,
  Magick,
  MagickFormat,
  MagickImageCollection,
  MagickReadSettings
} from "@imagemagick/magick-wasm";

import mime from "mime";
import normalizeMimeType from "../normalizeMimeType.ts";

import type { FileData, FileFormat, FormatHandler } from "../FormatHandler.ts";
import { mimeLacksAlpha, replaceExtension } from "./handlerUtils.ts";

/**
 * Readers that always fail in the WASM build, so these are write-only:
 * - PDF/PostScript family: needs the external Ghostscript delegate
 *   ("FailedToExecuteCommand 'gs'").
 * - SVG/SVGZ: needs the external Inkscape delegate; the internal MSVG
 *   renderer is blocked by the security policy ("NotAuthorized MVG").
 *   SVG input is handled by the browser-based canvas handler instead.
 * - GROUP4: raw CCITT data without TIFF tags; can't even read back its own
 *   output ("Bad value 0 for RowsPerStrip").
 */
const UNSUPPORTED_READS = new Set([
  "AI", "EPDF", "EPI", "EPS", "EPSF", "EPSI", "PCL", "PDF", "PDFA",
  "POCKETMOD", "PS", "XPS",
  "SVG", "SVGZ",
  "GROUP4"
]);

/**
 * Writers that fail in the WASM build: JPT (JPEG-2000 tile-part) aborts in
 * jp2.c with UnableToEncodeImageFile, and POCKETMOD needs a font file that
 * isn't bundled (UnableToReadFont). Advertised as read-only / dropped.
 */
const UNSUPPORTED_WRITES = new Set(["JPT", "POCKETMOD"]);

/**
 * `mime.getType()` guesses for extensions that collide with unrelated
 * formats. These are not the ImageMagick formats of the same name, so the
 * guess would route unrelated files (e.g. Sun Impress templates) here.
 */
const MIME_OVERRIDES: Record<string, string | null> = {
  DCR: "image/x-kodak-dcr",
  MPC: "image/x-magick-cache",
  MSL: "text/x-magick-script",
  PDB: "image/x-palm-database",
  PSB: "image/vnd.adobe.photoshop",
  STI: null
};

class ImageMagickHandler implements FormatHandler {

  public name: string = "ImageMagick";

  public supportedFormats: FileFormat[] = [];

  public ready: boolean = false;

  #initPromise?: Promise<void>;

  init () {
    this.#initPromise ??= this.#init().catch((e) => {
      this.#initPromise = undefined;
      throw e;
    });
    return this.#initPromise;
  }

  async #init () {

    this.supportedFormats = [];
    const wasmLocation = "/wasm/magick.wasm";
    const wasmBytes = await fetch(wasmLocation).then(r => r.bytes());

    await initializeImageMagick(wasmBytes);

    Magick.supportedFormats.forEach(format => {
      const formatName = format.format.toLowerCase();
      if (formatName === "apng") return;
      const override = format.format in MIME_OVERRIDES ? MIME_OVERRIDES[format.format] : undefined;
      if (override === null) return;
      const mimeType = override || format.mimeType || mime.getType(formatName);
      if (
        !mimeType
        || mimeType.startsWith("text/")
        || mimeType.startsWith("video/")
        || mimeType === "application/json"
      ) return;
      const from = format.supportsReading && !UNSUPPORTED_READS.has(format.format);
      const to = format.supportsWriting && !UNSUPPORTED_WRITES.has(format.format);
      if (!from && !to) return;
      this.supportedFormats.push({
        name: format.description,
        format: formatName,
        extension: formatName,
        mime: normalizeMimeType(mimeType),
        from,
        to,
        internal: format.format
      });
    });

    // ====== Manual fine-tuning ======

    const prioritize = ["png", "jpeg", "gif", "pdf"];
    prioritize.reverse();

    this.supportedFormats.sort((a, b) => {
      const priorityIndexA = prioritize.indexOf(a.format);
      const priorityIndexB = prioritize.indexOf(b.format);
      return priorityIndexB - priorityIndexA;
    });

    this.ready = true;
  }

  async doConvert (
    inputFiles: FileData[],
    inputFormat: FileFormat,
    outputFormat: FileFormat
  ): Promise<FileData[]> {

    const inputMagickFormat = inputFormat.internal as MagickFormat;
    const outputMagickFormat = outputFormat.internal as MagickFormat;

    const inputSettings = new MagickReadSettings();
    inputSettings.format = inputMagickFormat;


    const bytes: Uint8Array = await new Promise(resolve => {
      MagickImageCollection.use(outputCollection => {
        for (const inputFile of inputFiles) {
           if (inputFormat.format == "rgb") {
             // Guess how big the Image should be
             inputSettings.width = Math.floor(Math.sqrt(inputFile.bytes.length / 3));
             inputSettings.height = inputSettings.width;
           }
          MagickImageCollection.use(fileCollection => {
            fileCollection.read(inputFile.bytes, inputSettings);
            while (fileCollection.length > 0) {
              const image = fileCollection.shift();
              if (!image) break;
              if (mimeLacksAlpha(outputFormat.mime) && image.hasAlpha) {
                // Without this, transparent pixels come out black.
                image.backgroundColor = MagickColors.White;
                image.alpha(AlphaAction.Remove);
              }
              outputCollection.push(image);
            }
          });
        }
        outputCollection.write(outputMagickFormat, (bytes) => {
          resolve(new Uint8Array(bytes));
        });
      });
    });

    return [{ bytes, name: replaceExtension(inputFiles[0].name, outputFormat.extension) }];

  }

}

export default ImageMagickHandler;
