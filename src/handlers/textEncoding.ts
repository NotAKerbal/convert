import type { FormatHandler, FileData, FileFormat } from "../FormatHandler.ts";

function hasPrefix(bytes: Uint8Array, prefix: number[]) {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (bytes[i] !== prefix[i]) return false;
  return true;
}

export function decodeUTF32(bytes: Uint8Array, littleEndian: boolean) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let out = "";
  for (let i = 0; i + 4 <= dv.byteLength; i += 4) {
    const cp = dv.getUint32(i, littleEndian);
    // Invalid scalar values (out of range or lone surrogates) become U+FFFD.
    const valid = cp <= 0x10ffff && (cp < 0xd800 || cp > 0xdfff);
    out += String.fromCodePoint(valid ? cp : 0xfffd);
  }
  return out;
}

export function decodeUTF16(bytes: Uint8Array, littleEndian: boolean) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let out = "";
  for (let i = 0; i + 2 <= dv.byteLength; ) {
    const w1 = dv.getUint16(i, littleEndian);
    i += 2;
    if (w1 >= 0xd800 && w1 <= 0xdbff && i + 2 <= dv.byteLength) {
      const w2 = dv.getUint16(i, littleEndian);
      if (w2 >= 0xdc00 && w2 <= 0xdfff) {
        i += 2;
        out += String.fromCodePoint((((w1 - 0xd800) << 10) | (w2 - 0xdc00)) + 0x10000);
        continue;
      }
    }
    // Unpaired surrogates become U+FFFD.
    out += String.fromCharCode(w1 >= 0xd800 && w1 <= 0xdfff ? 0xfffd : w1);
  }
  return out;
}

export function encodeUTF16(str: string, littleEndian: boolean, addBOM = false) {
  // A JS string's length is already its UTF-16 code unit count.
  const buf = new ArrayBuffer(str.length * 2 + (addBOM ? 2 : 0));
  const dv = new DataView(buf);
  let offset = 0;
  if (addBOM) {
    dv.setUint16(0, 0xfeff, littleEndian);
    offset += 2;
  }
  for (let i = 0; i < str.length; i++) {
    dv.setUint16(offset, str.charCodeAt(i), littleEndian);
    offset += 2;
  }
  return new Uint8Array(buf, 0, offset);
}

export function encodeUTF32(str: string, littleEndian: boolean, addBOM = false) {
  const codepoints = Array.from(str, (ch) => ch.codePointAt(0) || 0);
  const buf = new ArrayBuffer(codepoints.length * 4 + (addBOM ? 4 : 0));
  const dv = new DataView(buf);
  let offset = 0;
  if (addBOM) {
    // U+FEFF in the target byte order: FF FE 00 00 (LE) / 00 00 FE FF (BE).
    dv.setUint32(0, 0xfeff, littleEndian);
    offset += 4;
  }
  for (const cp of codepoints) {
    dv.setUint32(offset, cp, littleEndian);
    offset += 4;
  }
  return new Uint8Array(buf, 0, offset);
}

/** Decodes text, sniffing a byte-order mark first (UTF-32 before UTF-16, since FF FE prefixes both). */
export function decodeWithBOMDetection(bytes: Uint8Array) {
  if (hasPrefix(bytes, [0xEF, 0xBB, 0xBF])) return decodeUsingTextDecoder(bytes.subarray(3), "utf-8");
  if (hasPrefix(bytes, [0xFF, 0xFE, 0x00, 0x00])) return decodeUTF32(bytes.subarray(4), true);
  if (hasPrefix(bytes, [0x00, 0x00, 0xFE, 0xFF])) return decodeUTF32(bytes.subarray(4), false);
  if (hasPrefix(bytes, [0xFF, 0xFE])) return decodeUTF16(bytes.subarray(2), true);
  if (hasPrefix(bytes, [0xFE, 0xFF])) return decodeUTF16(bytes.subarray(2), false);
  return decodeUsingTextDecoder(bytes, "utf-8");
}

function decodeUsingTextDecoder(bytes: Uint8Array, label: string) {
  try {
    // TextDecoder labels are typically 'utf-8', 'utf-16le', 'utf-16be', etc.
    // Not all environments support utf-16 labels, so fall back if needed.
    const dec = new TextDecoder(label);
    return dec.decode(bytes);
  } catch {
    // fallback
    const dec = new TextDecoder("utf-8");
    return dec.decode(bytes);
  }
}

