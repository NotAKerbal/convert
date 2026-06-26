import type { ConvertPathNode, FileData, FileFormat, FormatHandler } from "../FormatHandler.ts";
import handlers from "../handlers";
import normalizeMimeType from "../normalizeMimeType.ts";
import JSZip from "jszip";

export interface FormatOption {
  format: FileFormat;
  handler: FormatHandler;
}

export interface FormatLists {
  allOptions: FormatOption[];
  inputIndices: number[];
  outputIndices: number[];
}

export interface ConvertResult {
  path: ConvertPathNode[];
  files: OutputFile[];
}

export interface OutputFile {
  name: string;
  bytes: Uint8Array;
  url: string;
  mime: string;
  size: number;
}

export interface ConversionFailure {
  name: string;
  reason: string;
}

export interface RouteStep {
  format: string;
  handler?: string;
  status: "pending" | "active" | "done" | "failed";
}

export interface RouteProgress {
  phase: "searching" | "converting" | "done" | "error";
  steps: RouteStep[];
  currentStepIndex: number;
  pathsExplored: number;
  message?: string;
}

export interface ProgressCallbacks {
  onStatus?: (title: string, detail?: string) => void;
  onRouteProgress?: (info: RouteProgress) => void;
}

// ── category helpers ──

export type FormatCategory = "image" | "audio" | "video" | "application" | "text" | "other";

export const CATEGORY_META: Record<FormatCategory, { label: string; color: string }> = {
  image:       { label: "Image",       color: "#06b6d4" },
  audio:       { label: "Audio",       color: "#a855f7" },
  video:       { label: "Video",       color: "#f43f5e" },
  text:        { label: "Text",        color: "#22c55e" },
  application: { label: "Application", color: "#3b82f6" },
  other:       { label: "Other",       color: "#78716c" },
};

const CATEGORY_ORDER: FormatCategory[] = ["image", "audio", "video", "text", "application", "other"];

export function getFormatCategory(mime: string): FormatCategory {
  const prefix = mime.split("/")[0] as FormatCategory;
  if (prefix in CATEGORY_META) return prefix;
  return "other";
}

export interface CategoryGroup {
  category: FormatCategory;
  label: string;
  color: string;
  indices: number[];
}

export function groupByCategory(indices: number[], allOptions: FormatOption[]): CategoryGroup[] {
  const buckets = new Map<FormatCategory, number[]>();
  for (const idx of indices) {
    const opt = allOptions[idx];
    if (!opt) continue;
    const cat = getFormatCategory(opt.format.mime);
    if (!buckets.has(cat)) buckets.set(cat, []);
    buckets.get(cat)!.push(idx);
  }
  return CATEGORY_ORDER
    .filter((cat) => buckets.has(cat))
    .map((cat) => ({ category: cat, ...CATEGORY_META[cat], indices: buckets.get(cat)! }));
}

// ── label / search ──

export function getOptionLabel(option: FormatOption, simpleMode: boolean) {
  const tag = option.format.format.toUpperCase();
  if (!simpleMode) {
    return `${tag} - ${option.format.name} (${option.format.mime}) ${option.handler.name}`;
  }
  const cleanName = option.format.name
    .split("(").join(")").split(")")
    .filter((_, i) => i % 2 === 0)
    .filter((p) => p !== "")
    .join(" ");
  return `${tag} - ${cleanName} (${option.format.mime})`;
}

export function matchesSearch(option: FormatOption, simpleMode: boolean, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    option.format.extension.toLowerCase().includes(q)
    || getOptionLabel(option, simpleMode).toLowerCase().includes(q)
  );
}

// ── cache / format list building ──

export const supportedFormatCache = new Map<string, FileFormat[]>();

export async function loadCacheFromPublic() {
  try {
    const res = await fetch("/cache.json");
    if (!res.ok) throw new Error("cache.json not found");
    const data = await res.json();
    supportedFormatCache.clear();
    for (const [name, formats] of data) {
      supportedFormatCache.set(name, formats);
    }
  } catch {
    // Missing cache is expected during local dev.
  }
}

let handlersInitialized = false;

export async function initHandlers() {
  if (handlersInitialized) return;
  for (const handler of handlers) {
    if (supportedFormatCache.has(handler.name)) continue;
    try { await handler.init(); } catch (err) {
      console.warn(`Handler "${handler.name}" failed to initialize:`, err);
      continue;
    }
    if (handler.supportedFormats) {
      supportedFormatCache.set(handler.name, handler.supportedFormats);
    }
  }
  handlersInitialized = true;
}

