import { cp, mkdir, access, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "public", "wasm");

const targets = [
  {
    source: path.join(root, "node_modules", "@flo-audio", "reflo", "reflo_bg.wasm"),
    destination: path.join(outDir, "reflo_bg.wasm")
  },
  {
    source: path.join(root, "src", "handlers", "pandoc", "pandoc.wasm"),
    destination: path.join(outDir, "pandoc.wasm")
  },
  {
    source: path.join(root, "node_modules", "@ffmpeg", "core", "dist", "esm", "ffmpeg-core.js"),
    destination: path.join(outDir, "ffmpeg-core.js")
  },
  {
    source: path.join(root, "node_modules", "@ffmpeg", "core", "dist", "esm", "ffmpeg-core.wasm"),
    destination: path.join(outDir, "ffmpeg-core.wasm")
  },
  {
    source: path.join(root, "node_modules", "@ffmpeg", "core", "dist", "esm", "ffmpeg-core.worker.js"),
    destination: path.join(outDir, "ffmpeg-core.worker.js")
  },
  {
    source: path.join(root, "node_modules", "@imagemagick", "magick-wasm", "dist", "magick.wasm"),
    destination: path.join(outDir, "magick.wasm")
  },
  {
    source: path.join(root, "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs"),
    destination: path.join(outDir, "pdf.worker.min.mjs")
  },
  // Narration: ONNX Runtime for the Kokoro voice model, plus Tesseract OCR
  // (worker, LSTM engine builds, and English data) so neither loads from a CDN.
  ...["ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm"].map((file) => ({
    source: path.join(root, "node_modules", "onnxruntime-web", "dist", file),
    destination: path.join(outDir, "ort", file)
  })),
  {
    source: path.join(root, "node_modules", "tesseract.js", "dist", "worker.min.js"),
    destination: path.join(outDir, "tesseract", "worker.min.js")
  },
  ...["tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js", "tesseract-core-relaxedsimd-lstm.wasm.js"].map((file) => ({
    source: path.join(root, "node_modules", "tesseract.js-core", file),
    destination: path.join(outDir, "tesseract", file)
  })),
  {
    source: path.join(root, "node_modules", "@tesseract.js-data", "eng", "4.0.0_best_int", "eng.traineddata.gz"),
    destination: path.join(outDir, "tesseract", "lang", "eng.traineddata.gz")
  }
];

await mkdir(outDir, { recursive: true });

for (const target of targets) {
  try {
    await access(target.source);
    await mkdir(path.dirname(target.destination), { recursive: true });
    await cp(target.source, target.destination, { force: true });
  } catch {
    console.warn(`Skipping missing asset: ${path.relative(root, target.source)}`);
  }
}

// Copy the @ffmpeg/ffmpeg ESM worker as *static* files. Bundling the worker
// (the default behaviour) breaks ffmpeg.wasm because webpack rewrites the
// worker's runtime `import(coreURL)` call. Serving the worker untouched lets
// the browser resolve the core module natively.
const ffmpegWorkerSrc = path.join(root, "node_modules", "@ffmpeg", "ffmpeg", "dist", "esm");
const ffmpegWorkerDest = path.join(outDir, "ffmpeg");
try {
  await mkdir(ffmpegWorkerDest, { recursive: true });
  const entries = await readdir(ffmpegWorkerSrc);
  for (const entry of entries) {
    if (!entry.endsWith(".js")) continue;
    await cp(path.join(ffmpegWorkerSrc, entry), path.join(ffmpegWorkerDest, entry), { force: true });
  }
} catch {
  console.warn("Skipping missing asset: @ffmpeg/ffmpeg ESM worker");
}

console.log(`Copied ${targets.length} WASM assets to public/wasm.`);
