import { FatalConversionError } from "../FormatHandler.ts";

// Pure helpers for turning text into narration: cleanup, sentence-aware
// chunking for the speech model, and WAV encoding. Nothing here touches the
// DOM, so it can be unit-tested in Node.

/** Kokoro voice model on the Hugging Face Hub (Apache-2.0). */
export const KOKORO_MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
/** Kokoro's highest-rated voice (overall grade A). */
export const KOKORO_DEFAULT_VOICE = "af_heart";
export const KOKORO_SAMPLE_RATE = 24000;
/** Approximate first-use downloads, used to explain the wait to the user. */
export const KOKORO_DOWNLOAD_MB = { webgpu: 326, wasm: 92 } as const;

/**
 * Longest chunk handed to the speech model at once. Kokoro reads at most 510
 * phoneme tokens per call and silently drops the rest, so chunks stay well
 * below that; the worker also re-splits any chunk that still turns out too
 * long rather than truncating it.
 */
export const DEFAULT_CHUNK_CHARS = 300;

const PARAGRAPH_PAUSE_MS = 450;
const SENTENCE_PAUSE_MS = 150;
const CLAUSE_PAUSE_MS = 60;

export class NarrationError extends FatalConversionError {
  constructor(message: string) {
    super(message);
    this.name = "NarrationError";
  }
}

export const EMPTY_TEXT_MESSAGE =
  "There is no text to read aloud. The file is empty or contains no words.";
export const NO_IMAGE_TEXT_MESSAGE =
  "No readable text was found in this image, so there is nothing to read aloud. "
  + "Narration works best with clear, horizontal printed text.";

export interface NarrationChunk {
  text: string;
  /** Silence to insert after this chunk. */
  pauseAfterMs: number;
}

/** Whether {@link text} contains anything a voice could say. */
export function hasSpeakableText(text: string) {
  return /[\p{L}\p{N}]/u.test(text);
}

/** Decodes a text file, honouring UTF-8 and UTF-16 byte order marks. */
export function decodeTextBytes(bytes: Uint8Array) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  return new TextDecoder("utf-8").decode(bytes);
}

/**
 * Removes OCR noise: lines with no letters or digits (stray rules, borders,
 * speckles) are dropped. Blank lines are kept as paragraph breaks.
 */
export function cleanOcrText(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => line.trim() === "" || hasSpeakableText(line))
    .join("\n");
}

/** Words Tesseract is less sure of than this (0–100) are treated as noise. */
export const MIN_OCR_WORD_CONFIDENCE = 50;
/** Lone letters (other than "a" and "I") are common noise, so need more. */
const MIN_OCR_LONE_LETTER_CONFIDENCE = 80;

function isConfidentOcrWord({ text, confidence }: { text: string; confidence: number }, minConfidence: number) {
  if (confidence < minConfidence || !hasSpeakableText(text)) return false;
  const letters = text.replace(/[^\p{L}\p{N}]/gu, "");
  const loneLetter = letters.length === 1 && /\p{L}/u.test(letters) && !/^[aAI]$/.test(letters);
  return !loneLetter || confidence >= MIN_OCR_LONE_LETTER_CONFIDENCE;
}

export interface OcrBlock {
  paragraphs: Array<{ lines: Array<{ words: Array<{ text: string; confidence: number }> }> }>;
}

/**
 * Rebuilds OCR text from Tesseract's layout, keeping only confidently read
 * words. Textures, gradients, and photos otherwise come back as plausible-
 * looking gibberish ("Cdae i. Sie. Saat.") that would be read aloud.
 */
export function textFromOcrBlocks(blocks: OcrBlock[], minConfidence = MIN_OCR_WORD_CONFIDENCE) {
  const paragraphs: string[] = [];
  for (const block of blocks) {
    for (const paragraph of block.paragraphs) {
      const lines = paragraph.lines
        .map((line) => line.words
          .filter((word) => isConfidentOcrWord(word, minConfidence))
          .map((word) => word.text.trim())
          .join(" "))
        .filter(Boolean);
      if (lines.length) paragraphs.push(lines.join("\n"));
    }
  }
  return paragraphs.join("\n\n");
}

const BULLET =/^\s*(?:[•◦▪▫‣∙·●○■□➢➤►▶*]|[-–—](?=\s))\s*/u;
const TERMINAL = /[.!?…:;]["'”’)\]]*$/u;

/**
 * Normalizes text for reading aloud while keeping every word: hard-wrapped
 * lines are rejoined, words hyphenated across lines are mended, bullets are
 * dropped, and short heading-like lines get a full stop so they are read as
 * their own sentence instead of running into the next line.
 */
export function normalizeNarrationText(raw: string) {
  const text = raw
    .replace(/\r\n?/g, "\n")
    // Control characters other than tab and newline.
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f​﻿]/g, "")
    .replace(/­/g, "")
    .replace(/(\p{L})-\n[ \t]*(\p{Ll})/gu, "$1$2");

  const paragraphs: string[] = [];
  for (const block of text.split(/\n[ \t]*\n+/)) {
    const lines = block
      .split("\n")
      .map((line) => ({
        bullet: BULLET.test(line),
        text: line.replace(BULLET, "").replace(/[ \t]+/g, " ").trim(),
      }))
      .filter((line) => line.text);
    // Hard-wrapped prose fills most of the column; a line well short of it
    // that is followed by a capitalized line is a heading or list entry.
    const width = lines.reduce((max, line) => Math.max(max, line.text.length), 0);
    let paragraph = "";
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].text;
      const next = lines[i + 1];
      const separate = next !== undefined && (
        next.bullet || lines[i].bullet
        || (/^[\p{Lu}\p{N}"“'‘(]/u.test(next.text) && (width < 40 || line.length < width * 0.6))
      );
      if (separate && !TERMINAL.test(line) && /[\p{L}\p{N}]$/u.test(line)) line += ".";
      paragraph += (paragraph ? " " : "") + line;
    }
    if (paragraph) paragraphs.push(paragraph);
  }
  return paragraphs.join("\n\n");
}

