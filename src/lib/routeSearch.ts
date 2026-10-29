import type { ConvertPathNode, FileData, FileFormat, FormatHandler } from "../FormatHandler.ts";
import { FatalConversionError } from "../FormatHandler.ts";

// The breadth-first conversion route search. It lives apart from
// conversionEngine.ts (which pulls in every browser-only handler) so the
// routing rules can be unit-tested with plain in-memory handlers.

export interface FormatOption {
  format: FileFormat;
  handler: FormatHandler;
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

/** Name of the handler that turns text and images into spoken audio. */
export const NARRATION_HANDLER_NAME = "narration";

/**
 * Whether a simple-mode conversion from {@link inputMime} to
 * {@link targetMime} has to be spoken narration. Text and images have no
 * "sound" of their own, so the only meaningful audio for them is someone
 * reading the text aloud; spectrogram sonification or narrating ASCII art
 * would be a confusing surprise.
 */
export function requiresNarration(inputMime: string, targetMime: string) {
  return targetMime.startsWith("audio/")
    && (inputMime.startsWith("image/") || inputMime.startsWith("text/"));
}

const mediaType = (mime: string) => mime.split("/")[0];

/**
 * Whether {@link path} reads the input aloud faithfully: before narration it
 * may only change format within the same kind of media (TIFF to PNG,
 * Markdown to plain text) — never image to ASCII-art text or text rendered as
 * a picture — and afterwards it may only re-encode the audio.
 */
export function isFaithfulNarrationPath(path: ConvertPathNode[]) {
  // The first node identifies the input format; its handler has not run yet.
  // BMP inputs, for example, may already belong to the narration handler.
  const at = path.findIndex((node, index) => index > 0 && node.handler.name === NARRATION_HANDLER_NAME);
  if (at < 1) return false;
  const inputType = mediaType(path[0].format.mime);
  for (let i = 1; i < at; i++) {
    if (mediaType(path[i].format.mime) !== inputType) return false;
  }
  for (let i = at + 1; i < path.length; i++) {
    if (mediaType(path[i].format.mime) !== "audio") return false;
  }
  return true;
}

export interface RouteSearchParams {
  handlers: FormatHandler[];
  formatCache: Map<string, FileFormat[]>;
  files: FileData[];
  input: ConvertPathNode;
  target: ConvertPathNode;
  simpleMode: boolean;
  allOptions: FormatOption[];
  progress?: ProgressCallbacks;
  maxPathLength?: number;
}

function buildRouteSteps(path: ConvertPathNode[]): RouteStep[] {
  return path.map((node, i) => ({
    format: node.format.format.toUpperCase(),
    handler: i > 0 ? node.handler.name : undefined,
    status: "pending" as const,
  }));
}

/**
 * Searches for a working route from {@link RouteSearchParams.input} to
 * {@link RouteSearchParams.target}, running each candidate route until one
 * succeeds. Returns null if none works. A handler throwing a
 * {@link FatalConversionError} ends the search with that error.
 */
export async function searchConvertPath(params: RouteSearchParams) {
  const { handlers, formatCache, target, simpleMode, allOptions, progress } = params;
  const maxPathLength = params.maxPathLength ?? 5;
  const mustNarrate = simpleMode
    && requiresNarration(params.input.format.mime, target.format.mime)
    && handlers.some((h) => h.name === NARRATION_HANDLER_NAME);

  const conversionsFromAnyInput: ConvertPathNode[] = handlers
    .filter((h) => h.supportAnyInput && h.supportedFormats)
    .flatMap((h) => h.supportedFormats!.filter((f) => f.to).map((f) => ({ handler: h, format: f })));

  const convertPathCache: Array<{ files: FileData[]; node: ConvertPathNode }> = [];
  const queue: ConvertPathNode[][] = [[params.input]];

  async function attemptConvertPath(path: ConvertPathNode[], pathsExplored: number) {
    // Text and images only become audio by being read aloud (see
    // requiresNarration), so skip routes that would make some other sound.
    if (mustNarrate && !isFaithfulNarrationPath(path)) return null;

    let files = params.files;
    const steps = buildRouteSteps(path);

    progress?.onRouteProgress?.({
      phase: "converting",
      steps,
      currentStepIndex: 0,
      pathsExplored,
      message: `Attempting ${steps.map((s) => s.format).join(" → ")}`,
    });

    const cacheLast = convertPathCache.at(-1);
    if (cacheLast) files = cacheLast.files;

    const start = cacheLast ? convertPathCache.length : 0;
    for (let i = start; i < path.length - 1; i++) {
      const handler = path[i + 1].handler;

      for (let s = 0; s <= i; s++) steps[s].status = "done";
      steps[i + 1].status = "active";
      const report = (message: string) => progress?.onRouteProgress?.({
        phase: "converting",
        steps: steps.map((s) => ({ ...s })),
        currentStepIndex: i + 1,
        pathsExplored,
        message,
      });
      report(`Converting via ${handler.name}`);

      try {
        let formats = formatCache.get(handler.name);
        if (!handler.ready) {
          try { await handler.init(); } catch { return null; }
          if (handler.supportedFormats) {
            formatCache.set(handler.name, handler.supportedFormats);
            formats = handler.supportedFormats;
          }
        }
        if (!formats) throw new Error(`Handler "${handler.name}" doesn't support any formats.`);
        const inputFormat = formats.find((f) => f.mime === path[i].format.mime && f.from);
        if (!inputFormat) throw new Error("Intermediate format not supported.");
        handler.onProgress = report;
        try {
          files = await handler.doConvert(files, inputFormat, path[i + 1].format);
        } finally {
          handler.onProgress = undefined;
        }
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
          message: err instanceof FatalConversionError
            ? err.message
            : `Failed at ${handler.name}: ${path[i].format.format} → ${path[i + 1].format.format}`,
        });
        if (err instanceof FatalConversionError) throw err;
        console.error(handler.name, `${path[i].format.format} -> ${path[i + 1].format.format}`, err);
        return null;
      }
    }

    return { files, path };
  }

  const visited = new Set<string>();
  const deadEnds = new Set<string>();
  let nestedChecked = false;
  let pathsExplored = 0;

  while (queue.length > 0) {
    const path = queue.shift();
    if (!path || path.length > maxPathLength) continue;

    for (let i = 1; i < path.length; i++) {
      if (path[i] !== convertPathCache[i]?.node) {
        convertPathCache.length = i - 1;
        break;
      }
    }

    const prev = path[path.length - 1];
    const valid = handlers.filter((h) =>
      formatCache.get(h.name)?.some((f) => f.mime === prev.format.mime && f.from)
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
        const r = await attemptConvertPath(path.concat(c), pathsExplored);
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
      const r = await attemptConvertPath(path.concat(target), pathsExplored);
      if (r) return r;
    }

    if (!nestedChecked) {
      for (const c of conversionsFromAnyInput.filter((e) => e.format.mime === target.format.mime)) {
        pathsExplored++;
        const r = await attemptConvertPath(path.concat(c), pathsExplored);
        if (r) return r;
      }
      nestedChecked = true;
    }

    for (const h of valid) {
      const fmts = formatCache.get(h.name);
      if (!fmts) continue;
      for (const f of fmts) {
        if (!f.to || !f.mime || path.some((e) => e.format === f)) continue;
        const np = path.concat({ format: f, handler: h });
        const sig = np.map((e) => e.format.format).join("•");
        if (visited.has(sig)) continue;
        visited.add(sig);
        queue.push(np);
      }
    }
  }

  return null;
}