export function buildFormatLists(simpleMode: boolean): FormatLists {
  const allOptions: FormatOption[] = [];
  const inputIndices: number[] = [];
  const outputIndices: number[] = [];

  for (const handler of handlers) {
    const formats = supportedFormatCache.get(handler.name);
    if (!formats) continue;

    for (const format of formats) {
      if (!format.mime) continue;

      allOptions.push({ format, handler });
      const index = allOptions.length - 1;

      let addIn = true, addOut = true;
      if (simpleMode) {
        addIn = !inputIndices.some((i) => {
          const e = allOptions[i]?.format;
          return e?.mime === format.mime && e?.format === format.format;
        });
        addOut = !outputIndices.some((i) => {
          const e = allOptions[i]?.format;
          return e?.mime === format.mime && e?.format === format.format;
        });
      }

      if (format.from && addIn) inputIndices.push(index);
      if (format.to && addOut) outputIndices.push(index);
    }
  }

  return { allOptions, inputIndices, outputIndices };
}

// ── reachability (which output formats can we actually produce?) ──

interface HandlerCapability {
  anyInput: boolean;
  fromMimes: Set<string>;
  toMimes: string[];
}

function buildHandlerCapabilities(): HandlerCapability[] {
  return handlers.map((handler) => {
    const formats = supportedFormatCache.get(handler.name) ?? [];
    return {
      anyInput: Boolean(handler.supportAnyInput),
      fromMimes: new Set(formats.filter((f) => f.from && f.mime).map((f) => f.mime)),
      toMimes: formats.filter((f) => f.to && f.mime).map((f) => f.mime),
    };
  });
}

/**
 * Computes the set of output MIME types reachable from one or more input MIME
 * types, mirroring the conversion engine's breadth-first route search (which is
 * capped at {@link maxHops} handler hops). This lets the UI hide output formats
 * that can never be produced from the chosen input.
 */
export function computeReachableMimes(inputMimes: string[], maxHops = 4): Set<string> {
  const caps = buildHandlerCapabilities();
  const reachable = new Set<string>(inputMimes);
  const expanded = new Set<number>();
  let frontier = new Set<string>(inputMimes);

  for (let hop = 0; hop < maxHops && frontier.size > 0; hop++) {
    const next = new Set<string>();
    for (let i = 0; i < caps.length; i++) {
      if (expanded.has(i)) continue;
      const cap = caps[i];
      // "Any input" handlers (e.g. zip) accept anything we already have.
      const triggered = cap.anyInput || [...cap.fromMimes].some((m) => frontier.has(m));
      if (!triggered) continue;
      expanded.add(i);
      for (const toMime of cap.toMimes) {
        if (!reachable.has(toMime)) {
          reachable.add(toMime);
          next.add(toMime);
        }
      }
    }
    frontier = next;
  }

  return reachable;
}

// ── auto-detect input format ──

export function pickInputByFiles(
  files: File[],
  allOptions: FormatOption[],
  inputIndices: number[]
) {
  const first = files[0];
  let searchValue = "";
  let selectedInputIndex: number | null = null;

  const mime = normalizeMimeType(first.type);
  const byMime = inputIndices.find((i) => allOptions[i]?.format.mime === mime);
  if (mime && typeof byMime === "number") {
    return { selectedInputIndex: byMime, searchValue: mime };
  }

  const ext = first.name.split(".").pop()?.toLowerCase() ?? "";
  const byExt = inputIndices.find((i) => allOptions[i]?.format.extension.toLowerCase() === ext);
  if (typeof byExt === "number") {
    selectedInputIndex = byExt;
    searchValue = allOptions[byExt]?.format.mime ?? ext;
  } else {
    searchValue = ext;
  }

  return { selectedInputIndex, searchValue };
}

export function pickInputByFile(
  file: Pick<File, "name" | "type">,
  allOptions: FormatOption[],
  inputIndices: number[]
): FormatOption | null {
  const mime = normalizeMimeType(file.type);
  const byMime = inputIndices.find((i) => allOptions[i]?.format.mime === mime);
  if (mime && typeof byMime === "number") return allOptions[byMime] ?? null;

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const byExt = inputIndices.find((i) => allOptions[i]?.format.extension.toLowerCase() === ext);
  if (typeof byExt === "number") return allOptions[byExt] ?? null;

  return null;
}

export function getDetectedInputSummary(
  files: File[],
  allOptions: FormatOption[],
  inputIndices: number[]
) {
  const detected = files.map((file) => ({ file, option: pickInputByFile(file, allOptions, inputIndices) }));
  const missing = detected.filter((entry) => !entry.option).map((entry) => entry.file);
  const signatures = new Set(
    detected
      .map((entry) => entry.option)
      .filter((option): option is FormatOption => Boolean(option))
      .map((option) => `${option.format.mime}|${option.format.format}`)
  );

  return {
    detected,
    missing,
    allDetected: detected.length > 0 && missing.length === 0,
    isMixed: signatures.size > 1,
    formatCount: signatures.size,
  };
}

