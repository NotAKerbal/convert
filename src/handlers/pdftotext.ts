import type { FileData, FileFormat, FormatHandler } from "../FormatHandler.ts";

/**
 * Extracts the embedded text of a PDF document into a plain-text file.
 *
 * Uses pdf.js (pdfjs-dist), which is already a transitive dependency through
 * pdftoimg-js. The worker is copied into `public/wasm` by `scripts/copy-wasm.mjs`.
 */
class pdftotextHandler implements FormatHandler {

  public name: string = "pdftotext";

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
      name: "Plain Text",
      format: "text",
      extension: "txt",
      mime: "text/plain",
      from: false,
      to: true,
      internal: "text"
    }
  ];

  public ready: boolean = false;

  #pdfjs?: typeof import("pdfjs-dist");

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

    if (!this.#pdfjs) await this.init();
    const pdfjs = this.#pdfjs;
    if (!pdfjs) throw "Handler not initialized.";

    const outputFiles: FileData[] = [];

    for (const inputFile of inputFiles) {
      // Clone the buffer: pdf.js transfers/detaches the underlying ArrayBuffer.
      const data = new Uint8Array(inputFile.bytes);
      const doc = await pdfjs.getDocument({ data }).promise;

      let text = "";
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
        const page = await doc.getPage(pageNumber);
        const content = await page.getTextContent();

        let line = "";
        for (const item of content.items) {
          if (!("str" in item)) continue;
          line += item.str;
          if (item.hasEOL) {
            text += line + "\n";
            line = "";
          }
        }
        if (line) text += line + "\n";

        // Separate pages with a blank line.
        if (pageNumber < doc.numPages) text += "\n";

        page.cleanup();
      }

      await doc.destroy();

      const baseName = inputFile.name.replace(/\.[^.]+$/, "");
      outputFiles.push({
        bytes: new TextEncoder().encode(text.replace(/\s+$/, "") + "\n"),
        name: `${baseName}.${outputFormat.extension}`
      });
    }

    return outputFiles;
  }

}

export default pdftotextHandler;
