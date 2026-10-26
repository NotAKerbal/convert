import { test } from "node:test";
import assert from "node:assert/strict";

import type { FileFormat } from "../FormatHandler.ts";
import { replaceExtension, stripExtension } from "./handlerUtils.ts";
import TextEncodingHandler, {
  decodeUTF16, decodeUTF32, decodeWithBOMDetection, encodeUTF16, encodeUTF32
} from "./textEncoding.ts";
import { csvEscape, csvToObjects, fromJsonHandler, parseCSV, toJsonHandler, xmlName } from "./jsonLite.ts";
import nbtHandler, { nbtJsonReplacer } from "./nbt.ts";
import * as NBT from "nbtify";
import { parseWav } from "./flo.ts";
import { quoteIdentifier, sqliteValueToCsv } from "./sqlite.ts";
import { decodeVTF } from "./vtf.ts";

const enc = new TextEncoder();
const dec = new TextDecoder();

function fmt (partial: Partial<FileFormat> & { internal: string; mime: string }): FileFormat {
  return {
    name: partial.internal, format: partial.internal, extension: "txt",
    from: true, to: true, ...partial
  };
}

test("file names keep inner dots and only swap the last extension", () => {
  assert.equal(replaceExtension("my.photo.png", "jpg"), "my.photo.jpg");
  assert.equal(replaceExtension("README", "txt"), "README.txt");
  assert.equal(replaceExtension(".bashrc", "txt"), ".bashrc.txt");
  assert.equal(stripExtension("a.tar.gz"), "a.tar");
});

// ── TextEncoding ──

const sample = "héllo 😀 wörld\n𝄞";

test("UTF-16 encodes astral characters without overflowing the buffer", () => {
  for (const le of [true, false]) {
    const bytes = encodeUTF16(sample, le, true);
    assert.equal(bytes.length, 2 + sample.length * 2);
    assert.deepEqual(Array.from(bytes.subarray(0, 2)), le ? [0xff, 0xfe] : [0xfe, 0xff]);
    assert.equal(decodeUTF16(bytes.subarray(2), le), sample);
  }
});

test("UTF-32 writes the correct BOM for each byte order", () => {
  assert.deepEqual(Array.from(encodeUTF32("A", true, true)), [0xff, 0xfe, 0, 0, 0x41, 0, 0, 0]);
  assert.deepEqual(Array.from(encodeUTF32("A", false, true)), [0, 0, 0xfe, 0xff, 0, 0, 0, 0x41]);
  for (const le of [true, false]) {
    assert.equal(decodeWithBOMDetection(encodeUTF32(sample, le, true)), sample);
  }
});

test("invalid UTF-16/32 input decodes to U+FFFD instead of throwing", () => {
  assert.equal(decodeUTF32(new Uint8Array([0, 0, 0xfe, 0xff]), true), "�");
  assert.equal(decodeUTF16(new Uint8Array([0x00, 0xd8, 0x41, 0x00]), true), "�A");
});

test("TextEncoding round-trips every encoding and sniffs BOMs on generic text", async () => {
  const handler = new TextEncodingHandler();
  const utf8 = fmt({ internal: "text/utf8", mime: "text/plain" });
  const utf8NB = fmt({ internal: "text/utf8NB", mime: "text/plain; charset=utf-8" });
  for (const internal of ["text/utf16le", "text/utf16be", "text/utf32le", "text/utf32be", "text/utf8WB"]) {
    const target = fmt({ internal, mime: `text/plain; charset=${internal}` });
    const [encoded] = await handler.doConvert([{ name: "a.txt", bytes: enc.encode(sample) }], utf8, target);
    // Back through the explicit format…
    const [viaExplicit] = await handler.doConvert([encoded], target, utf8NB);
    assert.equal(dec.decode(viaExplicit.bytes), sample, `${internal} explicit`);
    // …and through generic "text", which is what an uploaded .txt maps to.
    const [viaGeneric] = await handler.doConvert([encoded], utf8, utf8NB);
    assert.equal(dec.decode(viaGeneric.bytes), sample, `${internal} via BOM sniffing`);
  }
});

test("re-encoding a BOM-prefixed file doesn't double the BOM", async () => {
  const handler = new TextEncodingHandler();
  const le = fmt({ internal: "text/utf16le", mime: "text/plain; charset=utf-16le" });
  const be = fmt({ internal: "text/utf16be", mime: "text/plain; charset=utf-16be" });
  const [out] = await handler.doConvert([{ name: "a.txt", bytes: encodeUTF16("hi", true, true) }], le, be);
  assert.deepEqual(Array.from(out.bytes), [0xfe, 0xff, 0, 0x68, 0, 0x69]);
});

