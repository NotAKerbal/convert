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
    source: path.join(root, "node_modules", "@imagemagick", "magick-wasm", "dist", "magick.wasm"),
    destination: path.join(outDir, "magick.wasm")
  },
  {
    // Loaded via `locateFile` in src/handlers/sqlite.ts.
    source: path.join(root, "node_modules", "@sqlite.org", "sqlite-wasm", "dist", "sqlite3.wasm"),
    destination: path.join(outDir, "sqlite3.wasm")
  },
  {
    source: path.join(root, "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs"),
    destination: path.join(outDir, "pdf.worker.min.mjs")
  }
];

await mkdir(outDir, { recursive: true });

for (const target of targets) {
  try {
    await access(target.source);
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
