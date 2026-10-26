"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  cropOutputImage,
  getImageColorAt,
  moveCropRect,
  removeBackgroundFromOutputImage,
  resizeCropRectFromHandle,
  type CropAspectRatio,
  type CropResizeHandle,
  type CropRect,
  type Point,
  type RgbaColor,
} from "../lib/imageEditing";

import {
  buildFormatLists,
  CATEGORY_META,
  computeReachableMimes,
  supportedFormatCache,
  type ConversionFailure,
  downloadOutputFile,
  type FormatCategory,
  formatFileSize,
  getDetectedInputSummary,
  getFormatCategory,
  getPreviewKind,
  groupByCategory,
  loadCacheFromPublic,
  warmUpHandlers,
  matchesSearch,
  pickInputByFiles,
  revokeOutputFiles,
  runConversion,
  type CategoryGroup,
  type FormatLists,
  type FormatOption,
  type OutputFile,
  type RouteProgress,
} from "../lib/conversionEngine";

type Step = "upload" | "pick-output" | "ready" | "results";

interface PopupState {
  open: boolean;
  title: string;
  detail?: string;
  closable?: boolean;
  routeProgress?: RouteProgress | null;
}

const emptyLists: FormatLists = {
  allOptions: [],
  inputIndices: [],
  outputIndices: [],
};


const BROWSE_CATEGORIES: FormatCategory[] = [
  "image",
  "audio",
  "video",
  "text",
  "application",
  "other",
];

// UI-only palette, tuned for legible text on the light workspace. The engine's
// CATEGORY_META still supplies the labels.
const CATEGORY_COLORS: Record<FormatCategory, string> = {
  image: "#0e7490",
  audio: "#7a3fb0",
  video: "#be2f4a",
  text: "#2d7a46",
  application: "#2f5fbf",
  other: "#6b6358",
};

function categoryStyle(category: FormatCategory): React.CSSProperties {
  return { "--cat": CATEGORY_COLORS[category] } as React.CSSProperties;
}

interface CategoryCount {
  category: FormatCategory;
  label: string;
  count: number;
  examples: string[];
}

function countByCategory(indices: number[], allOptions: FormatOption[]): CategoryCount[] {
  const counts = new Map<FormatCategory, number>();
  const examples = new Map<FormatCategory, string[]>();
  for (const idx of indices) {
    const opt = allOptions[idx];
    if (!opt) continue;
    const cat = getFormatCategory(opt.format.mime);
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
    const list = examples.get(cat) ?? [];
    const tag = opt.format.format.toUpperCase();
    if (list.length < 3 && !list.includes(tag)) list.push(tag);
    examples.set(cat, list);
  }
  return BROWSE_CATEGORIES
    .filter((cat) => (counts.get(cat) ?? 0) > 0)
    .map((cat) => ({
      category: cat,
      label: CATEGORY_META[cat].label,
      count: counts.get(cat)!,
      examples: examples.get(cat) ?? [],
    }));
}