const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "mt", "vs", "etc", "no",
  "e.g", "i.e", "fig", "inc", "ltd", "co", "dept", "approx", "jan", "feb",
  "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
]);

/** Splits a paragraph into sentences, keeping all of its text. */
export function splitSentences(paragraph: string): string[] {
  const sentences: string[] = [];
  const boundary = /[.!?…]+["'”’)\]]*\s+/gu;
  let start = 0;
  for (const match of paragraph.matchAll(boundary)) {
    const end = match.index! + match[0].length;
    const next = paragraph[end];
    // Only break where the next sentence plausibly starts.
    if (next === undefined || !/[\p{Lu}\p{N}"“'‘(\[]/u.test(next)) continue;
    const before = paragraph.slice(start, match.index! + 1);
    const lastWord = before.split(/\s+/).at(-1)?.replace(/^[("'“‘\[]+/, "") ?? "";
    const bare = lastWord.replace(/\.$/, "").toLowerCase();
    if (match[0].startsWith(".") && (ABBREVIATIONS.has(bare) || /^\p{L}$/u.test(bare))) continue;
    sentences.push(paragraph.slice(start, end).trim());
    start = end;
  }
  const rest = paragraph.slice(start).trim();
  if (rest) sentences.push(rest);
  return sentences;
}

/** Splits text longer than {@link maxChars} at clause punctuation, then words. */
function splitLong(sentence: string, maxChars: number): string[] {
  if (sentence.length <= maxChars) return [sentence];
  const clauses = sentence.split(/(?<=[,;:—–)])\s+/u);
  const pieces = clauses.length > 1 ? clauses : sentence.split(/\s+/);
  const out: string[] = [];
  let current = "";
  for (const piece of pieces) {
    if (piece.length > maxChars) {
      if (current) { out.push(current); current = ""; }
      if (clauses.length > 1) {
        out.push(...splitLong(piece, maxChars));
      } else {
        // A single "word" longer than a chunk (e.g. a long URL).
        for (let i = 0; i < piece.length; i += maxChars) out.push(piece.slice(i, i + maxChars));
      }
      continue;
    }
    const joined = current ? `${current} ${piece}` : piece;
    if (joined.length > maxChars) {
      out.push(current);
      current = piece;
    } else {
      current = joined;
    }
  }
  if (current) out.push(current);
  return out;
}

/**
 * Splits normalized text into model-sized chunks on sentence boundaries,
 * packing short sentences together for natural prosody. Every word of the
 * input appears in exactly one chunk, in order.
 */
export function chunkNarrationText(text: string, maxChars = DEFAULT_CHUNK_CHARS): NarrationChunk[] {
  const chunks: NarrationChunk[] = [];
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  for (const paragraph of paragraphs) {
    const units: Array<{ text: string; endsSentence: boolean }> = [];
    for (const sentence of splitSentences(paragraph)) {
      const parts = splitLong(sentence, maxChars);
      parts.forEach((part, i) => units.push({ text: part, endsSentence: i === parts.length - 1 }));
    }

    let current: { text: string; endsSentence: boolean } | null = null;
    for (const unit of units) {
      if (current && current.endsSentence && current.text.length + 1 + unit.text.length <= maxChars) {
        current = { text: `${current.text} ${unit.text}`, endsSentence: unit.endsSentence };
        continue;
      }
      if (current) {
        chunks.push({ text: current.text, pauseAfterMs: current.endsSentence ? SENTENCE_PAUSE_MS : CLAUSE_PAUSE_MS });
      }
      current = unit;
    }
    if (current) chunks.push({ text: current.text, pauseAfterMs: PARAGRAPH_PAUSE_MS });
  }
  if (chunks.length) chunks[chunks.length - 1].pauseAfterMs = 0;
  return chunks;
}

/**
 * Prepares text for narration: normalizes it, checks there is something to
 * say, and chunks it. Throws a {@link NarrationError} for empty input.
 */
export function prepareNarration(raw: string, emptyMessage = EMPTY_TEXT_MESSAGE, maxChars = DEFAULT_CHUNK_CHARS) {
  const text = normalizeNarrationText(raw);
  if (!hasSpeakableText(text)) throw new NarrationError(emptyMessage);
  return { text, chunks: chunkNarrationText(text, maxChars) };
}

/** Splits an over-long chunk in two at the word boundary nearest its middle. */
export function halveChunkText(text: string): [string, string] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 2) {
    const mid = Math.ceil(text.length / 2);
    return [text.slice(0, mid), text.slice(mid)];
  }
  const mid = Math.ceil(words.length / 2);
  return [words.slice(0, mid).join(" "), words.slice(mid).join(" ")];
}

/** Joins audio segments, inserting each segment's trailing silence. */
export function joinAudioSegments(
  segments: Array<{ samples: Float32Array; pauseAfterMs: number }>,
  sampleRate: number
) {
  const pauseSamples = segments.map((s) => Math.round((s.pauseAfterMs / 1000) * sampleRate));
  const total = segments.reduce((sum, s, i) => sum + s.samples.length + pauseSamples[i], 0);
  const out = new Float32Array(total);
  let offset = 0;
  segments.forEach((s, i) => {
    out.set(s.samples, offset);
    offset += s.samples.length + pauseSamples[i];
  });
  return out;
}

/** Encodes mono samples in [-1, 1] as a 16-bit PCM WAV file. */
export function encodeWavPcm16(samples: Float32Array, sampleRate: number) {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const ascii = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] || 0));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}
