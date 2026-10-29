import assert from "node:assert/strict";
import test from "node:test";
import { FatalConversionError } from "../FormatHandler.ts";
import {
  EMPTY_TEXT_MESSAGE,
  NO_IMAGE_TEXT_MESSAGE,
  NarrationError,
  chunkNarrationText,
  cleanOcrText,
  decodeTextBytes,
  encodeWavPcm16,
  halveChunkText,
  joinAudioSegments,
  normalizeNarrationText,
  prepareNarration,
  splitSentences,
  textFromOcrBlocks,
} from "./narration.ts";

const words = (text: string) => text.split(/\s+/).filter(Boolean);

test("normalizing rejoins wrapped lines and mends hyphenated words", () => {
  const ocr = [
    "The quick brown fox jumps over the lazy dog while the inter-",
    "national audience watches the whole performance from the",
    "stands, cheering loudly.",
  ].join("\r\n");
  assert.equal(
    normalizeNarrationText(ocr),
    "The quick brown fox jumps over the lazy dog while the international audience "
      + "watches the whole performance from the stands, cheering loudly."
  );
});

test("normalizing keeps paragraphs and ends headings and bullets as sentences", () => {
  const text = "Shopping list\n• Apples\n• Fresh bread\n\n\nCall Sam­ at noon\u0007.";
  assert.equal(
    normalizeNarrationText(text),
    "Shopping list. Apples. Fresh bread\n\nCall Sam at noon."
  );
});

test("line-oriented text beyond the function argument limit still reaches chunking", () => {
  const lineCount = 150000;
  const { text, chunks } = prepareNarration("Hello.\n".repeat(lineCount));
  assert.equal(text, Array(lineCount).fill("Hello.").join(" "));
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.text.length <= 300));
  assert.equal(chunks.map((chunk) => chunk.text).join(" "), text);
});

test("OCR cleanup drops lines without letters or digits", () => {
  assert.equal(cleanOcrText("| — |\nHello there\n~ ~\n\nPage 2"), "Hello there\n\nPage 2");
});

test("OCR text keeps confident words with their line and paragraph layout", () => {
  const words = (...pairs: Array<[string, number]>) => pairs.map(([text, confidence]) => ({ text, confidence }));
  const blocks = [
    { paragraphs: [
      { lines: [{ words: words(["Opening", 96], ["hours", 93]) }, { words: words(["Monday", 91], ["|", 88], ["to", 90], ["Friday.", 89]) }] },
      { lines: [{ words: words(["Cdae", 31], ["i.", 22]) }] },
    ] },
    { paragraphs: [{ lines: [{ words: words(["Closed", 85], ["Sie.", 40], ["Sundays.", 77]) }] }] },
  ];
  assert.equal(textFromOcrBlocks(blocks), "Opening hours\nMonday to Friday.\n\nClosed Sundays.");
  // A textless image yields only low-confidence noise, which is rejected.
  // Lone letters need more confidence than words, except "a" and "I".
  const letters = [{ paragraphs: [{ lines: [{ words: words(["Plan", 92], ["B", 91], ["or", 90], ["a", 70], ["d", 59], ["I", 60], ["7", 60]) }] }] }];
  assert.equal(textFromOcrBlocks(letters), "Plan B or a I 7");
  // Noise measured from a textless gradient image: nothing survives.
  const noise = [{ paragraphs: [{ lines: [{ words: words(["d", 59], ["d", 57], ["gee", 44], ["atta", 36], ["Cdae", 0]) }] }] }];
  assert.throws(() => prepareNarration(textFromOcrBlocks(noise), NO_IMAGE_TEXT_MESSAGE), NarrationError);
});

test("sentences split at real boundaries only", () => {
  assert.deepEqual(
    splitSentences("Dr. Smith paid $3.50 at 5 p.m. today. Was it J. R. R. Tolkien? Yes! \"Quite,\" she said… Then left."),
    ["Dr. Smith paid $3.50 at 5 p.m. today.", "Was it J. R. R. Tolkien?", "Yes!", "\"Quite,\" she said…", "Then left."]
  );
});