// ── conversion engine internals ──

const conversionsFromAnyInput: ConvertPathNode[] = handlers
  .filter((h) => h.supportAnyInput && h.supportedFormats)
  .flatMap((h) => h.supportedFormats!.filter((f) => f.to).map((f) => ({ handler: h, format: f })));

const convertPathCache: Array<{ files: FileData[]; node: ConvertPathNode }> = [];

function buildRouteSteps(path: ConvertPathNode[]): RouteStep[] {
  return path.map((node, i) => ({
    format: node.format.format.toUpperCase(),
    handler: i > 0 ? node.handler.name : undefined,
    status: "pending" as const,
  }));
}

async function attemptConvertPath(
  files: FileData[],
  path: ConvertPathNode[],
  pathsExplored: number,
  progress?: ProgressCallbacks
) {
  const steps = buildRouteSteps(path);

  progress?.onRouteProgress?.({
    phase: "converting",
    steps,
    currentStepIndex: 0,
    pathsExplored,
    message: `Attempting ${steps.map((s) => s.format).join(" \u2192 ")}`,
  });

  const cacheLast = convertPathCache.at(-1);
  if (cacheLast) files = cacheLast.files;

  const start = cacheLast ? convertPathCache.length : 0;
  for (let i = start; i < path.length - 1; i++) {
    const handler = path[i + 1].handler;

    for (let s = 0; s <= i; s++) steps[s].status = "done";
    steps[i + 1].status = "active";
    progress?.onRouteProgress?.({
      phase: "converting",
      steps: steps.map((s) => ({ ...s })),
      currentStepIndex: i + 1,
      pathsExplored,
      message: `Converting via ${handler.name}`,
    });

    try {
      let formats = supportedFormatCache.get(handler.name);
      if (!handler.ready) {
        try { await handler.init(); } catch { return null; }
        if (handler.supportedFormats) {
          supportedFormatCache.set(handler.name, handler.supportedFormats);
          formats = handler.supportedFormats;
        }
      }
      if (!formats) throw new Error(`Handler "${handler.name}" doesn't support any formats.`);
      const inputFormat = formats.find((f) => f.mime === path[i].format.mime && f.from);
      if (!inputFormat) throw new Error("Intermediate format not supported.");
      files = await handler.doConvert(files, inputFormat, path[i + 1].format);
      if (files.some((f) => !f.bytes.length)) throw new Error("Output is empty.");
      convertPathCache.push({ files, node: path[i + 1] });

      steps[i + 1].status = "done";
    } catch (err) {
      steps[i + 1].status = "failed";
      progress?.onRouteProgress?.({
        phase: "converting",
        steps: steps.map((s) => ({ ...s })),
        currentStepIndex: i + 1,
        pathsExplored,
        message: `Failed at ${handler.name}: ${path[i].format.format} \u2192 ${path[i + 1].format.format}`,
      });
      console.error(handler.name, `${path[i].format.format} -> ${path[i + 1].format.format}`, err);
      return null;
    }
  }

  return { files, path };
}

