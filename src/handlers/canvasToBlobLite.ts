import type { FileData, FileFormat, FormatHandler } from "../FormatHandler.ts";
import { decodeWithBOMDetection } from "./textEncoding.ts";

import { bytesToBase64, canvasToBytes, loadImage, mimeLacksAlpha, replaceExtension } from "./handlerUtils.ts";

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
    const canvas = this.#canvas;
    const ctx = this.#ctx;

    if (inputFormat.mime === "text/plain" && outputFormat.mime === "text/plain") {
      throw "Text to text is not an image conversion.";
    }

    const outputFiles: FileData[] = [];
    for (const inputFile of inputFiles) {

      if (inputFormat.mime === "text/plain") {
        const font = "48px sans-serif";
        const fontSize = 48;
        const lineHeight = Math.floor(fontSize * 1.5);
        const padding = Math.floor(fontSize / 2);
        const lines = decodeWithBOMDetection(inputFile.bytes)
          .replace(/\r\n?/g, "\n")
          .replace(/\t/g, "    ")
          .replace(/\n+$/, "")
          .split("\n");

        ctx.font = font;
        const textWidth = Math.max(...lines.map(line => ctx.measureText(line).width));
        canvas.width = Math.max(1, Math.ceil(textWidth) + padding * 2);
        canvas.height = lines.length * lineHeight + padding * 2;

        // Resizing the canvas resets the context state.
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "black";
        ctx.font = font;
        ctx.textBaseline = "alphabetic";
        lines.forEach((line, i) => {
          ctx.fillText(line, padding, padding + i * lineHeight + fontSize);
        });

      } else {
        // SVG goes through a data: URL so it isn't treated as cross-origin.
        let image: HTMLImageElement;
        if (inputFormat.mime === "image/svg+xml") {
          image = new Image();
          await new Promise((resolve, reject) => {
            image.addEventListener("load", resolve);
            image.addEventListener("error", () => reject("Failed to decode SVG image."));
            image.src = `data:image/svg+xml;base64,${bytesToBase64(inputFile.bytes)}`;
          });
        } else {
          image = await loadImage(inputFile.bytes, inputFormat.mime);
        }

        if (!image.naturalWidth || !image.naturalHeight) {
          throw "Image has no intrinsic size.";
        }
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (mimeLacksAlpha(outputFormat.mime)) {
          // Transparent pixels would otherwise turn black.
          ctx.fillStyle = "white";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        ctx.drawImage(image, 0, 0);
      }

      let bytes: Uint8Array;
      if (outputFormat.mime === "text/plain") {
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
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
        bytes = await canvasToBytes(canvas, outputFormat.mime);
      }

      outputFiles.push({ bytes, name: replaceExtension(inputFile.name, outputFormat.extension) });
    }

    return outputFiles;
  }
}

export default canvasToBlobLiteHandler;
