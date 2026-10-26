import type { FileData, FileFormat, FormatHandler } from "../FormatHandler.ts";
import { decodeWithBOMDetection } from "./textEncoding.ts";

import { bytesToBase64, replaceExtension, stripExtension } from "./handlerUtils.ts";

class htmlEmbedHandler implements FormatHandler {

  public name: string = "htmlEmbed";
  public supportedFormats: FileFormat[] = [
    {
      name: "Hypertext Markup Language",
      format: "html",
      extension: "html",
      mime: "text/html",
      from: false,
      to: true,
      internal: "html"
    },
    {
      name: "Portable Network Graphics",
      format: "png",
      extension: "png",
      mime: "image/png",
      from: true,
      to: false,
      internal: "png"
    },
    {
      name: "Joint Photographic Experts Group JFIF",
      format: "jpeg",
      extension: "jpg",
      mime: "image/jpeg",
      from: true,
      to: false,
      internal: "jpeg"
    },
    {
      name: "WebP",
      format: "webp",
      extension: "webp",
      mime: "image/webp",
      from: true,
      to: false,
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
      name: "Plain Text",
      format: "text",
      extension: "txt",
      mime: "text/plain",
      from: true,
      to: false,
      internal: "text"
    },
    {
      name: "MPEG-4 Part 14",
      format: "mp4",
      extension: "mp4",
      mime: "video/mp4",
      from: true,
      to: false,
      internal: "mp4"
    },
    {
      name: "MP3 Audio",
      format: "mp3",
      extension: "mp3",
      mime: "audio/mpeg",
      from: true,
      to: false,
      internal: "mp3"
    }
  ];
  public ready: boolean = false;

  async init () {
    this.ready = true;
  }

  static escapeHTML (text: string): string {
    return text
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll("\"", "&quot;");
  }

  async doConvert (
    inputFiles: FileData[],
    inputFormat: FileFormat,
    outputFormat: FileFormat
  ): Promise<FileData[]> {

    if (outputFormat.internal !== "html") throw "Invalid output format.";

    const encoder = new TextEncoder();
    let body = "";

    if (inputFormat.internal === "text") {
      for (const inputFile of inputFiles) {
        const text = htmlEmbedHandler.escapeHTML(decodeWithBOMDetection(inputFile.bytes));
        body += `<pre style="white-space:pre-wrap;word-wrap:break-word">${text}</pre>\n`;
      }
    } else {
      for (const inputFile of inputFiles) {

        const base64 = bytesToBase64(inputFile.bytes);
        const src = `data:${inputFormat.mime};base64,${base64}`;
        const alt = htmlEmbedHandler.escapeHTML(inputFile.name);

        if (inputFormat.mime.startsWith("image/")) {
          body += `<img src="${src}" alt="${alt}"><br>\n`;
        } else if (inputFormat.mime.startsWith("audio/")) {
          body += `<audio controls src="${src}"></audio><br>\n`;
        } else {
          body += `<video controls src="${src}"></video><br>\n`;
        }

      }
    }

    // Declare UTF-8 explicitly; without it browsers opening the saved file
    // fall back to a legacy encoding and mangle non-ASCII text.
    const title = htmlEmbedHandler.escapeHTML(stripExtension(inputFiles[0].name));
    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>img,video{max-width:100%;height:auto}</style>
</head>
<body>
${body}</body>
</html>
`;

    const bytes = encoder.encode(html);
    const name = replaceExtension(inputFiles[0].name, outputFormat.extension);
    return [{ bytes, name }];

  }

}

export default htmlEmbedHandler;
