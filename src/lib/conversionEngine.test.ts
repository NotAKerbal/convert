import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test, { mock } from "node:test";
import type { FileData, FileFormat, FormatHandler } from "../FormatHandler.ts";

// Keep the real routing engine and ZIP implementation, while providing small,
// deterministic handlers instead of loading browser-only WASM into Node.
const registryURL = new URL("../../tests/fixtures/handlerRegistry.ts", import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "../handlers" && context.parentURL?.endsWith("/conversionEngine.ts")) {
      return { url: registryURL, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const { default: handlers } = await import("../../tests/fixtures/handlerRegistry.ts");
const engine = await import("./conversionEngine.ts");
// Failed routes are deliberate fixtures; the assertions below check recovery.
mock.method(console, "error", () => {});

function fmt(format: string, mime = `test/${format}`, extra: Partial<FileFormat> = {}): FileFormat {
  return { name: format, format, extension: format, mime, internal: format, from: true, to: true, ...extra };
}
function handler(name: string, formats: FileFormat[], convert: FormatHandler["doConvert"]): FormatHandler {
  return { name, supportedFormats: formats, ready: true, async init() { this.ready = true; }, doConvert: convert };
}
const bytes = (text: string) => new TextEncoder().encode(text);
const text = (data: Uint8Array) => new TextDecoder().decode(data);
const output = (value: string): FileData[] => [{ name: "result.out", bytes: bytes(value) }];
function setup(...items: FormatHandler[]) {
  handlers.splice(0, handlers.length, ...items);
  engine.supportedFormatCache.clear();
  for (const h of items) engine.supportedFormatCache.set(h.name, h.supportedFormats!);
  return engine.buildFormatLists(false).allOptions;
}
async function convert(allOptions: ReturnType<typeof setup>, input: FileFormat, target: FileFormat, simpleMode = true) {
  const result = await engine.runConversion({
    selectedFiles: [new File(["source"], "source.dat")],
    inputOption: allOptions.find((o) => o.format === input)!,
    outputOption: allOptions.find((o) => o.format === target)!, allOptions, simpleMode,
  });
  engine.revokeOutputFiles(result.files);
  return result;
}

test("same MIME formats still run the requested encoder", async () => {
  const mp3 = fmt("mp3", "audio/mpeg");
  const mp2 = fmt("mp2", "audio/mpeg");
  const options = setup(handler("audio", [mp3, mp2], async (_, input, target) => {
    assert.equal(input.internal, "mp3"); assert.equal(target.internal, "mp2");
    return output("mp2 encoded");
  }));
  assert.equal(text((await convert(options, mp3, mp2)).files[0].bytes), "mp2 encoded");
});

test("same-MIME input dialect uses the selected reader", async () => {
  const commonmark = fmt("commonmark", "text/markdown");
  const gfm = fmt("gfm", "text/markdown");
  const html = fmt("html", "text/html");
  const options = setup(handler("pandoc", [commonmark, gfm, html], async (_, input) => {
    assert.equal(input.internal, "gfm"); return output("gfm rendered");
  }));
  assert.equal(text((await convert(options, gfm, html)).files[0].bytes), "gfm rendered");
});

test("a failed encoder does not silently produce another format with the same MIME", async () => {
  const wav = fmt("wav"); const mp3 = fmt("mp3", "audio/mpeg"); const mp2 = fmt("mp2", "audio/mpeg");
  const options = setup(handler("audio", [wav, mp3, mp2], async (_, __, target) => {
    if (target === mp3) throw new Error("encoder unavailable");
    return output("wrong format");
  }));
  await assert.rejects(convert(options, wav, mp3), /Failed to find conversion route/);
});

test("any-input handlers work even when the source has no ordinary outgoing edge", async () => {
  const source = fmt("raw", "application/octet-stream", { from: false, to: false });
  const zip = fmt("zip", "application/zip", { from: false });
  const archive = handler("zip", [zip], async (files, input) => {
    assert.equal(input, source); assert.equal(text(files[0].bytes), "source"); return output("archive");
  });
  archive.supportAnyInput = true;
  const options = setup(handler("source", [source], async () => []), archive);
  assert.equal(text((await convert(options, source, zip)).files[0].bytes), "archive");
});

test("fallback routes reuse only the matching successful prefix", async () => {
  const a = fmt("a"); const b = fmt("b"); const c = fmt("c"); const d = fmt("d");
  const trace: string[] = [];
  const options = setup(
    handler("first", [a, b], async () => { trace.push("a-b"); return output("b"); }),
    handler("second", [b, c, d], async (files, input, target) => {
      trace.push(`${input.format}-${target.format}:${text(files[0].bytes)}`);
      if (target === d && input === b) throw new Error("try c");
      if (input === b && target === c) return output("c");
      if (input === c && target === d && text(files[0].bytes) === "c") return output("done");
      throw new Error("invalid prefix");
    }),
  );
  assert.equal(text((await convert(options, a, d)).files[0].bytes), "done");
  assert.equal(trace.filter((s) => s === "a-b").length, 1);
});

test("routes through separate handlers with identical format labels remain distinct", async () => {
  const a = fmt("a"); const b1 = fmt("b"); const b2 = fmt("b"); const d = fmt("d");
  const options = setup(
    handler("bad-bridge", [a, b1], async () => output("bad")),
    handler("good-bridge", [a, b2], async () => output("good")),
    handler("finish", [b1, d], async (files) => {
      if (text(files[0].bytes) !== "good") throw new Error("bad intermediate"); return output("done");
    }),
  );
  assert.equal(text((await convert(options, a, d)).files[0].bytes), "done");
});

test("empty result arrays fail and allow a working handler to run", async () => {
  const a = fmt("a"); const b = fmt("b");
  const options = setup(handler("empty", [a, b], async () => []), handler("working", [a, b], async () => output("done")));
  assert.equal(text((await convert(options, a, b)).files[0].bytes), "done");
});

test("a valid empty text output remains a successful conversion", async () => {
  const a = fmt("a"); const b = fmt("text", "text/plain");
  const options = setup(handler("text", [a, b], async () => output("")));
  assert.equal((await convert(options, a, b)).files[0].size, 0);
});

test("an empty binary output fails instead of creating a corrupt download", async () => {
  const a = fmt("a"); const b = fmt("pdf", "application/pdf");
  const options = setup(handler("empty", [a, b], async () => output("")));
  await assert.rejects(convert(options, a, b), /Failed to find conversion route/);
});

test("failed handlers cannot mutate the input used for fallback", async () => {
  const a = fmt("a"); const b = fmt("b");
  const options = setup(
    handler("mutating", [a, b], async (files) => { files[0].bytes.fill(0); files[0].name = "changed"; throw new Error("failed"); }),
    handler("working", [a, b], async (files) => { assert.equal(files[0].name, "source.dat"); return output(text(files[0].bytes)); }),
  );
  assert.equal(text((await convert(options, a, b)).files[0].bytes), "source");
});

test("concurrent conversions do not share intermediate files", async () => {
  const a = fmt("a"); const b = fmt("b"); const c = fmt("c");
  const options = setup(
    handler("bridge", [a, b], async (files) => { await new Promise((r) => setTimeout(r, 5)); return output(text(files[0].bytes)); }),
    handler("finish", [b, c], async (files) => output(text(files[0].bytes))),
  );
  const results = await Promise.all(["one", "two"].map((value) => engine.runConversion({
    selectedFiles: [new File([value], `${value}.a`)], inputOption: options[0],
    outputOption: options.at(-1)!, allOptions: options, simpleMode: true,
  })));
  assert.deepEqual(results.map((r) => text(r.files[0].bytes)), ["one", "two"]);
  results.forEach((r) => engine.revokeOutputFiles(r.files));
});

test("file extension disambiguates generic or shared browser MIME types", () => {
  const txt = fmt("text", "text/plain", { extension: "txt" });
  const csv = fmt("csv", "text/csv");
  const options = setup(handler("detect", [txt, csv], async () => []));
  assert.equal(engine.pickInputByFile({ name: "data.CSV", type: "text/plain" }, options, [0, 1])?.format, csv);
  assert.equal(engine.pickInputByFiles([], options, [0, 1]).selectedInputIndex, null);
  const flp = fmt("flp", "application/octet-stream");
  const generic = setup(handler("flp", [flp], async () => []));
  assert.equal(engine.pickInputByFile({ name: "unknown.bin", type: "application/octet-stream" }, generic, [0]), null);
});

test("concurrent warm-up and conversion initialize an engine only once", async () => {
  const a = fmt("a"); const b = fmt("b"); let calls = 0;
  const h = handler("lazy", [a, b], async () => output("done")); h.ready = false;
  h.init = async () => { calls++; await new Promise((r) => setTimeout(r, 10)); h.ready = true; };
  const options = setup(h);
  await Promise.all([engine.warmUpHandlers(), convert(options, a, b)]);
  assert.equal(calls, 1);
});