const formats: FileFormat[] = [
  { name: "Plain Text",             format: "text",                 extension: "txt", mime: "text/plain",                   from: true,  to: true, internal: "text/utf8"    }, // May or may not have BOM depending on browser
  { name: "Plain Text (UTF-8)",     format: "txt-utf8 without BOM", extension: "txt", mime: "text/plain; charset=utf-8",    from: false, to: true, internal: "text/utf8NB"  }, // In case the broeser defaults to with BOM, we can choose to force BOMless UTF-8.
  { name: "Plain Text (UTF-8 BOM)", format: "txt-utf8 with BOM",    extension: "txt", mime: "text/plain; charset=utf-8",    from: false, to: true, internal: "text/utf8WB"  }, // UTF8 with forced BOM.
  { name: "Plain Text (UTF-16 LE)", format: "txt-utf16le",          extension: "txt", mime: "text/plain; charset=utf-16le", from: true,  to: true, internal: "text/utf16le" },
  { name: "Plain Text (UTF-16 BE)", format: "txt-utf16be",          extension: "txt", mime: "text/plain; charset=utf-16be", from: true,  to: true, internal: "text/utf16be" },
  { name: "Plain Text (UTF-32 LE)", format: "txt-utf32le",          extension: "txt", mime: "text/plain; charset=utf-32le", from: true,  to: true, internal: "text/utf32le" },
  { name: "Plain Text (UTF-32 BE)", format: "txt-utf32be",          extension: "txt", mime: "text/plain; charset=utf-32be", from: true,  to: true, internal: "text/utf32be" },
];

export default class TextEncodingHandler implements FormatHandler {
  name = "TextEncoding";
  supportedFormats = formats;
  ready = true;
  init = async () => { this.ready = true };

  async doConvert(inputFiles: FileData[], inputFormat: FileFormat, outputFormat: FileFormat) {
    const results: FileData[] = [];
    for (const file of inputFiles) {
      const inBytes = file.bytes;
      let text = "";

      // Determine input encoding. Generic "text" (the format any uploaded
      // .txt maps to) sniffs the BOM so UTF-16/32 files decode correctly.
      const inf = (inputFormat && inputFormat.internal) || "";
      if (inf === "text/utf8NB" || inf === "text/utf8WB") {
        text = decodeUsingTextDecoder(inBytes, "utf-8");
      } else if (inf === "text/utf16le") {
        text = decodeUTF16(inBytes, true);
      } else if (inf === "text/utf16be") {
        text = decodeUTF16(inBytes, false);
      } else if (inf === "text/utf32le") {
        text = decodeUTF32(inBytes, true);
      } else if (inf === "text/utf32be") {
        text = decodeUTF32(inBytes, false);
      } else {
        text = decodeWithBOMDetection(inBytes);
      }
      // Drop a decoded BOM so re-encoding doesn't produce two of them.
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

      // Now encode to output format
      const outf = (outputFormat && outputFormat.internal) || "text/utf8NB";
      let outBytes: Uint8Array;
      if (outf === "text/utf8NB") {
        const utf8Bytes = new TextEncoder().encode(text);
        if (utf8Bytes.length >= 3 && hasPrefix(utf8Bytes, [0xEF, 0xBB, 0xBF])) {
          // has BOM, remove it
          outBytes = utf8Bytes.subarray(3);
        } else {
          // Already without BOM, just use it as is
          outBytes = utf8Bytes;
        }
      } else if (outf === "text/utf8WB") {
        const utf8Bytes = new TextEncoder().encode(text);
        if (utf8Bytes.length >= 3 && hasPrefix(utf8Bytes, [0xEF, 0xBB, 0xBF])) {
          // already has BOM, don't add another
          outBytes = utf8Bytes;
        } else {
          const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
          outBytes = new Uint8Array(bom.length + utf8Bytes.length);
          outBytes.set(bom, 0);
          outBytes.set(utf8Bytes, bom.length);
        }
      } else if (outf === "text/utf16le") {
        outBytes = encodeUTF16(text, true, true);
      } else if (outf === "text/utf16be") {
        outBytes = encodeUTF16(text, false, true);
      } else if (outf === "text/utf32le") {
        outBytes = encodeUTF32(text, true, true);
      } else if (outf === "text/utf32be") {
        outBytes = encodeUTF32(text, false, true);
      } else {
        outBytes = new TextEncoder().encode(text);
      }

      results.push({ name: file.name, bytes: outBytes });
    }
    return results;
  }
}
