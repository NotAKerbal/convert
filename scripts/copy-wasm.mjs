import { cp, mkdir, access } from "node:fs/promises";
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

console.log(`Copied ${targets.length} WASM assets to public/wasm.`);
