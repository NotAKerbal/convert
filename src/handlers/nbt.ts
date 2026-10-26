import type { FileData, FileFormat, FormatHandler } from "../FormatHandler.ts";
import * as NBT from "nbtify";
import { replaceExtension } from "./handlerUtils.ts";

/**
 * JSON.stringify replacer for NBTify values: Long tags are BigInts (which
 * JSON.stringify rejects) and array tags are typed arrays (which it would
 * serialize as index-keyed objects).
 */
export function nbtJsonReplacer (_key: string, value: unknown): unknown {
    if (typeof value === "bigint") {
        return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString();
    }
    if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
        return Array.from(value as unknown as ArrayLike<number | bigint>, (v) =>
            typeof v === "bigint" ? nbtJsonReplacer("", v) : v);
    }
    return value;
}

class nbtHandler implements FormatHandler {
    public name: string = "nbt";
    public supportedFormats?: FileFormat[];
    public ready: boolean = false;

    public indent: number = 2

    async init() {
        this.supportedFormats = [
            {
                name: "Named Binary Tag",
                format: "NBT",
                extension: "nbt",
                mime: "application/x-minecraft-nbt",
                from: true,
                to: true,
                internal: "nbt"
            },
            {
                name: "JavaScript Object Notation",
                format: "json",
                extension: "json",
                mime: "application/json",
                from: true,
                to: true,
                internal: "json"
            },
            {
                name: "String Named Binary Tag",
                format: "SNBT",
                extension: "snbt",
                mime: "application/x-minecraft-snbt",
                from: true,
                to: true,
                internal: "snbt"
            },
        ]
        this.ready = true
    }


    async doConvert (
        inputFiles: FileData[],
        inputFormat: FileFormat,
        outputFormat: FileFormat
      ): Promise<FileData[]> {
        const outputFiles: FileData[] = [];
        const decoder = new TextDecoder()
        const encoder = new TextEncoder()

        // nbt <-> json
        if (inputFormat.internal == "nbt" && outputFormat.internal == "json") {
            for (const file of inputFiles) {
                const nbt = await NBT.read(file.bytes);
                const j = JSON.stringify(nbt.data, nbtJsonReplacer, this.indent)
                outputFiles.push({
                    name: replaceExtension(file.name, "json"),
                    bytes: encoder.encode(j)
                })
            }
        }
        if (inputFormat.internal == "json" && outputFormat.internal == "nbt") {
            for (const file of inputFiles) {
                const text = decoder.decode(file.bytes)
                const obj = JSON.parse(text)
                const bd = await NBT.write(obj)
                outputFiles.push({
                    name: replaceExtension(file.name, "nbt"),
                    bytes: bd
                })
            }
        }

        // snbt <-> nbt
        if (inputFormat.internal == "snbt" && outputFormat.internal == "nbt") {
            for (const file of inputFiles) {
                const text = decoder.decode(file.bytes)
                const nbt = NBT.parse(text)
                const bd = await NBT.write(nbt)
                outputFiles.push({
                    name: replaceExtension(file.name, "nbt"),
                    bytes: bd
                })
            }
        }
        if (inputFormat.internal == "nbt" && outputFormat.internal == "snbt") {
            for (const file of inputFiles) {
                const nbt = await NBT.read(file.bytes)
                const text = NBT.stringify(nbt, {
                    space: this.indent
                })
                outputFiles.push({
                    name: replaceExtension(file.name, "snbt"),
                    bytes: encoder.encode(text)
                })
            }
        }

        // snbt <-> json
        if (inputFormat.internal == "snbt" && outputFormat.internal == "json") {
            for (const file of inputFiles) {
                const snbt = decoder.decode(file.bytes)
                const nbt = NBT.parse(snbt)
                const text = JSON.stringify(nbt, nbtJsonReplacer, this.indent)
                outputFiles.push({
                    name: replaceExtension(file.name, "json"),
                    bytes: encoder.encode(text)
                })
            }
        }
        if (inputFormat.internal == "json" && outputFormat.internal == "snbt") {
            for (const file of inputFiles) {
                const text = decoder.decode(file.bytes)
                const obj = JSON.parse(text)
                const snbt = NBT.stringify(obj, {
                    space: this.indent
                })
                outputFiles.push({
                    name: replaceExtension(file.name, "snbt"),
                    bytes: encoder.encode(snbt)
                })
            }
        }

        if (outputFiles.length === 0) {
            throw `nbt: unsupported conversion ${inputFormat.format} -> ${outputFormat.format}`;
        }
        return outputFiles
      }
}

export default nbtHandler;