async function buildConvertPath(
  files: FileData[],
  target: ConvertPathNode,
  queue: ConvertPathNode[][],
  simpleMode: boolean,
  allOptions: FormatOption[],
  progress?: ProgressCallbacks
) {
  convertPathCache.length = 0;
  const visited = new Set<string>();
  const deadEnds = new Set<string>();
  let nestedChecked = false;
  let pathsExplored = 0;

  while (queue.length > 0) {
    const path = queue.shift();
    if (!path || path.length > 5) continue;

    for (let i = 1; i < path.length; i++) {
      if (path[i] !== convertPathCache[i]?.node) {
        convertPathCache.length = i - 1;
        break;
      }
    }

    const prev = path[path.length - 1];
    const valid = handlers.filter((h) =>
      supportedFormatCache.get(h.name)?.some((f) => f.mime === prev.format.mime && f.from)
    );

    if (!valid.length) { deadEnds.add(prev.format.format); continue; }
    if (deadEnds.has(prev.format.format)) continue;

    if (simpleMode) {
      const candidates = allOptions.filter((o) =>
        valid.includes(o.handler) && o.format.mime === target.format.mime && o.format.to
      );
      // Several formats can share a MIME type (e.g. mp3 and mp2 are both
      // audio/mpeg). Prefer the exact format the user picked so the output
      // matches their choice, falling back to MIME-compatible alternatives.
      candidates.sort((a, b) =>
        (a.format.format === target.format.format ? 0 : 1)
        - (b.format.format === target.format.format ? 0 : 1)
      );
      for (const c of candidates) {
        pathsExplored++;
        progress?.onRouteProgress?.({
          phase: "searching",
          steps: buildRouteSteps(path.concat(c)),
          currentStepIndex: -1,
          pathsExplored,
          message: `Searching... (${pathsExplored} routes explored, ${queue.length} queued)`,
        });
        const r = await attemptConvertPath(files, path.concat(c), pathsExplored, progress);
        if (r) return r;
      }
    } else if (valid.includes(target.handler)) {
      pathsExplored++;
      progress?.onRouteProgress?.({
        phase: "searching",
        steps: buildRouteSteps(path.concat(target)),
        currentStepIndex: -1,
        pathsExplored,
        message: `Searching... (${pathsExplored} routes explored, ${queue.length} queued)`,
      });
      const r = await attemptConvertPath(files, path.concat(target), pathsExplored, progress);
      if (r) return r;
    }

    if (!nestedChecked) {
      for (const c of conversionsFromAnyInput.filter((e) => e.format.mime === target.format.mime)) {
        pathsExplored++;
        const r = await attemptConvertPath(files, path.concat(c), pathsExplored, progress);
        if (r) return r;
      }
      nestedChecked = true;
    }

    for (const h of valid) {
      const fmts = supportedFormatCache.get(h.name);
      if (!fmts) continue;
      for (const f of fmts) {
        if (!f.to || !f.mime || path.some((e) => e.format === f)) continue;
        const np = path.concat({ format: f, handler: h });
        const sig = np.map((e) => e.format.format).join("\u2022");
        if (visited.has(sig)) continue;
        visited.add(sig);
        queue.push(np);
      }
    }
  }

  return null;
}

// ── public conversion API (no auto-download) ──

function toOutputFile(fd: FileData, mime: string): OutputFile {
  const blob = new Blob([fd.bytes as BlobPart], { type: mime });
  return {
    name: fd.name,
    bytes: fd.bytes,
    url: URL.createObjectURL(blob),
    mime,
    size: fd.bytes.byteLength,
  };
}

export async function runConversion(params: {
  selectedFiles: File[];
  inputOption: FormatOption;
  outputOption: FormatOption;
  simpleMode: boolean;
  allOptions: FormatOption[];
  progress?: ProgressCallbacks;
}): Promise<ConvertResult> {
  const { selectedFiles, inputOption, outputOption, simpleMode, allOptions, progress } = params;
  const inFmt = inputOption.format;
  const outFmt = outputOption.format;

  const passthrough: OutputFile[] = [];
  const inputData: FileData[] = [];

  for (const file of selectedFiles) {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    if (inFmt.mime === outFmt.mime) {
      passthrough.push(toOutputFile({ name: file.name, bytes }, inFmt.mime));
    } else {
      inputData.push({ name: file.name, bytes });
    }
  }

  if (inputData.length === 0) {
    return {
      files: passthrough,
      path: [inputOption, outputOption].map(({ format, handler }) => ({ format, handler })),
    };
  }

  progress?.onStatus?.("Finding conversion route...");
  const output = await buildConvertPath(
    inputData, outputOption, [[inputOption]], simpleMode, allOptions, progress
  );
  if (!output) throw new Error("Failed to find conversion route.");

  // When a single source file expands into several output files (e.g. a PDF
  // rendered to one image per page), bundle them into a single ZIP so the user
  // gets one tidy download instead of a pile of loose files.
  if (selectedFiles.length === 1 && output.files.length > 1) {
    const zip = new JSZip();
    for (const file of output.files) zip.file(file.name, new Uint8Array(file.bytes));
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const baseName = (selectedFiles[0]?.name ?? "output").replace(/\.[^.]+$/, "");
    const zipFile = toOutputFile({ name: `${baseName}.zip`, bytes }, "application/zip");
    return { files: [...passthrough, zipFile], path: output.path };
  }

  const outputFiles = output.files.map((f) => toOutputFile(f, outFmt.mime));
  return { files: [...passthrough, ...outputFiles], path: output.path };
}

export function downloadOutputFile(file: OutputFile) {
  const link = document.createElement("a");
  link.href = file.url;
  link.download = file.name;
  link.click();
}

export function revokeOutputFiles(files: OutputFile[]) {
  for (const f of files) {
    try { URL.revokeObjectURL(f.url); } catch { /* ignore */ }
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type PreviewKind = "image" | "audio" | "video" | "text" | "pdf" | null;

export function getPreviewKind(mime: string): PreviewKind {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf") return "pdf";
  if (
    mime.startsWith("text/")
    || mime === "application/json"
    || mime === "application/xml"
    || mime === "image/svg+xml"
    || mime === "application/xhtml+xml"
  ) return "text";
  return null;
}