// ── CSV / JSON ──

test("CSV parser keeps the final row without a trailing newline", () => {
  assert.deepEqual(parseCSV("a,b\n1,2"), [["a", "b"], ["1", "2"]]);
  assert.deepEqual(parseCSV("a,b\r\n1,2\r\n"), [["a", "b"], ["1", "2"]]);
});

test("CSV keys that match Object prototype names remain data", () => {
  assert.equal(JSON.stringify(csvToObjects("__proto__,constructor\nvalue,other")), '[{"__proto__":"value","constructor":"other"}]');
});

test("CSV parser handles quotes, embedded commas, newlines and empty fields", () => {
  const text = 'name,note,empty\n"Doe, Jane","said ""hi""\nthen left",\n\nplain,x,""\n';
  assert.deepEqual(csvToObjects(text), [
    { name: "Doe, Jane", note: 'said "hi"\nthen left', empty: "" },
    { name: "plain", note: "x", empty: "" }
  ]);
  assert.throws(() => parseCSV('a\n"unterminated'));
});

test("csvEscape quotes newlines so values survive a round trip", () => {
  for (const value of ["plain", "a,b", 'q"q', "line1\nline2", "cr\rhere", " padded "]) {
    assert.deepEqual(parseCSV(csvEscape(value)), [[value]]);
  }
});

test("JSON -> CSV -> JSON preserves strings with newlines and commas", async () => {
  const rows = [{ a: "x,y", b: "multi\nline" }, { a: 'q"uote', b: "" }];
  const json = fmt({ internal: "json", mime: "application/json", extension: "json" });
  const csv = fmt({ internal: "csv", mime: "text/csv", extension: "csv" });
  const [csvFile] = await new fromJsonHandler().doConvert([{ name: "d.json", bytes: enc.encode(JSON.stringify(rows)) }], json, csv);
  assert.equal(csvFile.name, "d.csv");
  const [back] = await new toJsonHandler().doConvert([csvFile], csv, json);
  assert.deepEqual(JSON.parse(dec.decode(back.bytes)), rows);
});

test("JSON -> CSV accepts null array items and scalar documents", async () => {
  const json = fmt({ internal: "json", mime: "application/json", extension: "json" });
  const csv = fmt({ internal: "csv", mime: "text/csv", extension: "csv" });
  const handler = new fromJsonHandler();
  for (const doc of ["null", "42", '"text"', '[null, {"a": 1}, 3]']) {
    const [out] = await handler.doConvert([{ name: "d.json", bytes: enc.encode(doc) }], json, csv);
    assert.ok(out.bytes.length > 0, doc);
  }
  const [mixed] = await handler.doConvert([{ name: "d.json", bytes: enc.encode('[null, {"a": 1}, 3]') }], json, csv);
  assert.equal(dec.decode(mixed.bytes), "_value,a\nnull,\n,1\n3,\n");
});

test("JSON -> XML produces well-formed element names", async () => {
  assert.equal(xmlName("first name"), "first_name");
  assert.equal(xmlName("1st"), "_1st");
  assert.equal(xmlName("@id"), "_id");
  const json = fmt({ internal: "json", mime: "application/json", extension: "json" });
  const xml = fmt({ internal: "xml", mime: "application/xml", extension: "xml" });
  const [out] = await new fromJsonHandler().doConvert(
    [{ name: "d.json", bytes: enc.encode('{"first name": "<A&B>", "2x": [1]}') }], json, xml
  );
  assert.equal(
    dec.decode(out.bytes),
    '<?xml version="1.0" encoding="UTF-8"?>\n<Object><first_name>&lt;A&amp;B&gt;</first_name><_2x><Item>1</Item></_2x></Object>'
  );
});

// ── NBT ──

const snbt = "{long:9007199254740993L,small:4L,bytes:[B;1b,-2b],ints:[I;1,2],longs:[L;1l,2l],name:\"x\"}";

