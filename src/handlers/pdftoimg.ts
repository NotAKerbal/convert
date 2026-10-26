import type { FileData, FileFormat, FormatHandler } from "../FormatHandler.ts";

import { canvasToBytes, stripExtension } from "./handlerUtils.ts";

/**
 * Renders every page of a PDF to an image.
 *
 * Uses pdf.js (pdfjs-dist) directly with the locally served worker copied to
 * `public/wasm` by `scripts/copy-wasm.mjs`. (The `pdftoimg-js` wrapper this
 * handler used to call hard-codes a cdnjs worker URL, which breaks offline use
 * and sends the app to a third-party host.)
 */
class pdftoimgHandler implements FormatHandler {

  public name: string = "pdftoimg";

  public supportedFormats: FileFormat[] = [
    {
      name: "Portable Document Format",
      format: "pdf",
      extension: "pdf",
      mime: "application/pdf",
      from: true,
      to: false,
      internal: "pdf"
    },
    {
      name: "Portable Network Graphics",
      format: "png",
      extension: "png",
      mime: "image/png",
      from: false,
      to: true,
      internal: "png"
    },
    {
      name: "Joint Photographic Experts Group JFIF",
      format: "jpeg",
      extension: "jpg",
      mime: "image/jpeg",
      from: false,
      to: true,
      internal: "jpeg"
    }
  ];

  public ready: boolean = false;

  #pdfjs?: typeof import("pdfjs-dist");

  /** Render scale: 2x of pdf.js' 72dpi CSS-pixel viewport (~144 dpi). */
  static scale = 2;
  /** Keeps pages within canvas limits on every major browser. */
  static maxDimension = 4096;

  async init () {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = "/wasm/pdf.worker.min.mjs";
    this.#pdfjs = pdfjs;
    this.ready = true;
  }

  async doConvert (
    inputFiles: FileData[],
    _inputFormat: FileFormat,
    outputFormat: FileFormat
  ): Promise<FileData[]> {

    if (outputFormat.mime !== "image/png" && outputFormat.mime !== "image/jpeg") {
      throw "Invalid output format.";
    }

    if (!this.#pdfjs) await this.init();
    const pdfjs = this.#pdfjs;
    if (!pdfjs) throw "Handler not initialized.";

    const outputFiles: FileData[] = [];

    for (const inputFile of inputFiles) {
      // Clone the buffer: pdf.js transfers/detaches the underlying ArrayBuffer.
      const doc = await pdfjs.getDocument({ data: new Uint8Array(inputFile.bytes) }).promise;
      const baseName = stripExtension(inputFile.name);
      const pad = String(doc.numPages).length;

      try {
        for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
          const page = await doc.getPage(pageNumber);
          let viewport = page.getViewport({ scale: pdftoimgHandler.scale });
          const fit = Math.min(
            1,
            pdftoimgHandler.maxDimension / viewport.width,
            pdftoimgHandler.maxDimension / viewport.height
          );
          if (fit < 1) viewport = page.getViewport({ scale: pdftoimgHandler.scale * fit });

          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.floor(viewport.width));
          canvas.height = Math.max(1, Math.floor(viewport.height));
          const ctx = canvas.getContext("2d");
          if (!ctx) throw "Failed to create 2D rendering context.";

          // PDF pages are opaque paper; render onto white for both formats.
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: ctx, viewport }).promise;
          page.cleanup();

          const bytes = await canvasToBytes(canvas, outputFormat.mime, 0.92);
          const suffix = doc.numPages > 1 ? `_${String(pageNumber).padStart(pad, "0")}` : "";
          outputFiles.push({ bytes, name: `${baseName}${suffix}.${outputFormat.extension}` });
          canvas.width = canvas.height = 0;
        }
      } finally {
        await doc.destroy();
      }
    }

    if (outputFiles.length === 0) throw "PDF has no pages.";
    return outputFiles;

  }

}

export default pdftoimgHandler;
