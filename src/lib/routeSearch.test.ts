import assert from "node:assert/strict";
import test from "node:test";
import type { FileData, FileFormat, FormatHandler } from "../FormatHandler.ts";
import { NarrationError } from "./narration.ts";
import { isFaithfulNarrationPath, requiresNarration, searchConvertPath, type FormatOption, type RouteProgress } from "./routeSearch.ts";

// In-memory handlers shaped like the real registry: canvasToBlob renders text
// as an image and images as ASCII art, meyda sonifies images as spectrograms,
// FFmpeg encodes audio, and narration reads text aloud.

const fmt = (format: string, mime: string, from: boolean, to: boolean, internal = format): FileFormat =>
  ({ name: format, format, extension: format, mime, from, to, internal });

interface Setup {
  calls: string[];
  handlers: FormatHandler[];
  narrate?: (handler: FormatHandler, file: FileData) => Uint8Array;
}

function makeHandler(
  setup: Setup,
  name: string,
  formats: FileFormat[],
  convert: (file: FileData, from: FileFormat, to: FileFormat, handler: FormatHandler) => Uint8Array
): FormatHandler {
  const handler: FormatHandler = {
    name,
    supportedFormats: formats,
    ready: true,
    async init() {},
    async doConvert(files, from, to) {
      setup.calls.push(`${name}:${from.format}->${to.format}`);
      return files.map((file) => ({ name: `${file.name}.${to.extension}`, bytes: convert(file, from, to, handler) }));
    },
  };
  setup.handlers.push(handler);
  return handler;
}

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (data: Uint8Array) => new TextDecoder().decode(data);

function registry(narrate?: Setup["narrate"]) {
  const setup: Setup = { calls: [], handlers: [], narrate };
  makeHandler(setup, "canvasToBlob", [
    fmt("png", "image/png", true, true), fmt("jpeg", "image/jpeg", true, true), fmt("text", "text/plain", true, true),
  ], (file, from, to) => bytes(to.format === "text" ? "ASCII ART" : `${to.format}(${text(file.bytes)})`));
  makeHandler(setup, "narration", [
    fmt("text", "text/plain", true, false), fmt("png", "image/png", true, false), fmt("wav", "audio/wav", false, true, "speech"),
  ], (file, _from, _to, handler) => setup.narrate ? setup.narrate(handler, file) : bytes(`speech(${text(file.bytes)})`));
  makeHandler(setup, "meyda", [
    fmt("png", "image/png", true, true), fmt("wav", "audio/wav", true, true),
  ], (file, _from, to) => bytes(to.format === "wav" ? `spectrogram(${text(file.bytes)})` : `picture(${text(file.bytes)})`));
  makeHandler(setup, "FFmpeg", [
    fmt("wav", "audio/wav", true, true), fmt("mp3", "audio/mpeg", true, true), fmt("png", "image/png", true, false),
  ], (file, from) => {
    if (from.format === "png") throw new Error("No audio stream in an image.");
    return bytes(`mp3(${text(file.bytes)})`);
  });
  return setup;
}

function search(setup: Setup, inputMime: string, target: { handler: string; format: string }, simpleMode: boolean, progress?: RouteProgress[]) {
  const formatCache = new Map(setup.handlers.map((h) => [h.name, h.supportedFormats!]));
  const allOptions: FormatOption[] = setup.handlers.flatMap((handler) =>
    handler.supportedFormats!.map((format) => ({ format, handler })));
  const input = allOptions.find((o) => o.format.mime === inputMime && o.format.from)!;
  const output = allOptions.find((o) => o.handler.name === target.handler && o.format.format === target.format && o.format.to)!;
  return searchConvertPath({
    handlers: setup.handlers,
    formatCache,
    files: [{ name: "input", bytes: bytes("Hello world") }],
    input,
    target: output,
    simpleMode,
    allOptions,
    progress: progress && { onRouteProgress: (info) => progress.push(info) },
  });
}

const route = (result: Awaited<ReturnType<typeof searchConvertPath>>) =>
  result?.path.map((node, i) => (i === 0 ? node.format.format : `${node.handler.name}:${node.format.format}`)).join(" > ");

test("only text and image to audio requires narration", () => {
  assert.equal(requiresNarration("image/png", "audio/mpeg"), true);
  assert.equal(requiresNarration("text/plain", "audio/wav"), true);
  assert.equal(requiresNarration("audio/wav", "audio/mpeg"), false);
  assert.equal(requiresNarration("image/png", "image/jpeg"), false);
  assert.equal(requiresNarration("video/mp4", "audio/mpeg"), false);
});

test("simple mode speaks images instead of sonifying them", async () => {
  const setup = registry();
  const wav = await search(setup, "image/png", { handler: "meyda", format: "wav" }, true);
  assert.equal(route(wav), "png > narration:wav");
  assert.equal(text(wav!.files[0].bytes), "speech(Hello world)");

  setup.calls.length = 0;
  const mp3 = await search(setup, "image/png", { handler: "FFmpeg", format: "mp3" }, true);
  assert.equal(route(mp3), "png > narration:wav > FFmpeg:mp3");
  assert.equal(text(mp3!.files[0].bytes), "mp3(speech(Hello world))");
  assert.deepEqual(setup.calls, ["narration:png->wav", "FFmpeg:wav->mp3"]);
});