test("NBT/SNBT -> JSON serializes Long tags and typed arrays", async () => {
  const handler = new nbtHandler();
  await handler.init();
  const formats = handler.supportedFormats!;
  const [nbtFmt, jsonFmt, snbtFmt] = ["nbt", "json", "snbt"].map(i => formats.find(f => f.internal === i)!);

  const [fromSnbt] = await handler.doConvert([{ name: "level.snbt", bytes: enc.encode(snbt) }], snbtFmt, jsonFmt);
  const expected = { long: "9007199254740993", small: 4, bytes: [1, -2], ints: [1, 2], longs: [1, 2], name: "x" };
  assert.deepEqual(JSON.parse(dec.decode(fromSnbt.bytes)), expected);

  const binary = await NBT.write(NBT.parse(snbt));
  const [fromNbt] = await handler.doConvert([{ name: "level.dat.nbt", bytes: binary }], nbtFmt, jsonFmt);
  assert.equal(fromNbt.name, "level.dat.json");
  assert.deepEqual(JSON.parse(dec.decode(fromNbt.bytes)), expected);

  await assert.rejects(handler.doConvert([{ name: "a.nbt", bytes: binary }], nbtFmt, nbtFmt));
  assert.equal(nbtJsonReplacer("", 5n), 5);
});

// ── WAV parsing (FLO handler) ──

function wav (format: number, bits: number, channels: number, rate: number, data: Uint8Array, extraChunk = false) {
  const extra = extraChunk ? 8 + 4 : 0;
  const buf = new Uint8Array(44 + extra + data.length);
  const v = new DataView(buf.buffer);
  const str = (o: number, s: string) => [...s].forEach((c, i) => buf[o + i] = c.charCodeAt(0));
  str(0, "RIFF"); v.setUint32(4, buf.length - 8, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, format, true); v.setUint16(22, channels, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * channels * bits / 8, true);
  v.setUint16(32, channels * bits / 8, true); v.setUint16(34, bits, true);
  let p = 36;
  if (extraChunk) { str(p, "LIST"); v.setUint32(p + 4, 4, true); str(p + 8, "INFO"); p += 12; }
  str(p, "data"); v.setUint32(p + 4, data.length, true); buf.set(data, p + 8);
  return buf;
}

test("parseWav finds the data chunk after LIST chunks and keeps rate/channels", () => {
  const pcm = new Uint8Array(new Int16Array([0, 16384, -32768, 32767]).buffer);
  const out = parseWav(wav(1, 16, 2, 48000, pcm, true));
  assert.equal(out.sampleRate, 48000);
  assert.equal(out.channels, 2);
  assert.deepEqual(Array.from(out.samples), [0, 0.5, -1, 32767 / 32768]);

  const f32 = new Uint8Array(new Float32Array([0.25, -0.75]).buffer);
  assert.deepEqual(Array.from(parseWav(wav(3, 32, 1, 44100, f32)).samples), [0.25, -0.75]);

  const s24 = new Uint8Array([0x00, 0x00, 0x80, 0xff, 0xff, 0x7f]);
  assert.deepEqual(Array.from(parseWav(wav(1, 24, 1, 8000, s24)).samples), [-1, 0x7fffff / 0x800000]);
  assert.throws(() => parseWav(enc.encode("not a wav file")));
});

// ── SQLite helpers ──

test("SQLite CSV export quotes values and identifiers", () => {
  assert.equal(sqliteValueToCsv(null), "");
  assert.equal(sqliteValueToCsv("a, \"b\""), '"a, ""b"""');
  assert.equal(sqliteValueToCsv(3.5), "3.5");
  assert.equal(sqliteValueToCsv(new Uint8Array([0, 255])), "00ff");
  assert.equal(quoteIdentifier('my "table"'), '"my ""table"""');
});

// ── VTF ──

test("decodeVTF reads a 7.2 RGBA8888 texture past its mipmaps", () => {
  const headerSize = 80;
  const top = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]; // 2x2 RGBA
  const mip1 = [99, 99, 99, 99]; // 1x1, stored first (smallest to largest)
  const bytes = new Uint8Array(headerSize + mip1.length + top.length);
  const v = new DataView(bytes.buffer);
  bytes.set([0x56, 0x54, 0x46, 0]);
  v.setUint32(4, 7, true); v.setUint32(8, 2, true); v.setUint32(12, headerSize, true);
  v.setUint16(16, 2, true); v.setUint16(18, 2, true);
  v.setUint16(24, 1, true); // frames
  v.setInt32(52, 0, true); // RGBA8888
  bytes[56] = 2; // mipmaps
  v.setInt32(57, -1, true); // no low-res image
  v.setUint16(63, 1, true); // depth
  bytes.set(mip1, headerSize);
  bytes.set(top, headerSize + mip1.length);
  const decoded = decodeVTF(bytes);
  assert.equal(decoded.width, 2);
  assert.deepEqual(Array.from(decoded.pixels), top);
});
