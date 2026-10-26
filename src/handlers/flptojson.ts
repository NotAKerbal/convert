// file: flptojson.ts
// npm install ts-flp buffer

import type { FileData, FileFormat, FormatHandler } from "../FormatHandler.ts";
import { Buffer } from "buffer";
import { replaceExtension } from "./handlerUtils.ts";

if (typeof window !== "undefined") {
  (window as any).Buffer = Buffer;
}

import {
  parseFlp,
  readProjectMeta,
  readProjectTimeInfo,
  listSamples,
  listPlugins,
  getFlVersion,
  getPPQ
} from "ts-flp";

class flptojsonHandler implements FormatHandler {

  public name: string = "flptojson";

  public supportedFormats: FileFormat[] = [
    {
      name: "FL Studio Project File",
      format: "flp",
      extension: "flp",
      mime: "application/octet-stream",
      from: true,
      to: false,
      internal: "flp"
    },
    {
      name: "JavaScript Object Notation",
      format: "json",
      extension: "json",
      mime: "application/json",
      from: false,
      to: true,
      internal: "json"
    }
  ];

  public ready: boolean = true;

  async init () {
    this.ready = true;
  }

  async doConvert (
    inputFiles: FileData[],
    inputFormat: FileFormat,
    outputFormat: FileFormat
  ): Promise<FileData[]> {

    if (outputFormat.format !== "json") {
      throw new Error("Invalid output format. Only JSON is supported.");
    }

    const outputFiles: FileData[] = [];

    for (const inputFile of inputFiles) {
      try {
        //FLP to raw byte convert for Parsing
        const rawBytes = inputFile.bytes as Uint8Array;
        const buffer = Buffer.from(rawBytes);

        const parsed = parseFlp(buffer);

        if (!parsed) {
            throw new Error("Parser returned null. The file might be corrupted or encrypted.");
        }

        const meta = readProjectMeta(parsed);
        const timeInfo = readProjectTimeInfo(parsed);
        const samples = listSamples(parsed);
        const plugins = listPlugins(parsed);

        // Report missing fields as null rather than inventing values
        // (the old defaults claimed e.g. 130 BPM for projects with no tempo).
        const version = getFlVersion(parsed) ?? null;
        const ppq = getPPQ(parsed) ?? null;

        // Construct JSON songData structure
        const songData = {
          meta: {
            title: meta.name,
            artist: meta.artist,
            genre: meta.genre,
            comments: meta.description,
            bpm: meta.bpm,
            version: version,
            ppq: ppq
          },
          stats: {
            created: timeInfo.creationDate instanceof Date
                ? timeInfo.creationDate.toISOString()
                : null,
            workTimeSeconds: timeInfo.workTimeSeconds
          },
          content: {
            samples: samples.map(s => s.path),
            plugins: plugins.map(p => ({
              name: p.name,
              vendor: p.vendor
            }))
          }
        };

        // JSON encoding
        const jsonString = JSON.stringify(songData, null, 2);
        const encoder = new TextEncoder();
        const outputBytes = encoder.encode(jsonString);

        const newName = replaceExtension(inputFile.name, "json");

        outputFiles.push({
          bytes: outputBytes,
          name: newName
        });

      } catch (e: any) { // Error handling
        console.error(`[flptojson] Error converting ${inputFile.name}:`, e);
        throw new Error(`Conversion failed for ${inputFile.name}: ${e.message}`);
      }
    }

    return outputFiles;
  }
}

export default flptojsonHandler