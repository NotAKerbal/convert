import type { FileData, FileFormat, FormatHandler } from "../FormatHandler.ts";

class canvasToBlobLiteHandler implements FormatHandler {

  public name: string = "canvasToBlob";

  public supportedFormats: FileFormat[] = [
    {
      name: "Portable Network Graphics",
      format: "png",
      extension: "png",
      mime: "image/png",
      from: true,
      to: true,
      internal: "png"
    },
    {
      name: "Joint Photographic Experts Group JFIF",
      format: "jpeg",
      extension: "jpg",
      mime: "image/jpeg",
      from: true,
      to: true,
      internal: "jpeg"
    },
    {
      name: "WebP",
      format: "webp",
      extension: "webp",
      mime: "image/webp",
      from: true,
      to: true,
      internal: "webp"
    },
    {
      name: "CompuServe Graphics Interchange Format (GIF)",
      format: "gif",
      extension: "gif",
      mime: "image/gif",
      from: true,
      to: false,
      internal: "gif"
    },
    {
      name: "Scalable Vector Graphics",
      format: "svg",
      extension: "svg",
      mime: "image/svg+xml",
      from: true,
      to: false,
      internal: "svg"
    },
    {
      name: "Plain Text (ASCII art)",
      format: "text",
      extension: "txt",
      mime: "text/plain",
      from: true,
      to: true,
      internal: "text"
    }
  ];

  #canvas?: HTMLCanvasElement;
  #ctx?: CanvasRenderingContext2D;

  public ready: boolean = false;

  async init() {
    this.#canvas = document.createElement("canvas");
    this.#ctx = this.#canvas.getContext("2d") || undefined;
    this.ready = true;
  }

  async doConvert(
    inputFiles: FileData[],
    inputFormat: FileFormat,
    outputFormat: FileFormat
  ): Promise<FileData[]> {

    if (!this.#canvas || !this.#ctx) {
      throw "Handler not initialized.";
    }

    const outputFiles: FileData[] = [];
    for (const inputFile of inputFiles) {

      if (inputFormat.mime === "text/plain") {
        const font = "48px sans-serif";
        const fontSize = parseInt(font);
        const string = new TextDecoder().decode(inputFile.bytes);

        this.#ctx.font = font;
        this.#canvas.width = this.#ctx.measureText(string).width;
        this.#canvas.height = Math.floor(fontSize * 1.5);

        if (outputFormat.mime === "image/jpeg") {
          this.#ctx.fillStyle = "white";
          this.#ctx.fillRect(0, 0, this.#canvas.width, this.#canvas.height);
        }
        this.#ctx.fillStyle = "black";
        this.#ctx.strokeStyle = "white";
        this.#ctx.font = font;
        this.#ctx.fillText(string, 0, fontSize);
        this.#ctx.strokeText(string, 0, fontSize);

      } else {
        const blob = new Blob([inputFile.bytes as BlobPart], { type: inputFormat.mime });
        const url =
          inputFormat.mime === "image/svg+xml"
            ? `data:${inputFormat.mime};base64,${btoa(String.fromCharCode(...inputFile.bytes))}`
            : URL.createObjectURL(blob);

        const image = new Image();
        await new Promise((resolve, reject) => {
          image.addEventListener("load", resolve);
          image.addEventListener("error", reject);
          image.src = url;
        });

        this.#canvas.width = image.naturalWidth;
        this.#canvas.height = image.naturalHeight;
        this.#ctx.drawImage(image, 0, 0);

        if (url.startsWith("blob:")) URL.revokeObjectURL(url);
      }

      let bytes: Uint8Array;
      if (outputFormat.mime === "text/plain") {
        const pixels = this.#ctx.getImageData(0, 0, this.#canvas.width, this.#canvas.height);
        const w = pixels.width;
        const h = pixels.height;
        const chars = " .:-=+*#%@";
        let text = "";
        const step = Math.max(1, Math.floor(h / 60));
        for (let y = 0; y < h; y += step) {
          for (let x = 0; x < w; x += Math.floor(step * 0.5) || 1) {
            const i = (y * w + x) * 4;
            const gray = (pixels.data[i] * 0.299 + pixels.data[i + 1] * 0.587 + pixels.data[i + 2] * 0.114) / 255;
            const a = pixels.data[i + 3] / 255;
            const val = gray * a + (1 - a);
            text += chars[Math.floor((1 - val) * (chars.length - 1))];
          }
          text += "\n";
        }
        bytes = new TextEncoder().encode(text);
      } else {
        bytes = await new Promise((resolve, reject) => {
          this.#canvas!.toBlob((blob) => {
            if (!blob) return reject("Canvas output failed");
            blob.arrayBuffer().then(buf => resolve(new Uint8Array(buf)));
          }, outputFormat.mime);
        });
      }

      const name = inputFile.name.split(".")[0] + "." + outputFormat.extension;
      outputFiles.push({ bytes, name });
    }

    return outputFiles;
  }
}

export default canvasToBlobLiteHandler;