test("simple mode reads text files aloud, then encodes to other audio formats", async () => {
  const setup = registry();
  const mp3 = await search(setup, "text/plain", { handler: "FFmpeg", format: "mp3" }, true);
  assert.equal(route(mp3), "text > narration:wav > FFmpeg:mp3");
  assert.deepEqual(setup.calls, ["narration:text->wav", "FFmpeg:wav->mp3"]);
});

test("an input first registered by narration can still produce spoken audio", async () => {
  const setup = registry();
  setup.handlers.find((handler) => handler.name === "narration")!.supportedFormats!
    .push(fmt("bmp", "image/bmp", true, false));

  const wav = await search(setup, "image/bmp", { handler: "narration", format: "wav" }, true);
  assert.equal(route(wav), "bmp > narration:wav");
  assert.equal(text(wav!.files[0].bytes), "speech(Hello world)");

  const mp3 = await search(setup, "image/bmp", { handler: "FFmpeg", format: "mp3" }, true);
  assert.equal(route(mp3), "bmp > narration:wav > FFmpeg:mp3");
});

test("a narration failure ends the conversion instead of falling back", async () => {
  const setup = registry(() => { throw new NarrationError("No readable text was found in this image."); });
  const progress: RouteProgress[] = [];
  await assert.rejects(
    search(setup, "image/png", { handler: "FFmpeg", format: "mp3" }, true, progress),
    { name: "NarrationError", message: "No readable text was found in this image." }
  );
  assert.deepEqual(setup.calls, ["narration:png->wav"]);
  assert.equal(progress.at(-1)?.message, "No readable text was found in this image.");
  assert.equal(progress.at(-1)?.steps[1].status, "failed");
});

test("simple mode never substitutes spectrograms or narrated ASCII art", async () => {
  // Even an ordinary (non-fatal) narration failure must not fall back.
  const setup = registry(() => { throw new Error("worker crashed"); });
  assert.equal(await search(setup, "image/png", { handler: "FFmpeg", format: "mp3" }, true), null);
  assert.ok(setup.calls.includes("narration:png->wav"));
  // Image-to-image re-encodes ahead of narration are fine; anything that
  // produces audio or text any other way is not.
  for (const call of setup.calls) {
    const [handler, hop] = call.split(":");
    const [from, to] = hop.split("->");
    const imageHop = ["png", "jpeg"].includes(from) && ["png", "jpeg"].includes(to);
    assert.ok(handler === "narration" || imageHop, `unexpected step ${call}`);
  }
});

test("faithful narration routes only re-encode around the narration step", () => {
  const setup = registry();
  const node = (handler: string, format: string) => {
    const h = setup.handlers.find((x) => x.name === handler)!;
    return { handler: h, format: h.supportedFormats!.find((f) => f.format === format)! };
  };
  const png = node("canvasToBlob", "png");
  assert.equal(isFaithfulNarrationPath([png, node("narration", "wav")]), true);
  assert.equal(isFaithfulNarrationPath([png, node("canvasToBlob", "jpeg"), node("narration", "wav"), node("FFmpeg", "mp3")]), true);
  assert.equal(isFaithfulNarrationPath([png, node("canvasToBlob", "text"), node("narration", "wav")]), false);
  assert.equal(isFaithfulNarrationPath([png, node("narration", "wav"), node("meyda", "png")]), false);
  assert.equal(isFaithfulNarrationPath([png, node("meyda", "wav"), node("FFmpeg", "mp3")]), false);
});

test("advanced mode still honours an explicitly chosen spectrogram handler", async () => {
  const setup = registry();
  const wav = await search(setup, "image/png", { handler: "meyda", format: "wav" }, false);
  assert.equal(route(wav), "png > meyda:wav");
  assert.equal(text(wav!.files[0].bytes), "spectrogram(Hello world)");
});

test("unrelated conversions route as before", async () => {
  const setup = registry();
  const jpeg = await search(setup, "image/png", { handler: "canvasToBlob", format: "jpeg" }, true);
  assert.equal(route(jpeg), "png > canvasToBlob:jpeg");
  const ascii = await search(setup, "image/png", { handler: "canvasToBlob", format: "text" }, true);
  assert.equal(text(ascii!.files[0].bytes), "ASCII ART");
  const picture = await search(setup, "audio/wav", { handler: "meyda", format: "png" }, true);
  assert.equal(route(picture), "wav > meyda:png");
});

test("handler progress messages reach the route display and are then cleared", async () => {
  const setup = registry((handler, file) => {
    handler.onProgress?.("Speaking part 1 of 1");
    return bytes(`speech(${text(file.bytes)})`);
  });
  const progress: RouteProgress[] = [];
  await search(setup, "text/plain", { handler: "narration", format: "wav" }, true, progress);
  const update = progress.find((p) => p.message === "Speaking part 1 of 1");
  assert.ok(update);
  assert.equal(update.steps[1].status, "active");
  assert.equal(update.steps[1].handler, "narration");
  assert.equal(setup.handlers.find((h) => h.name === "narration")!.onProgress, undefined);
});