test("chunking keeps every word, in order, without exceeding the limit", () => {
  const sentence = (i: number) => `Sentence number ${i} talks about item ${i * 7}, which matters.`;
  const longSentence = Array.from({ length: 120 }, (_, i) => `word${i}`).join(" ") + ".";
  const longClauses = Array.from({ length: 30 }, (_, i) => `clause ${i} keeps going`).join(", ") + ".";
  const url = "https://example.com/" + "a".repeat(700);
  const text = normalizeNarrationText([
    Array.from({ length: 40 }, (_, i) => sentence(i)).join(" "),
    longSentence,
    `${longClauses} See ${url} now.`,
  ].join("\n\n"));

  const maxChars = 200;
  const chunks = chunkNarrationText(text, maxChars);
  assert.ok(chunks.length > 10);
  for (const chunk of chunks) assert.ok(chunk.text.length <= maxChars, chunk.text);
  // The URL is split mid-word, so compare the text without whitespace.
  assert.equal(chunks.map((c) => c.text).join("").replace(/\s+/g, ""), text.replace(/\s+/g, ""));
  assert.deepEqual(
    words(chunks.map((c) => c.text).join(" ")).filter((w) => !w.includes("example.com") && !/^a+$/.test(w)),
    words(text).filter((w) => !w.includes("example.com"))
  );
});

test("chunks pack short sentences and pause longer between paragraphs", () => {
  const chunks = chunkNarrationText("One. Two. Three.\n\nFour is here. Five.", 300);
  assert.deepEqual(chunks, [
    { text: "One. Two. Three.", pauseAfterMs: 450 },
    { text: "Four is here. Five.", pauseAfterMs: 0 },
  ]);
  const split = chunkNarrationText("Alpha beta gamma, delta epsilon zeta, eta theta. Iota.", 20);
  assert.deepEqual(split.map((c) => c.text), ["Alpha beta gamma,", "delta epsilon zeta,", "eta theta. Iota."]);
  assert.deepEqual(split.map((c) => c.pauseAfterMs), [60, 60, 0]);
});

test("empty or wordless input is a fatal narration error", () => {
  for (const input of ["", "   \n\n ", "... --- !!!"]) {
    assert.throws(() => prepareNarration(input), (err: unknown) => {
      assert.ok(err instanceof NarrationError);
      assert.ok(err instanceof FatalConversionError);
      assert.equal(err.message, EMPTY_TEXT_MESSAGE);
      return true;
    });
  }
  assert.throws(() => prepareNarration(cleanOcrText("|  ~\n—"), NO_IMAGE_TEXT_MESSAGE), {
    message: NO_IMAGE_TEXT_MESSAGE,
  });
  assert.equal(prepareNarration("Hi.").chunks[0].text, "Hi.");
});

test("text files decode with UTF-8 and UTF-16 byte order marks", () => {
  assert.equal(decodeTextBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x48, 0x69])), "Hi");
  assert.equal(decodeTextBytes(new Uint8Array([0xff, 0xfe, 0x48, 0, 0x69, 0])), "Hi");
  assert.equal(decodeTextBytes(new Uint8Array([0xfe, 0xff, 0, 0x48, 0, 0x69])), "Hi");
});

test("over-long chunks halve at a word boundary without losing text", () => {
  assert.deepEqual(halveChunkText("one two three four five"), ["one two three", "four five"]);
  assert.deepEqual(halveChunkText("abcdef"), ["abc", "def"]);
});

test("audio segments join with their pauses and encode as 16-bit WAV", () => {
  const sampleRate = 1000;
  const joined = joinAudioSegments([
    { samples: new Float32Array([0.5, -0.5]), pauseAfterMs: 3 },
    { samples: new Float32Array([2, -2]), pauseAfterMs: 0 },
  ], sampleRate);
  assert.deepEqual(Array.from(joined), [0.5, -0.5, 0, 0, 0, 2, -2]);

  const wav = encodeWavPcm16(joined, sampleRate);
  const view = new DataView(wav.buffer);
  const ascii = (at: number) => String.fromCharCode(...wav.subarray(at, at + 4));
  assert.equal(ascii(0), "RIFF");
  assert.equal(ascii(8), "WAVE");
  assert.equal(view.getUint32(4, true), wav.length - 8);
  assert.equal(view.getUint16(20, true), 1);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), sampleRate);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), joined.length * 2);
  const samples = Array.from({ length: joined.length }, (_, i) => view.getInt16(44 + i * 2, true));
  assert.deepEqual(samples, [16383, -16384, 0, 0, 0, 32767, -32768]);
});
