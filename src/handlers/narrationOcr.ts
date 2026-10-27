import { textFromOcrBlocks } from "../lib/narration.ts";

// Local OCR for narration: normalizes an image for Tesseract and reads its
// text. Tesseract's worker, engine, and English data are served from this
// site (see scripts/copy-wasm.mjs), so images never leave the browser.

const TESSERACT_BASE = "/wasm/tesseract";
/** Text smaller than this (longest image side, px) is upscaled for OCR. */
const MIN_OCR_SIDE = 1600;
const MAX_OCR_SIDE = 4000;
const MAX_UPSCALE = 3;

async function decodeImage(bytes: Uint8Array, mime: string): Promise<CanvasImageSource & { width: number; height: number }> {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  if (mime !== "image/svg+xml") {
    try {
      return await createImageBitmap(blob);
    } catch {
      // Fall through to <img>, which decodes a few formats bitmaps can't.
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    // SVGs without intrinsic dimensions report 0 x 0.
    if (!image.naturalWidth || !image.naturalHeight) {
      image.width = image.naturalWidth || 1024;
      image.height = image.naturalHeight || 1024;
    } else {
      image.width = image.naturalWidth;
      image.height = image.naturalHeight;
    }
    return image;
  } catch {
    throw new Error("This image could not be decoded by the browser.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Renders the image as large, flattened grayscale with dark text on a light
 * background — the input Tesseract reads most reliably. Transparent areas
 * become white and light-on-dark images (e.g. dark-mode screenshots) are
 * inverted.
 */
export async function normalizeImageForOcr(bytes: Uint8Array, mime: string): Promise<Blob> {
  const image = await decodeImage(bytes, mime);
  const longest = Math.max(image.width, image.height);
  const scale = longest > MAX_OCR_SIDE
    ? MAX_OCR_SIDE / longest
    : Math.min(MAX_UPSCALE, Math.max(1, MIN_OCR_SIDE / longest));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not create a canvas for OCR.");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, width, height);
  if ("close" in image && typeof image.close === "function") image.close();

  const pixels = ctx.getImageData(0, 0, width, height);
  const data = pixels.data;
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
    data[i] = data[i + 1] = data[i + 2] = gray;
    sum += gray;
  }
  if (sum / (data.length / 4) < 110) {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = data[i + 1] = data[i + 2] = 255 - data[i];
    }
  }
  ctx.putImageData(pixels, 0, 0);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  canvas.width = canvas.height = 0;
  if (!blob) throw new Error("Could not prepare the image for OCR.");
  return blob;
}

/** Reads the text in an image with Tesseract (English, LSTM engine). */
export async function recognizeImageText(
  bytes: Uint8Array,
  mime: string,
  onProgress?: (message: string) => void
): Promise<{ text: string; confidence: number }> {
  onProgress?.("Preparing the image for text recognition");
  const image = await normalizeImageForOcr(bytes, mime);

  onProgress?.("Loading the text recognition engine");
  // tesseract.js is CommonJS, so its exports arrive as the module default.
  const { createWorker, OEM } = (await import("tesseract.js")).default;
  const origin = self.location.origin;
  const worker = await createWorker("eng", OEM.LSTM_ONLY, {
    workerPath: `${origin}${TESSERACT_BASE}/worker.min.js`,
    corePath: `${origin}${TESSERACT_BASE}/`,
    langPath: `${origin}${TESSERACT_BASE}/lang`,
    workerBlobURL: false,
    gzip: true,
    // The data is served from this site and cached by the browser already.
    cacheMethod: "none",
    logger: (message) => {
      if (message.status === "recognizing text") {
        onProgress?.(`Reading text from the image: ${Math.round(message.progress * 100)}%`);
      }
    },
  });
  try {
    const { data } = await worker.recognize(image, {}, { blocks: true });
    return { text: textFromOcrBlocks(data.blocks ?? []), confidence: data.confidence ?? 0 };
  } finally {
    await worker.terminate();
  }
}