function renderCategoryTiles(
  counts: CategoryCount[],
  onPick: (category: FormatCategory) => void
) {
  if (counts.length === 0) {
    return <div className="empty">No matching formats found.</div>;
  }
  return (
    <ul className="category-tiles" aria-label="Format types">
      {counts.map((entry) => (
        <li key={entry.category}>
          <button
            type="button"
            className="category-tile"
            style={categoryStyle(entry.category)}
            onClick={() => onPick(entry.category)}
          >
            <span className="category-tile-icon">
              <MediaIcon category={entry.category} />
            </span>
            <span className="category-tile-text">
              <span className="category-tile-label">{entry.label}</span>
              <span className="category-tile-examples">
                {entry.examples.join(", ")}
                {entry.count > entry.examples.length ? "…" : ""}
              </span>
            </span>
            <span className="category-tile-count">
              {entry.count}
              <span className="sr-only"> format{entry.count !== 1 ? "s" : ""}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function renderCategoryChips(
  counts: CategoryCount[],
  active: FormatCategory | null,
  onPick: (category: FormatCategory | null) => void
) {
  if (counts.length <= 1) return null;
  const total = counts.reduce((sum, entry) => sum + entry.count, 0);
  return (
    <div className="category-chips" role="group" aria-label="Filter by type">
      <button
        type="button"
        className="category-chip"
        aria-pressed={active === null}
        onClick={() => onPick(null)}
      >
        All
        <span className="category-chip-count">{total}</span>
      </button>
      {counts.map((entry) => (
        <button
          type="button"
          key={entry.category}
          className="category-chip"
          aria-pressed={active === entry.category}
          style={categoryStyle(entry.category)}
          onClick={() => onPick(active === entry.category ? null : entry.category)}
        >
          <span className="category-chip-dot" aria-hidden="true" />
          {entry.label}
          <span className="category-chip-count">{entry.count}</span>
        </button>
      ))}
    </div>
  );
}

function SearchField({
  label,
  placeholder,
  value,
  onChange,
  autoFocus,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <div className="search-field">
      <label className="sr-only" htmlFor={`search-${label.replace(/\W+/g, "-").toLowerCase()}`}>
        {label}
      </label>
      <Icon name="search" />
      <input
        id={`search-${label.replace(/\W+/g, "-").toLowerCase()}`}
        className="search"
        type="search"
        placeholder={placeholder}
        value={value}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
      />
      {value && (
        <button
          type="button"
          className="search-clear"
          onClick={() => onChange("")}
          aria-label={`Clear ${label.toLowerCase()}`}
        >
          <Icon name="x" />
        </button>
      )}
    </div>
  );
}

function totalSize(files: File[]) {
  return files.reduce((sum, file) => sum + file.size, 0);
}

function fileExtension(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).slice(0, 5) : "file";
}

function prefersReducedMotion() {
  return typeof window !== "undefined"
    && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

function renameBeforeExtension(name: string, suffix: string) {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return `${name}${suffix}`;
  return `${name.slice(0, dot)}${suffix}${name.slice(dot)}`;
}

function uniquifyOutputNames(files: OutputFile[]): OutputFile[] {
  const seen = new Map<string, number>();
  return files.map((file) => {
    const count = seen.get(file.name) ?? 0;
    seen.set(file.name, count + 1);
    if (count === 0) return file;
    return { ...file, name: renameBeforeExtension(file.name, `-${count + 1}`) };
  });
}

function revokeOutputHistory(history: Record<number, OutputFile[]>) {
  Object.values(history).forEach((files) => revokeOutputFiles(files));
}

export function ConverterApp() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const helpRef = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const convertBtnRef = useRef<HTMLButtonElement>(null);
  const resultsTitleRef = useRef<HTMLHeadingElement>(null);

  const [dragActive, setDragActive] = useState(false);
  const [simpleMode, setSimpleMode] = useState(true);
  const [loadingFormats, setLoadingFormats] = useState(true);
  const [converting, setConverting] = useState(false);
  const [lists, setLists] = useState<FormatLists>(emptyLists);

  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [selectedInputIdx, setSelectedInputIdx] = useState<number | null>(null);
  const [selectedOutputIndices, setSelectedOutputIndices] = useState<Set<number>>(new Set());

  const [searchInput, setSearchInput] = useState("");
  const [searchOutput, setSearchOutput] = useState("");

  const [inputCategory, setInputCategory] = useState<FormatCategory | null>(null);
  const [outputCategory, setOutputCategory] = useState<FormatCategory | null>(null);

  const [outputCollapsed, setOutputCollapsed] = useState(false);

  const [results, setResults] = useState<OutputFile[]>([]);
  const [resultPath, setResultPath] = useState("");
  const [conversionFailures, setConversionFailures] = useState<ConversionFailure[]>([]);
  const [editOutputsOpen, setEditOutputsOpen] = useState(false);
  const [outputHistory, setOutputHistory] = useState<Record<number, OutputFile[]>>({});

  const [popup, setPopup] = useState<PopupState>({
    open: false,
    title: "",
    closable: false,
  });

  const detectedInputSummary = useMemo(
    () => getDetectedInputSummary(selectedFiles, lists.allOptions, lists.inputIndices),
    [selectedFiles, lists.allOptions, lists.inputIndices]
  );

  const canUseDetectedBatch = detectedInputSummary.allDetected && detectedInputSummary.isMixed;
  const hasImageResults = results.some((file) => getPreviewKind(file.mime) === "image");

  const step: Step = useMemo(() => {
    if (results.length > 0 || conversionFailures.length > 0) return "results";
    const hasInput = selectedInputIdx !== null || canUseDetectedBatch;
    if (selectedOutputIndices.size > 0 && hasInput && selectedFiles.length > 0) {
      return "ready";
    }
    if (selectedFiles.length > 0 && hasInput) return "pick-output";
    return "upload";
  }, [
    canUseDetectedBatch,
    conversionFailures.length,
    results.length,
    selectedFiles.length,
    selectedInputIdx,
    selectedOutputIndices,
  ]);

  // ── initial load: render instantly from cache, warm up engines in the bg ──

  const [handlersReady, setHandlersReady] = useState(false);
  // Bumped as background warm-up reveals new handlers, retriggering the list
  // rebuild below. Guarded so it never reshuffles an in-progress selection.
  const [formatVersion, setFormatVersion] = useState(0);
  const [backgroundLoading, setBackgroundLoading] = useState(false);

  // Lets the background warm-up check the live selection without being a
  // dependency of the load effect (which must run exactly once).
  const selectedFilesRef = useRef(selectedFiles);
  useEffect(() => { selectedFilesRef.current = selectedFiles; }, [selectedFiles]);

  useEffect(() => {
    let active = true;

    // Reveal newly warmed-up formats, but only while the user hasn't started
    // picking files — rebuilding mid-flow could shuffle option indices and
    // drop their selection.
    const revealIfIdle = () => {
      if (selectedFilesRef.current.length === 0) setFormatVersion((v) => v + 1);
    };

    (async () => {
      setLoadingFormats(true);
      await loadCacheFromPublic();
      if (!active) return;

      const haveCache = supportedFormatCache.size > 0;
      if (haveCache) {
        // Cache hit: show the picker immediately, no blocking spinner.
        setHandlersReady(true);
        setLoadingFormats(false);
        setPopup((p) => ({ ...p, open: false }));
      } else {
        // No cache (typically a fresh local dev session): we have nothing to
        // show yet, so keep a spinner until the first engine comes online.
        setPopup({
          open: true,
          title: "Loading tools...",
          detail: "Building the supported format list. This only happens without a cache.",
          closable: false,
        });
      }

      // Warm up every engine in the background. This fills in any handlers the
      // cache lacked and pre-loads conversion engines so the first conversion
      // is instant. It never blocks the UI once the cache has rendered.
      setBackgroundLoading(true);
      await warmUpHandlers(() => {
        if (!active) return;
        if (!haveCache) {
          // Without a cache, reveal the picker as soon as anything is ready.
          setHandlersReady(true);
          setLoadingFormats(false);
          setPopup((p) => ({ ...p, open: false }));
        }
        revealIfIdle();
      });
      if (!active) return;

      setHandlersReady(true);
      setLoadingFormats(false);
      setBackgroundLoading(false);
      setPopup((p) => ({ ...p, open: false }));
      window.formatCacheReady = true;
      revealIfIdle();
    })().catch((err) => {
      if (!active) return;
      console.error(err);
      setLoadingFormats(false);
      setBackgroundLoading(false);
      setPopup({ open: true, title: "Failed to load tools", detail: String(err), closable: true });
    });

    return () => { active = false; };
  }, []);

  // ── expose the format cache for dev tooling (see README / build-cache) ──

  useEffect(() => {
    if (!handlersReady) return;
    window.supportedFormatCache = supportedFormatCache;
    window.printSupportedFormatCache = () =>
      JSON.stringify(Array.from(supportedFormatCache.entries()));
  }, [handlersReady]);

  // ── rebuild lists on mode change or as background warm-up adds formats ──

  useEffect(() => {
    if (!handlersReady) return;
    const data = buildFormatLists(simpleMode);
    setLists(data);
    setSelectedInputIdx((p) => (p !== null && data.inputIndices.includes(p) ? p : null));
    setSelectedOutputIndices((prev) => {
      const next = new Set<number>();
      prev.forEach((i) => { if (data.outputIndices.includes(i)) next.add(i); });
      return next;
    });
  }, [simpleMode, handlersReady, formatVersion]);

  // ── file selection ──

  const selectFiles = useCallback(
    (files: File[]) => {
      if (!files.length) return;
      const sorted = files.slice().sort((a, b) => a.name.localeCompare(b.name));
      setSelectedFiles(sorted);
      setSelectedOutputIndices(new Set());
      setOutputCollapsed(false);
      setSearchOutput("");
      setOutputCategory(null);
      revokeOutputFiles(results);
      revokeOutputHistory(outputHistory);
      setResults([]);
      setResultPath("");
      setConversionFailures([]);
      setEditOutputsOpen(false);
      setOutputHistory({});

      const auto = pickInputByFiles(sorted, lists.allOptions, lists.inputIndices);
      const detected = getDetectedInputSummary(sorted, lists.allOptions, lists.inputIndices);

      if (detected.allDetected && detected.isMixed) {
        setSelectedInputIdx(null);
        setSearchInput("mixed input batch");
      } else {
        setSearchInput(auto.searchValue);
        setSelectedInputIdx(auto.selectedInputIndex);
      }
    },
    [lists, outputHistory, results]
  );

  // ── global drag/drop + paste ──

  useEffect(() => {
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer?.files) selectFiles(Array.from(e.dataTransfer.files));
    };
    const onDragOver = (e: DragEvent) => e.preventDefault();
    const onPaste = (e: ClipboardEvent) => {
      const files = e.clipboardData?.files;
      if (files?.length) selectFiles(Array.from(files));
    };
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("paste", onPaste);
    };
  }, [selectFiles]);

  // Highlight the page while files are dragged over it. dragenter/dragleave
  // fire for every child element, so track depth rather than a boolean.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragActive(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragActive(false);
    };
    const reset = () => {
      depth = 0;
      setDragActive(false);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", reset);
    window.addEventListener("dragend", reset);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", reset);
      window.removeEventListener("dragend", reset);
    };
  }, []);

  // ── focus management between steps ──

  const previousStepRef = useRef<Step>("upload");
  useEffect(() => {
    const previous = previousStepRef.current;
    previousStepRef.current = step;
    if (previous === step) return;

    if (step === "results") {
      // Bring the results into view and announce them via the heading.
      const panel = panelRef.current;
      if (panel && panel.getBoundingClientRect().top < 0) {
        panel.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
      }
      resultsTitleRef.current?.focus({ preventScroll: true });
    } else if (step === "ready" && previous === "pick-output") {
      // The picked card collapses away; keep keyboard focus on the next action.
      convertBtnRef.current?.focus();
    }
  }, [step]);

  useEffect(() => {
    if (popup.open && !popup.closable) popupRef.current?.focus({ preventScroll: true });
  }, [popup.open, popup.closable]);

  // ── reachable output formats (hide routes we can't actually do) ──

  const reachableMimes = useMemo<Set<string> | null>(() => {
    if (!handlersReady) return null;

    let inputMimes: string[] = [];
    if (selectedInputIdx !== null) {
      const mime = lists.allOptions[selectedInputIdx]?.format.mime;
      if (mime) inputMimes = [mime];
    } else if (canUseDetectedBatch) {
      inputMimes = Array.from(new Set(
        detectedInputSummary.detected
          .map((entry) => entry.option?.format.mime)
          .filter((mime): mime is string => Boolean(mime))
      ));
    }

    if (inputMimes.length === 0) return null;
    if (inputMimes.length === 1) return computeReachableMimes(inputMimes);

    // For a mixed batch, only keep targets reachable from every input format.
    const sets = inputMimes.map((mime) => computeReachableMimes([mime]));
    const [first, ...rest] = sets;
    const intersection = new Set<string>();
    for (const mime of first) {
      if (rest.every((set) => set.has(mime))) intersection.add(mime);
    }
    return intersection;
  }, [handlersReady, selectedInputIdx, canUseDetectedBatch, detectedInputSummary, lists.allOptions]);

  // ── filtered & grouped indices ──

  const filteredInputs = useMemo(
    () => lists.inputIndices.filter((i) => {
      const o = lists.allOptions[i];
      if (!o) return false;
      if (!searchInput.trim() && inputCategory && getFormatCategory(o.format.mime) !== inputCategory) {
        return false;
      }
      return matchesSearch(o, simpleMode, searchInput);
    }),
    [lists, searchInput, simpleMode, inputCategory]
  );

  const reachableOutputIndices = useMemo(
    () => lists.outputIndices.filter((i) => {
      const o = lists.allOptions[i];
      if (!o) return false;
      return !reachableMimes || reachableMimes.has(o.format.mime);
    }),
    [lists, reachableMimes]
  );

  const filteredOutputs = useMemo(
    () => reachableOutputIndices.filter((i) => {
      const o = lists.allOptions[i];
      if (!o) return false;
      if (outputCategory && getFormatCategory(o.format.mime) !== outputCategory) return false;
      return matchesSearch(o, simpleMode, searchOutput);
    }),
    [reachableOutputIndices, lists.allOptions, searchOutput, simpleMode, outputCategory]
  );

  const inputCategoryCounts = useMemo(
    () => countByCategory(lists.inputIndices, lists.allOptions),
    [lists]
  );

  const outputCategoryCounts = useMemo(
    () => countByCategory(reachableOutputIndices, lists.allOptions),
    [reachableOutputIndices, lists.allOptions]
  );

  const inputGroups = useMemo(
    () => groupByCategory(filteredInputs, lists.allOptions),
    [filteredInputs, lists.allOptions]
  );

  const outputGroups = useMemo(
    () => groupByCategory(filteredOutputs, lists.allOptions),
    [filteredOutputs, lists.allOptions]
  );

  // ── toggle output selection ──

  const toggleOutput = (idx: number, collapse?: boolean) => {
    setSelectedOutputIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
    if (collapse) setOutputCollapsed(true);
  };

  // ── convert (supports bulk: runs each selected output format) ──

  const onConvert = async () => {
    if (!selectedFiles.length || selectedOutputIndices.size === 0) return;
    const selectedBatchInput = selectedInputIdx !== null ? lists.allOptions[selectedInputIdx] : null;
    if (!selectedBatchInput && !canUseDetectedBatch) return;

    setConverting(true);
    revokeOutputFiles(results);
    revokeOutputHistory(outputHistory);
    setOutputHistory({});
    setEditOutputsOpen(false);
    setPopup({ open: true, title: "Converting...", closable: false, routeProgress: null });

    const allOutputFiles: OutputFile[] = [];
    const failures: ConversionFailure[] = [];
    const pathParts = new Set<string>();

    const targets = Array.from(selectedOutputIndices);
    const batches = canUseDetectedBatch
      ? detectedInputSummary.detected.map(({ file, option }) => ({ files: [file], inputOption: option }))
      : [{ files: selectedFiles, inputOption: selectedBatchInput }];
    const totalJobs = targets.length * batches.length;
    let jobIndex = 0;

    for (let t = 0; t < targets.length; t++) {
      const outputOpt = lists.allOptions[targets[t]];
      if (!outputOpt) continue;

      for (const batch of batches) {
        jobIndex++;
        const firstFileName = batch.files[0]?.name ?? "input";
        const batchLabel = totalJobs > 1 ? ` (${jobIndex}/${totalJobs})` : "";

        if (!batch.inputOption) {
          failures.push({ name: firstFileName, reason: "Could not detect the input format." });
          continue;
        }

        setPopup({
          open: true,
          title: `Finding conversion route${batchLabel}`,
          detail: `${firstFileName}: ${batch.inputOption.format.format.toUpperCase()} \u2192 ${outputOpt.format.format.toUpperCase()}`,
          closable: false,
          routeProgress: null,
        });

        try {
          const out = await runConversion({
            selectedFiles: batch.files,
            inputOption: batch.inputOption,
            outputOption: outputOpt,
            simpleMode,
            allOptions: lists.allOptions,
            progress: {
              onStatus: (title, detail) =>
                setPopup((p) => ({ ...p, title: title + batchLabel, detail })),
              onRouteProgress: (info) =>
                setPopup((p) => ({
                  ...p,
                  title: info.phase === "searching"
                    ? `Searching for route${batchLabel}`
                    : `Converting${batchLabel}`,
                  detail: info.message,
                  routeProgress: info,
                })),
            },
          });
          allOutputFiles.push(...out.files);
          pathParts.add(out.path.map((n) => n.format.format).join(" \u2192 "));
        } catch (err) {
          console.error(err);
          failures.push({
            name: `${firstFileName} \u2192 ${outputOpt.format.format.toUpperCase()}`,
            reason: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    setResults(uniquifyOutputNames(allOutputFiles));
    setConversionFailures(failures);
    setResultPath(Array.from(pathParts).join(" ; "));
    setConverting(false);
    setPopup((p) => ({ ...p, open: false }));
  };

  // ── restart ──

  const restart = () => {
    revokeOutputFiles(results);
    revokeOutputHistory(outputHistory);
    setSelectedFiles([]);
    setSelectedInputIdx(null);
    setSelectedOutputIndices(new Set());
    setSearchInput("");
    setSearchOutput("");
    setInputCategory(null);
    setOutputCategory(null);
    setOutputCollapsed(false);
    setResults([]);
    setResultPath("");
    setConversionFailures([]);
    setEditOutputsOpen(false);
    setOutputHistory({});
  };

  const replaceEditedOutput = useCallback((index: number, originalFile: OutputFile, editedFile: OutputFile) => {
    setResults((prev) => {
      if (prev[index] !== originalFile) {
        revokeOutputFiles([editedFile]);
        return prev;
      }
      return prev.map((file, i) => (i === index ? editedFile : file));
    });
    setOutputHistory((history) => ({
      ...history,
      [index]: [...(history[index] ?? []), originalFile],
    }));
  }, []);

  const undoEditedOutput = useCallback((index: number) => {
    let previousFile: OutputFile | null = null;
    setOutputHistory((history) => {
      const stack = history[index] ?? [];
      previousFile = stack.at(-1) ?? null;
      if (!previousFile) return history;

      const nextStack = stack.slice(0, -1);
      const nextHistory = { ...history };
      if (nextStack.length) nextHistory[index] = nextStack;
      else delete nextHistory[index];
      return nextHistory;
    });
    setResults((prev) => {
      if (!previousFile) return prev;
      const restoredFile = previousFile;
      const current = prev[index];
      if (current) revokeOutputFiles([current]);
      return prev.map((file, i) => (i === index ? restoredFile : file));
    });
  }, []);


  // ── render helpers ──

  const renderCard = (
    index: number,
    option: FormatOption,
    isSelected: boolean,
    onSelect: () => void,
    category: FormatCategory
  ) => (
    <button
      type="button"
      key={index}
      className="format-card"
      aria-pressed={isSelected}
      style={categoryStyle(category)}
      onClick={onSelect}
      title={`${option.format.name} (${option.format.mime})`}
    >
      <span className="format-ext" aria-hidden="true">{option.format.extension.slice(0, 5)}</span>
      <span className="format-label">
        <span className="format-name">{option.format.format.toUpperCase()}</span>
        <span className="format-desc">
          {simpleMode
            ? option.format.name
            : `${option.format.mime} · ${option.handler.name}`}
        </span>
      </span>
      <span className="format-check" aria-hidden="true">
        <Icon name="check" />
      </span>
    </button>
  );

  const renderGroupedGrid = (
    groups: CategoryGroup[],
    isSelectedFn: (idx: number) => boolean,
    onSelectFn: (idx: number) => void
  ) => (
    <div className="grouped-formats">
      {groups.map((group) => (
        <section
          key={group.category}
          className="category-section"
          style={categoryStyle(group.category)}
          aria-label={`${group.label} formats`}
        >
          <h4 className="category-label">
            <span className="category-dot" aria-hidden="true" />
            {group.label}
            <span className="category-label-count">{group.indices.length}</span>
          </h4>
          <div className="format-grid">
            {group.indices.map((idx) =>
              renderCard(idx, lists.allOptions[idx], isSelectedFn(idx), () => onSelectFn(idx), group.category)
            )}
          </div>
        </section>
      ))}
      {groups.length === 0 && (
        <div className="empty">
          No matching formats. Try a different search{simpleMode ? " or switch to Advanced mode" : ""}.
        </div>
      )}
    </div>
  );

  const openFilePicker = () => fileInputRef.current?.click();

  const inputOpt = selectedInputIdx !== null ? lists.allOptions[selectedInputIdx] : null;
  const inputSummaryLabel = canUseDetectedBatch
    ? `${detectedInputSummary.formatCount} input formats`
    : inputOpt?.format.format.toUpperCase();

  const detectedByFile = new Map(
    detectedInputSummary.detected.map((entry) => [entry.file, entry.option] as const)
  );

  const renderFileSummary = (showChange: boolean) => {
    const MAX_FILES = 4;
    const visible = selectedFiles.slice(0, MAX_FILES);
    return (
      <div className="file-summary">
        <div className="file-summary-head">
          <p className="file-summary-title">
            {selectedFiles.length} file{selectedFiles.length !== 1 ? "s" : ""}
            <span className="file-summary-size"> &middot; {formatFileSize(totalSize(selectedFiles))}</span>
          </p>
          <button type="button" className="btn btn-quiet btn-sm" onClick={openFilePicker}>
            <Icon name="refresh" />
            Replace files
          </button>
        </div>
        <ul className="file-list">
          {visible.map((file, i) => {
            const detected = canUseDetectedBatch ? detectedByFile.get(file) : null;
            return (
              <li key={`${file.name}-${i}`} className="file-row">
                <span className="file-ext" aria-hidden="true">{fileExtension(file.name)}</span>
                <span className="file-name" title={file.name}>{file.name}</span>
                <span className="file-meta">
                  {detected && <span className="file-detected">{detected.format.format.toUpperCase()}</span>}
                  {formatFileSize(file.size)}
                </span>
              </li>
            );
          })}
        </ul>
        {selectedFiles.length > MAX_FILES && (
          <p className="file-more">+ {selectedFiles.length - MAX_FILES} more</p>
        )}
        {showChange && (inputOpt || canUseDetectedBatch) && (
          <div className="input-format-row">
            <span className="input-format-label">From</span>
            {inputOpt ? (
              <>
                <span
                  className="format-pill"
                  style={categoryStyle(getFormatCategory(inputOpt.format.mime))}
                >
                  {inputOpt.format.format.toUpperCase()}
                </span>
                <span className="input-format-name" title={inputOpt.format.name}>
                  {inputOpt.format.name}
                </span>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    setSelectedInputIdx(null);
                    setSelectedOutputIndices(new Set());
                    setOutputCollapsed(false);
                  }}
                  aria-label={`Change input format (currently ${inputOpt.format.format.toUpperCase()})`}
                >
                  Change
                </button>
              </>
            ) : (
              <span className="input-format-name">
                {detectedInputSummary.formatCount} formats, detected per file
              </span>
            )}
          </div>
        )}
      </div>
    );
  };

  const stepIndex = step === "upload" ? 0 : step === "pick-output" ? 1 : step === "ready" ? 2 : 3;
  const hasInput = selectedInputIdx !== null || canUseDetectedBatch;
  const stepItems = [
    {
      label: "Add files",
      detail: selectedFiles.length === 0
        ? "Drop, paste or browse"
        : !hasInput
          ? "Pick the input format"
          : `${selectedFiles.length} file${selectedFiles.length !== 1 ? "s" : ""} · ${inputSummaryLabel}`,
    },
    {
      label: "Choose formats",
      detail: selectedOutputIndices.size > 0
        ? `${selectedOutputIndices.size} selected`
        : "One or more targets",
    },
    {
      label: "Convert & download",
      detail: converting
        ? "Converting…"
        : step === "results"
          ? results.length === 0
            ? "Conversion failed"
            : `${results.length} file${results.length !== 1 ? "s" : ""} ready${conversionFailures.length > 0 ? ` · ${conversionFailures.length} skipped` : ""}`
          : "Runs on this device",
    },
  ];

  const engineStatus = loadingFormats
    ? { tone: "busy", label: "Loading formats" }
    : backgroundLoading
      ? { tone: "busy", label: "Warming up engines" }
      : handlersReady
        ? { tone: "ready", label: "Engines ready" }
        : { tone: "idle", label: "Engines unavailable" };

  const resultsTitle = results.length > 0
    ? conversionFailures.length > 0
      ? "Finished with some issues"
      : "Conversion complete"
    : "Conversion failed";

  return (
    <>
      <div className="app-shell" inert={popup.open || undefined}>
        <a className="skip-link" href="#converter">Skip to converter</a>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            if (e.target.files) selectFiles(Array.from(e.target.files));
            // Allow re-selecting the same file later (e.g. after "Start Over").
            e.target.value = "";
          }}
        />

        {dragActive && (
          <div className="drag-overlay" aria-hidden="true">
            <div className="drag-overlay-inner">
              <Icon name="upload" />
              <span>Drop to add files</span>
            </div>
          </div>
        )}

        {/* ── Top navigation ── */}
        <header className="topbar">
          <div className="topbar-inner">
            <a className="brand" href="#converter" aria-label="Convert to it! - go to converter">
              <span className="brand-mark" aria-hidden="true">
                <svg viewBox="0 0 32 32">
                  <rect x="1" y="1" width="30" height="30" rx="9" fill="currentColor" />
                  <path
                    d="M10 11.5h9.5l-3-3M22 20.5h-9.5l3 3"
                    fill="none"
                    stroke="#fff"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <span className="brand-text">
                <span className="brand-name">Convert to it!</span>
                <span className="brand-tag">Universal file converter</span>
              </span>
            </a>

            <nav className="topbar-actions" aria-label="App controls">
              <span
                className={`engine-status engine-status--${engineStatus.tone}`}
                role="status"
                title={backgroundLoading ? "Conversion engines are loading in the background" : undefined}
              >
                <span className="engine-status-dot" aria-hidden="true" />
                <span className="engine-status-label">{engineStatus.label}</span>
              </span>

              <div className="mode-switch" role="group" aria-label="Format list mode">
                <button
                  type="button"
                  aria-pressed={simpleMode}
                  onClick={() => setSimpleMode(true)}
                  disabled={loadingFormats || converting}
                  title="Common formats, duplicates merged"
                >
                  Simple
                </button>
                <button
                  type="button"
                  aria-pressed={!simpleMode}
                  onClick={() => setSimpleMode(false)}
                  disabled={loadingFormats || converting}
                  title="Every format and conversion engine"
                >
                  Advanced
                </button>
              </div>

              <button
                type="button"
                className="icon-btn"
                onClick={() => helpRef.current?.showModal()}
                aria-label="Help"
                title="Help"
              >
                <Icon name="help" />
              </button>
              <a
                className="icon-btn topbar-source"
                href="https://github.com/p2r3/convert"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Source code on GitHub (opens in a new tab)"
                title="Source code"
              >
                <Icon name="code" />
              </a>
            </nav>
          </div>
        </header>

        <main className="main" id="main">
          <h1 className="sr-only">File converter</h1>

          {/* ── Progress steps ── */}
          <ol className="stepper" aria-label="Conversion steps">
            {stepItems.map((item, i) => {
              const state = i === 2 && step === "results" && results.length === 0
                ? "failed"
                : i < stepIndex ? "done" : i === stepIndex ? "current" : "upcoming";
              return (
                <li
                  key={item.label}
                  className={`stepper-item stepper-item--${state}`}
                  aria-current={state === "current" ? "step" : undefined}
                >
                  <span className="stepper-num" aria-hidden="true">
                    {state === "done" ? <Icon name="check" /> : state === "failed" ? <Icon name="x" /> : i + 1}
                  </span>
                  <span className="stepper-text">
                    <span className="stepper-label">
                      {item.label}
                      <span className="sr-only">
                        {state === "done" ? " (complete)" : state === "failed" ? " (failed)" : state === "current" ? " (current step)" : ""}
                      </span>
                    </span>
                    <span className="stepper-detail">{item.detail}</span>
                  </span>
                </li>
              );
            })}
          </ol>

          <div className="workspace" id="converter" tabIndex={-1}>
            <section className="panel" aria-labelledby="panel-title" ref={panelRef}>
              {/* ── Step 1: Upload ── */}
              {step === "upload" && (
                <>
                  <div className="panel-head">
                    <div>
                      <p className="panel-kicker">Step 1 of 3</p>
                      <h2 id="panel-title">
                        {selectedFiles.length > 0 ? "Which format is this?" : "Add your files"}
                      </h2>
                    </div>
                    {selectedFiles.length > 0 && (
                      <button type="button" className="btn btn-quiet btn-sm" onClick={restart}>
                        Start over
                      </button>
                    )}
                  </div>

                  {selectedFiles.length === 0 ? (
                    <div
                      className={`drop-zone${dragActive ? " drag-active" : ""}`}
                      onClick={openFilePicker}
                      role="button"
                      tabIndex={0}
                      aria-label="Choose files to convert"
                      aria-describedby="drop-zone-hint"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openFilePicker();
                        }
                      }}
                    >
                      <span className="drop-zone-icon" aria-hidden="true">
                        <Icon name="file-upload" />
                      </span>
                      <span className="drop-zone-title">Drop files here</span>
                      <span className="drop-zone-hint" id="drop-zone-hint">
                        or paste from your clipboard. Multiple files and mixed types work too.
                      </span>
                      <span className="btn btn-primary drop-zone-btn" aria-hidden="true">
                        <Icon name="plus" />
                        Choose files
                      </span>
                    </div>
                  ) : (
                    <>
                      {renderFileSummary(false)}
                      <div className="notice notice--warn" role="status">
                        <Icon name="alert" />
                        <p>
                          {detectedInputSummary.missing.length === 0
                            ? "Choose which input format to read your files as."
                            : selectedFiles.length > 1
                              ? `We couldn’t recognise ${detectedInputSummary.missing.length} of these files automatically. Choose the input format below.`
                              : "We couldn’t recognise this file automatically. Choose its input format below."}
                        </p>
                      </div>
                    </>
                  )}

                  {!loadingFormats && lists.inputIndices.length > 0 && (
                    <section className="format-browser" aria-labelledby="input-browser-title">
                      <div className="section-head">
                        <h3 id="input-browser-title">
                          {selectedFiles.length > 0 ? "Select input format" : "What are you converting?"}
                        </h3>
                        <p className="section-hint" aria-live="polite">
                          {selectedFiles.length === 0 && !inputCategory && !searchInput.trim()
                            ? "Browse supported formats. Picking one opens the file chooser."
                            : `${filteredInputs.length} format${filteredInputs.length !== 1 ? "s" : ""}`}
                        </p>
                      </div>
                      <SearchField
                        label="Search input formats"
                        placeholder="Search formats, e.g. png, mp4, docx"
                        value={searchInput}
                        onChange={setSearchInput}
                        autoFocus={selectedFiles.length > 0}
                      />
                      {!searchInput.trim() && !inputCategory ? (
                        renderCategoryTiles(inputCategoryCounts, (cat) => setInputCategory(cat))
                      ) : (
                        <>
                          {inputCategory && !searchInput.trim() && (
                            <button
                              type="button"
                              className="category-back"
                              onClick={() => setInputCategory(null)}
                            >
                              <Icon name="arrow-left" />
                              All types
                            </button>
                          )}
                          {renderGroupedGrid(
                            inputGroups,
                            (idx) => idx === selectedInputIdx,
                            selectedFiles.length > 0
                              ? (idx) => setSelectedInputIdx(idx)
                              : () => openFilePicker()
                          )}
                        </>
                      )}
                    </section>
                  )}
                  {loadingFormats && (
                    <div className="loading-row" role="status">
                      <span className="spinner" aria-hidden="true" />
                      Loading supported formats&hellip;
                    </div>
                  )}
                </>
              )}

              {/* ── Steps 2 & 3: pick outputs, then convert ── */}
              {(step === "pick-output" || (step === "ready" && (inputOpt || canUseDetectedBatch))) && (
                <>
                  <div className="panel-head">
                    <div>
                      <p className="panel-kicker">Step {step === "ready" ? 3 : 2} of 3</p>
                      <h2 id="panel-title">
                        {step === "ready" ? "Ready to convert" : "Choose output formats"}
                      </h2>
                    </div>
                    <button type="button" className="btn btn-quiet btn-sm" onClick={restart}>
                      Start over
                    </button>
                  </div>

                  {renderFileSummary(true)}

                  {step === "ready" && (
                    <div className="convert-card">
                      <div className="route-summary">
                        <span className="route-summary-from">{inputSummaryLabel}</span>
                        <Icon name="arrow-right" />
                        <ul className="tag-group" aria-label="Selected output formats">
                          {Array.from(selectedOutputIndices).map((idx) => {
                            const opt = lists.allOptions[idx];
                            if (!opt) return null;
                            const tag = opt.format.format.toUpperCase();
                            return (
                              <li
                                key={idx}
                                className="tag"
                                style={categoryStyle(getFormatCategory(opt.format.mime))}
                              >
                                {tag}
                                <button
                                  type="button"
                                  className="tag-remove"
                                  onClick={() => toggleOutput(idx)}
                                  aria-label={`Remove ${tag}`}
                                  title="Remove"
                                  disabled={converting}
                                >
                                  <Icon name="x" />
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                      <button
                        type="button"
                        ref={convertBtnRef}
                        className="btn btn-primary btn-lg convert-btn"
                        onClick={onConvert}
                        disabled={converting || loadingFormats}
                      >
                        {converting ? (
                          <>
                            <span className="spinner spinner--light" aria-hidden="true" />
                            Converting&hellip;
                          </>
                        ) : (
                          <>
                            {selectedOutputIndices.size > 1
                              ? `Convert to ${selectedOutputIndices.size} formats`
                              : "Convert now"}
                            <Icon name="arrow-right" />
                          </>
                        )}
                      </button>
                    </div>
                  )}

                  <section className="format-browser" aria-labelledby="output-browser-title">
                    <div className="section-head">
                      <h3 id="output-browser-title">Convert to</h3>
                      <p className="section-hint" aria-live="polite">
                        {reachableOutputIndices.length === 0
                          ? "No reachable output formats"
                          : `${filteredOutputs.length} of ${reachableOutputIndices.length} reachable formats · select one or more`}
                      </p>
                      {step === "ready" && (
                        <button
                          type="button"
                          className="btn btn-quiet btn-sm collapsible-toggle"
                          aria-expanded={!outputCollapsed}
                          aria-controls="output-format-list"
                          onClick={() => setOutputCollapsed((v) => !v)}
                        >
                          <Icon name="chevron" className={`chevron${outputCollapsed ? "" : " open"}`} />
                          {outputCollapsed ? "Add more formats" : "Hide formats"}
                        </button>
                      )}
                    </div>

                    {(step === "pick-output" || !outputCollapsed) && (
                      <div id="output-format-list">
                        <SearchField
                          label="Search output formats"
                          placeholder="Search output formats"
                          value={searchOutput}
                          onChange={setSearchOutput}
                          autoFocus={step === "pick-output"}
                        />
                        {renderCategoryChips(outputCategoryCounts, outputCategory, setOutputCategory)}
                        {renderGroupedGrid(
                          outputGroups,
                          (idx) => selectedOutputIndices.has(idx),
                          (idx) => toggleOutput(idx, step === "pick-output")
                        )}
                      </div>
                    )}
                  </section>
                </>
              )}

              {/* ── Results ── */}
              {step === "results" && (
                <div className="results-section">
                  <div className="panel-head">
                    <div className="results-heading">
                      <span
                        className={`results-badge results-badge--${results.length === 0 ? "error" : conversionFailures.length > 0 ? "warn" : "ok"}`}
                        aria-hidden="true"
                      >
                        <Icon name={results.length === 0 ? "x" : conversionFailures.length > 0 ? "alert" : "check"} />
                      </span>
                      <div>
                        <p className="panel-kicker">
                          {results.length} file{results.length !== 1 ? "s" : ""} ready
                          {conversionFailures.length > 0 ? ` · ${conversionFailures.length} skipped` : ""}
                        </p>
                        <h2 id="panel-title" ref={resultsTitleRef} tabIndex={-1}>{resultsTitle}</h2>
                      </div>
                    </div>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={restart}>
                      <Icon name="refresh" />
                      Convert more
                    </button>
                  </div>

                  {resultPath && (
                    <p className="results-path">
                      <span className="results-path-label">Route</span>
                      <code>{resultPath}</code>
                    </p>
                  )}

                  {results.length > 0 && (hasImageResults || results.length > 1) && (
                    <div className="results-toolbar">
                      {results.length > 1 && (
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => results.forEach((f) => downloadOutputFile(f))}
                        >
                          <Icon name="download" />
                          Download all ({results.length})
                        </button>
                      )}
                      {hasImageResults && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          aria-pressed={editOutputsOpen}
                          onClick={() => setEditOutputsOpen((open) => !open)}
                        >
                          <Icon name="sparkles" />
                          {editOutputsOpen ? "Done editing" : "Edit images"}
                        </button>
                      )}
                    </div>
                  )}

                  {results.length > 0 && (
                    <ul className="results-list">
                      {results.map((file, i) => {
                        const preview = getPreviewKind(file.mime);
                        if (preview === "image") {
                          return (
                            <li key={i}>
                              <ImageResultCard
                                file={file}
                                editOpen={editOutputsOpen}
                                canUndo={(outputHistory[i]?.length ?? 0) > 0}
                                onEdited={(originalFile, editedFile) => replaceEditedOutput(i, originalFile, editedFile)}
                                onUndo={() => undoEditedOutput(i)}
                              />
                            </li>
                          );
                        }
                        return (
                          <li key={i}>
                            <article className="result-card">
                              {preview && (
                                <div className={`result-preview result-preview--${preview}`}>
                                  {preview === "audio" && (
                                    <audio controls src={file.url} aria-label={`Preview of ${file.name}`} />
                                  )}
                                  {preview === "video" && (
                                    <video controls src={file.url} aria-label={`Preview of ${file.name}`} />
                                  )}
                                  {preview === "pdf" && (
                                    <iframe src={file.url} title={`Preview of ${file.name}`} />
                                  )}
                                  {preview === "text" && (
                                    <TextPreview url={file.url} />
                                  )}
                                </div>
                              )}
                              <ResultRow file={file} />
                            </article>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {conversionFailures.length > 0 && (
                    <div className="failure-list" role="alert">
                      <h3>
                        <Icon name="alert" />
                        {results.length === 0
                          ? "Nothing could be converted"
                          : `${conversionFailures.length} conversion${conversionFailures.length !== 1 ? "s" : ""} skipped`}
                      </h3>
                      <ul>
                        {conversionFailures.map((failure, i) => (
                          <li key={i} className="failure-row">
                            <span className="failure-name">{failure.name}</span>
                            <span className="failure-reason">{failure.reason}</span>
                          </li>
                        ))}
                      </ul>
                      <p className="failure-hint">
                        Try a different output format{simpleMode ? ", or switch to Advanced mode to choose a specific engine" : ""}.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* ── Secondary context ── */}
            <aside className="sidebar" aria-label="About this converter">
              <section className="side-card" aria-labelledby="how-title">
                <h2 id="how-title" className="side-title">How it works</h2>
                <ol className="how-list">
                  <li>
                    <strong>Add files.</strong> Drop, paste or choose them. The format is detected
                    automatically.
                  </li>
                  <li>
                    <strong>Pick outputs.</strong> Only formats reachable from your input are shown.
                    Select several to get them all at once.
                  </li>
                  <li>
                    <strong>Convert.</strong> Preview, tweak images, and download each result.
                  </li>
                </ol>
              </section>

              <section className="side-card side-card--privacy" aria-labelledby="privacy-title">
                <span className="side-icon" aria-hidden="true">
                  <Icon name="shield" />
                </span>
                <div>
                  <h2 id="privacy-title" className="side-title">Stays on your device</h2>
                  <p>
                    Conversions run entirely in your browser. Your files are not
                    sent to a server.
                  </p>
                </div>
              </section>

              <section className="side-card" aria-labelledby="tips-title">
                <h2 id="tips-title" className="side-title">Tips</h2>
                <ul className="tip-list">
                  <li>
                    Paste files straight from your clipboard with <kbd>Ctrl</kbd>/<kbd>&#8984;</kbd> + <kbd>V</kbd>.
                  </li>
                  <li>Mixed batches convert each file from its own detected format.</li>
                  <li>
                    <strong>Advanced</strong> mode lists every engine, useful when a conversion
                    doesn&rsquo;t turn out as expected.
                  </li>
                </ul>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => helpRef.current?.showModal()}
                >
                  More help
                </button>
              </section>
            </aside>
          </div>
        </main>

        {/* ── Footer ── */}
        <footer className="footer">
          <p>
            Original project by{" "}
            <a href="https://github.com/p2r3/convert" target="_blank" rel="noopener noreferrer">
              p2r3
            </a>
            . Built for files that stay yours.
          </p>
        </footer>
      </div>

      {/* ── Help ── */}
      <dialog
        ref={helpRef}
        className="help-dialog"
        aria-labelledby="help-title"
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
      >
        <div className="help-inner">
          <div className="help-head">
            <h2 id="help-title">Using Convert to it!</h2>
            <button
              type="button"
              className="icon-btn"
              onClick={() => helpRef.current?.close()}
              aria-label="Close help"
            >
              <Icon name="x" />
            </button>
          </div>
          <div className="help-body">
            <section>
              <h3>Converting files</h3>
              <ol>
                <li>Drop files anywhere on the page, paste them, or use <strong>Choose files</strong>.</li>
                <li>The input format is detected from the file type or extension. If it&rsquo;s wrong or missing, use <strong>Change</strong> and pick it yourself.</li>
                <li>Select one or more output formats, then press <strong>Convert</strong>.</li>
                <li>Preview each result and download it individually or all at once.</li>
              </ol>
            </section>
            <section>
              <h3>Simple and Advanced modes</h3>
              <p>
                <strong>Simple</strong> merges duplicate formats offered by different engines.
                <strong> Advanced</strong> lists every format and engine separately, so you can
                choose exactly which tool performs the conversion.
              </p>
            </section>
            <section>
              <h3>Several files at once</h3>
              <p>
                Files of the same type convert together. If you add different types, each file is
                converted from its own detected format, and only outputs reachable from all of
                them are offered.
              </p>
            </section>
            <section>
              <h3>Editing images</h3>
              <p>
                After converting to an image format, choose <strong>Edit images</strong> to crop or
                remove a solid background. <strong>Undo</strong> restores the previous version.
              </p>
            </section>
            <section>
              <h3>Privacy</h3>
              <p>
                Conversion engines are downloaded to your browser and run there. Your files stay on
                your device.
              </p>
            </section>
          </div>
        </div>
      </dialog>

      {/* ── Progress / status ── */}
      {popup.open && (
        <div className="popup-backdrop">
          <div
            className="popup"
            role={popup.closable ? "alertdialog" : "dialog"}
            aria-modal="true"
            aria-labelledby="popup-title"
            aria-describedby="popup-detail"
            tabIndex={-1}
            ref={popupRef}
          >
            {!popup.closable && <span className="spinner spinner--lg" aria-hidden="true" />}
            {popup.closable && (
              <span className="results-badge results-badge--error" aria-hidden="true">
                <Icon name="alert" />
              </span>
            )}
            <h2 id="popup-title" aria-live="polite">{popup.title}</h2>
            <div id="popup-detail" aria-live="polite">
              {popup.routeProgress && <RoutePipeline progress={popup.routeProgress} />}
              {popup.detail && !popup.routeProgress && <p className="popup-detail">{popup.detail}</p>}
            </div>
            {popup.closable && (
              <button
                type="button"
                className="btn btn-primary"
                autoFocus
                onClick={() => setPopup((p) => ({ ...p, open: false }))}
              >
                OK
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function ResultRow({ file }: { file: OutputFile }) {
  return (
    <div className="result-row">
      <span className="file-ext" aria-hidden="true">{fileExtension(file.name)}</span>
      <div className="result-info">
        <span className="result-name" title={file.name}>{file.name}</span>
        <span className="result-size">{formatFileSize(file.size)}</span>
      </div>
      <button
        type="button"
        className="btn btn-primary btn-sm download-btn"
        onClick={() => downloadOutputFile(file)}
        aria-label={`Download ${file.name}`}
      >
        <Icon name="download" />
        <span>Download</span>
      </button>
    </div>
  );
}

function TextPreview({ url }: { url: string }) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(url)
      .then((res) => res.text())
      .then((t) => { if (!cancelled) setText(t); })
      .catch(() => { if (!cancelled) setText("[Could not load text preview]"); });
    return () => { cancelled = true; };
  }, [url]);

  if (text === null) return <div className="text-preview-loading">Loading preview...</div>;

  const MAX_CHARS = 4000;
  const truncated = text.length > MAX_CHARS;
  return (
    <pre className="text-preview-content">
      {truncated ? text.slice(0, MAX_CHARS) + "\n\n[truncated]" : text}
    </pre>
  );
}

function ImageResultCard({
  file,
  editOpen,
  canUndo,
  onEdited,
  onUndo,
}: {
  file: OutputFile;
  editOpen: boolean;
  canUndo: boolean;
  onEdited: (originalFile: OutputFile, editedFile: OutputFile) => void;
  onUndo: () => void;
}) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [activeTool, setActiveTool] = useState<"crop" | "remove" | null>(null);
  const [aspectRatio, setAspectRatio] = useState<CropAspectRatio>("free");
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  const [cropDrag, setCropDrag] = useState<{
    mode: "move" | "resize";
    handle?: CropResizeHandle;
    startPoint: Point;
    startRect: CropRect;
  } | null>(null);
  const [pickingColor, setPickingColor] = useState(false);
  const [removeSource, setRemoveSource] = useState<"corners" | "picked">("corners");
  const [targetColor, setTargetColor] = useState<RgbaColor | null>(null);
  const [tolerance, setTolerance] = useState(34);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setActiveTool(null);
    setCropRect(null);
    setCropDrag(null);
    setPickingColor(false);
    setError(null);
  }, [file.url]);

  const imageSize = () => {
    const img = imageRef.current;
    if (!img || !img.naturalWidth || !img.naturalHeight) return null;
    return { width: img.naturalWidth, height: img.naturalHeight };
  };

  const pointFromPointer = (event: React.PointerEvent): Point | null => {
    const img = imageRef.current;
    if (!img || !img.naturalWidth || !img.naturalHeight) return null;
    const bounds = img.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * img.naturalWidth;
    const y = ((event.clientY - bounds.top) / bounds.height) * img.naturalHeight;
    return {
      x: Math.max(0, Math.min(Math.round(x), img.naturalWidth - 1)),
      y: Math.max(0, Math.min(Math.round(y), img.naturalHeight - 1)),
    };
  };

  const ensureCropRect = () => {
    const size = imageSize();
    if (!size) return;
    setCropRect((rect) => rect ?? {
      x: Math.round(size.width * 0.1),
      y: Math.round(size.height * 0.1),
      width: Math.round(size.width * 0.8),
      height: Math.round(size.height * 0.8),
    });
  };

  const runEdit = async (task: () => Promise<OutputFile>) => {
    setEditing(true);
    setError(null);
    try {
      onEdited(file, await task());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setEditing(false);
    }
  };

  const onImageLoad = () => {
    const size = imageSize();
    if (size && activeTool === "crop") setCropRect((rect) => rect ?? { x: 0, y: 0, width: size.width, height: size.height });
  };

  const startCropMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (activeTool !== "crop" || pickingColor || editing) return;
    const point = pointFromPointer(event);
    if (!point || !cropRect) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setCropDrag({ mode: "move", startPoint: point, startRect: cropRect });
  };

  const startCropResize = (event: React.PointerEvent<HTMLButtonElement>, handle: CropResizeHandle) => {
    if (activeTool !== "crop" || pickingColor || editing) return;
    const point = pointFromPointer(event);
    if (!point || !cropRect) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setCropDrag({ mode: "resize", handle, startPoint: point, startRect: cropRect });
  };

  const moveCrop = (event: React.PointerEvent<HTMLDivElement>) => {
    if (activeTool !== "crop" || !cropDrag) return;
    const size = imageSize();
    const point = pointFromPointer(event);
    if (!size || !point) return;
    if (cropDrag.mode === "move") {
      setCropRect(moveCropRect(cropDrag.startRect, {
        x: point.x - cropDrag.startPoint.x,
        y: point.y - cropDrag.startPoint.y,
      }, size));
      return;
    }
    if (cropDrag.handle) {
      setCropRect(resizeCropRectFromHandle(cropDrag.startRect, cropDrag.handle, point, aspectRatio, size));
    }
  };

  const stopCrop = () => setCropDrag(null);

  const pickBackgroundColor = async (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pickingColor || editing) return;
    const point = pointFromPointer(event);
    if (!point) return;
    setPickingColor(false);
    setEditing(true);
    setError(null);
    try {
      const color = await getImageColorAt(file, point);
      setTargetColor(color);
      onEdited(file, await removeBackgroundFromOutputImage(file, [point], tolerance));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setEditing(false);
    }
  };

  const applyCrop = () => {
    if (!cropRect) return;
    void runEdit(() => cropOutputImage(file, cropRect));
  };

  const removeCornerBackground = () => {
    const size = imageSize();
    if (!size) return;
    const seeds = [
      { x: 0, y: 0 },
      { x: size.width - 1, y: 0 },
      { x: 0, y: size.height - 1 },
      { x: size.width - 1, y: size.height - 1 },
    ];
    void runEdit(() => removeBackgroundFromOutputImage(file, seeds, tolerance));
  };

  const cropStyle = (() => {
    const img = imageRef.current;
    const surface = img?.parentElement;
    if (!cropRect || !img || !surface || !img.naturalWidth || !img.naturalHeight) return undefined;
    const imageBounds = img.getBoundingClientRect();
    const surfaceBounds = surface.getBoundingClientRect();
    return {
      left: `${imageBounds.left - surfaceBounds.left + (cropRect.x / img.naturalWidth) * imageBounds.width}px`,
      top: `${imageBounds.top - surfaceBounds.top + (cropRect.y / img.naturalHeight) * imageBounds.height}px`,
      width: `${(cropRect.width / img.naturalWidth) * imageBounds.width}px`,
      height: `${(cropRect.height / img.naturalHeight) * imageBounds.height}px`,
    } as React.CSSProperties;
  })();

  return (
    <article className={`result-card result-card--image${editOpen ? " is-editing" : ""}`}>
      <div
        className={`image-edit-surface${activeTool === "crop" ? " cropping" : ""}${pickingColor ? " picking" : ""}`}
        onPointerDown={(event) => {
          void pickBackgroundColor(event);
        }}
        onPointerMove={moveCrop}
        onPointerUp={stopCrop}
        onPointerCancel={stopCrop}
      >
        <img ref={imageRef} src={file.url} alt={`Preview of ${file.name}`} onLoad={onImageLoad} />
        {activeTool === "crop" && cropStyle && (
          <div className="crop-box" style={cropStyle} onPointerDown={startCropMove}>
            {(["nw", "ne", "sw", "se"] as CropResizeHandle[]).map((handle) => (
              <button
                key={handle}
                type="button"
                className={`crop-handle crop-handle-${handle}`}
                aria-label={`Resize crop ${handle}`}
                onPointerDown={(event) => startCropResize(event, handle)}
              />
            ))}
          </div>
        )}
        {editing && (
          <div className="edit-busy" role="status">
            <span className="spinner" aria-hidden="true" />
            Editing&hellip;
          </div>
        )}
      </div>

      {editOpen && (
        <div className="image-edit-panel" role="group" aria-label={`Edit ${file.name}`}>
          <div className="image-edit-actions">
            <IconButton
              label="Crop"
              active={activeTool === "crop"}
              disabled={editing}
              icon="crop"
              onClick={() => {
                setActiveTool((tool) => (tool === "crop" ? null : "crop"));
                setPickingColor(false);
                ensureCropRect();
              }}
            />
            <IconButton
              label="Remove background"
              active={activeTool === "remove"}
              disabled={editing}
              icon="eraser"
              onClick={() => {
                setActiveTool((tool) => (tool === "remove" ? null : "remove"));
                setPickingColor(false);
              }}
            />
            <IconButton
              label="Undo"
              disabled={!canUndo || editing}
              icon="undo"
              onClick={onUndo}
            />
          </div>

          {activeTool === "crop" && (
            <div className="tool-settings">
              <div className="aspect-buttons" role="group" aria-label="Crop aspect ratio">
                {(["free", "1:1", "4:3", "16:9", "3:4"] as CropAspectRatio[]).map((ratio) => (
                  <button
                    key={ratio}
                    className="aspect-btn"
                    aria-pressed={aspectRatio === ratio}
                    onClick={() => setAspectRatio(ratio)}
                    type="button"
                  >
                    {ratio === "free" ? "Free" : ratio}
                  </button>
                ))}
              </div>
              <IconButton
                label="Apply crop"
                primary
                disabled={!cropRect || editing}
                icon="check"
                onClick={applyCrop}
              />
            </div>
          )}

          {activeTool === "remove" && (
            <div className="tool-settings">
              <div className="remove-source-buttons" role="group" aria-label="Remove background source">
                <button
                  className="aspect-btn"
                  aria-pressed={removeSource === "corners"}
                  onClick={() => {
                    setRemoveSource("corners");
                    setPickingColor(false);
                    removeCornerBackground();
                  }}
                  type="button"
                  disabled={editing}
                >
                  <Icon name="sparkles" />
                  <span>From corners</span>
                </button>
                <button
                  className="aspect-btn"
                  aria-pressed={removeSource === "picked"}
                  onClick={() => {
                    setRemoveSource("picked");
                    setPickingColor(true);
                  }}
                  type="button"
                  disabled={editing}
                >
                  <Icon name="eyedropper" />
                  <span>{pickingColor ? "Click the image" : "Pick a color"}</span>
                </button>
              </div>
              <div className="background-tools">
                <label>
                  <span>Tolerance</span>
                  <input
                    type="range"
                    min="0"
                    max="120"
                    value={tolerance}
                    onChange={(event) => setTolerance(Number(event.target.value))}
                  />
                  <output className="tolerance-value">{tolerance}</output>
                </label>
                {targetColor && (
                  <span
                    className="picked-color"
                    role="img"
                    aria-label={`Picked color rgb(${targetColor[0]}, ${targetColor[1]}, ${targetColor[2]})`}
                    title={`rgb(${targetColor[0]}, ${targetColor[1]}, ${targetColor[2]})`}
                    style={{ backgroundColor: `rgb(${targetColor[0]}, ${targetColor[1]}, ${targetColor[2]})` }}
                  />
                )}
              </div>
            </div>
          )}

          {error && <p className="edit-error" role="alert">{error}</p>}
        </div>
      )}

      <ResultRow file={file} />
    </article>
  );
}

function IconButton({
  label,
  icon,
  active,
  primary = false,
  disabled = false,
  onClick,
}: {
  label: string;
  icon: IconName;
  active?: boolean;
  primary?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`tool-btn${primary ? " tool-btn--primary" : ""}`}
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
    >
      <Icon name={icon} />
      <span>{label}</span>
    </button>
  );
}

type IconName =
  | "alert"
  | "arrow-left"
  | "arrow-right"
  | "check"
  | "chevron"
  | "code"
  | "crop"
  | "download"
  | "eraser"
  | "eyedropper"
  | "file-upload"
  | "help"
  | "lock"
  | "plus"
  | "refresh"
  | "search"
  | "shield"
  | "sparkles"
  | "undo"
  | "upload"
  | "x";

const ICON_PATHS: Record<IconName, React.ReactNode> = {
  alert: (
    <>
      <path d="M12 9v4M12 16.5h.01" />
      <path d="M10.3 3.9 2.5 17.4A2 2 0 0 0 4.2 20.4h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    </>
  ),
  "arrow-left": <path d="M19 12H5m6-6-6 6 6 6" />,
  "arrow-right": <path d="M5 12h14m-6-6 6 6-6 6" />,
  check: <path d="m4.5 12.75 6 6 9-13.5" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  code: <path d="m8 7-5 5 5 5m8-10 5 5-5 5M13.5 4.5l-3 15" />,
  crop: (
    <>
      <path d="M6.75 3v10.5A3.75 3.75 0 0 0 10.5 17.25H21" />
      <path d="M3 6.75h10.5A3.75 3.75 0 0 1 17.25 10.5V21" />
    </>
  ),
  download: <path d="M12 4v11m-5-5 5 5 5-5M4.5 19.5h15" />,
  eraser: (
    <>
      <path d="m16.5 8.25-8.25 8.25a3 3 0 0 0 4.24 4.24l8.25-8.25a3 3 0 0 0-4.24-4.24Z" />
      <path d="m12 12.75 4.25 4.25M3.75 21h9" />
    </>
  ),
  eyedropper: (
    <>
      <path d="m15.75 5.25 3 3m-11.25 9 9.75-9.75a2.12 2.12 0 0 0-3-3L4.5 14.25V19.5h5.25Z" />
      <path d="M6 16.5 3.75 18.75" />
    </>
  ),
  "file-upload": (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
      <path d="M14 3v5h5M12 17.5v-6m-2.75 2.75L12 11.5l2.75 2.75" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.4c-.7.3-1 .8-1 1.5v.3M12 16.8h.01" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  refresh: (
    <path d="M4.5 12a7.5 7.5 0 0 1 13-5.1L19.5 9M19.5 4.5V9H15M19.5 12a7.5 7.5 0 0 1-13 5.1L4.5 15M4.5 19.5V15H9" />
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.4-4.4" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6Z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </>
  ),
  sparkles: (
    <>
      <path d="M9.75 3.75 8.25 8.25 3.75 9.75l4.5 1.5 1.5 4.5 1.5-4.5 4.5-1.5-4.5-1.5-1.5-4.5Z" />
      <path d="M18 12.75 17.25 15l-2.25.75 2.25.75L18 18.75l.75-2.25 2.25-.75-2.25-.75L18 12.75Z" />
    </>
  ),
  undo: <path d="M9 15 3.75 9.75 9 4.5M4.5 9.75H15a5.25 5.25 0 1 1 0 10.5h-2.25" />,
  upload: <path d="M12 16V4.5m-5 5 5-5 5 5M4.5 19.5h15" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
};

function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      className={`icon${className ? ` ${className}` : ""}`}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

function MediaIcon({ category }: { category: FormatCategory }) {
  const paths: Record<FormatCategory, React.ReactNode> = {
    image: (
      <>
        <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
        <circle cx="8.5" cy="9.5" r="1.6" />
        <path strokeLinecap="round" strokeLinejoin="round" d="m4 17 4.5-4.5 3.5 3.5 3-3 5 5" />
      </>
    ),
    audio: (
      <>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 18V6l10-2v12" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="16" cy="16" r="3" />
      </>
    ),
    video: (
      <>
        <rect x="2.5" y="5.5" width="13" height="13" rx="2.5" />
        <path strokeLinecap="round" strokeLinejoin="round" d="m15.5 10 6-3.5v11l-6-3.5" />
      </>
    ),
    text: (
      <>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.5 3.5h11a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.5 8h7M8.5 11.5h7M8.5 15h4" />
      </>
    ),
    application: (
      <>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8.5Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 3.5V8.5h5" />
      </>
    ),
    other: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.6 9.5a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.5v.4" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5h.01" />
      </>
    ),
  };

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7">
      {paths[category]}
    </svg>
  );
}

function RoutePipeline({ progress }: { progress: RouteProgress }) {
  const { steps, phase, message, pathsExplored } = progress;

  return (
    <div className="route-pipeline">
      <div className="route-steps">
        {steps.map((step, i) => (
          <div key={i} className="route-step-wrapper">
            {i > 0 && <span className={`route-arrow route-arrow--${steps[i - 1].status}`}>&rarr;</span>}
            <div className={`route-node route-node--${step.status}`}>
              <span className="route-node-format">{step.format}</span>
              {step.handler && (
                <span className="route-node-handler">{step.handler}</span>
              )}
            </div>
          </div>
        ))}
      </div>
      {message && <p className="route-message">{message}</p>}
      {phase === "searching" && (
        <p className="route-stats">{pathsExplored} route{pathsExplored !== 1 ? "s" : ""} explored</p>
      )}
    </div>
  );
}
