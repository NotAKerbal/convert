import type { FileData, FileFormat, FormatHandler } from "../FormatHandler.ts";
import JSZip from "jszip";
import { replaceExtension } from "./handlerUtils.ts";

class jszipHandler implements FormatHandler {

  public name: string = "jszip";

  public supportedFormats: FileFormat[] = [
    {
      name: "ZIP Archive",
      format: "zip",
      extension: "zip",
      mime: "application/zip",
      from: false,
      to: true,
      internal: "zip"
    }
  ];

  public supportAnyInput: boolean = true;

  public ready: boolean = false;

  async init() {
    this.ready = true;
  }

  async doConvert(
    inputFiles: FileData[],
    inputFormat: FileFormat,
    outputFormat: FileFormat
  ): Promise<FileData[]> {

    const outputFiles: FileData[] = [];
    const zip = new JSZip();

    // Same-named inputs would overwrite each other inside the archive.
    const used = new Set<string>();
    for (const file of inputFiles) {
      let entryName = file.name || "file";
      for (let n = 1; used.has(entryName); n++) {
        entryName = file.name.replace(/(\.[^.]*)?$/, (ext) => ` (${n})${ext}`);
      }
      used.add(entryName);
      zip.file(entryName, file.bytes);
    }

    const output = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });

    const name = inputFiles.length === 1 ? replaceExtension(inputFiles[0].name, "zip") : "output.zip";
    outputFiles.push({ bytes: output, name });
    return outputFiles;
  }
}

export default jszipHandler;
