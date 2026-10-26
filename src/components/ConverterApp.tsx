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

interface CategoryCount {
  category: FormatCategory;
  label: string;
  color: string;
  count: number;
}

function countByCategory(indices: number[], allOptions: FormatOption[]): CategoryCount[] {
  const counts = new Map<FormatCategory, number>();
  for (const idx of indices) {
    const opt = allOptions[idx];
    if (!opt) continue;
    const cat = getFormatCategory(opt.format.mime);
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }
  return BROWSE_CATEGORIES
    .filter((cat) => (counts.get(cat) ?? 0) > 0)
    .map((cat) => ({ category: cat, ...CATEGORY_META[cat], count: counts.get(cat)! }));
}

function renderCategoryTiles(
  counts: CategoryCount[],
  onPick: (category: FormatCategory) => void
) {
  if (counts.length === 0) {
    return <div className="empty">No matching formats found.</div>;
  }
  return (
    <div className="category-tiles">
      {counts.map((entry) => (
        <button
          key={entry.category}
          className="category-tile"
          style={{ "--cat-color": entry.color } as React.CSSProperties}
          onClick={() => onPick(entry.category)}
        >
          <span className="category-tile-icon" style={{ color: entry.color }}>
            <MediaIcon category={entry.category} />
          </span>
          <span className="category-tile-label">{entry.label}</span>
          <span className="category-tile-count">
            {entry.count} format{entry.count !== 1 ? "s" : ""}
          </span>
        </button>
      ))}
    </div>
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
    <div className="category-chips" role="tablist" aria-label="Filter by type">
      <button
        className={`category-chip${active === null ? " active" : ""}`}
        onClick={() => onPick(null)}
      >
        All
        <span className="category-chip-count">{total}</span>
      </button>
      {counts.map((entry) => (
        <button
          key={entry.category}
          className={`category-chip${active === entry.category ? " active" : ""}`}
          style={{ "--cat-color": entry.color } as React.CSSProperties}
          onClick={() => onPick(active === entry.category ? null : entry.category)}
        >
          <span className="category-chip-dot" style={{ background: entry.color }} />
          {entry.label}
          <span className="category-chip-count">{entry.count}</span>
        </button>
      ))}
    </div>
  );
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
    catColor: string
  ) => (
    <button
      key={index}
      className={`format-card${isSelected ? " selected" : ""}`}
      style={{ "--cat-color": catColor } as React.CSSProperties}
      onClick={onSelect}
    >
      <span className="ext" style={{ color: catColor }}>{option.format.extension.slice(0, 5)}</span>
      <span className="label">
        <span className="name">{option.format.format.toUpperCase()}</span>
        <span className="mime">
          {simpleMode
            ? option.format.mime
            : `${option.format.mime} \u00B7 ${option.handler.name}`}
        </span>
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
        <div key={group.category} className="category-section">
          <div className="category-label" style={{ color: group.color }}>
            <span className="category-dot" style={{ background: group.color }} />
            {group.label}
          </div>
          <div className="format-grid">
            {group.indices.map((idx) =>
              renderCard(idx, lists.allOptions[idx], isSelectedFn(idx), () => onSelectFn(idx), group.color)
            )}
          </div>
        </div>
      ))}
      {groups.length === 0 && <div className="empty">No matching formats found.</div>}
    </div>
  );

  const inputOpt = selectedInputIdx !== null ? lists.allOptions[selectedInputIdx] : null;
  const inputSummaryLabel = canUseDetectedBatch
    ? `${detectedInputSummary.formatCount} input formats`
    : inputOpt?.format.format.toUpperCase();

  return (
    <main className="page converter-page" id="main-content">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files) selectFiles(Array.from(e.target.files));
          // Allow re-selecting the same file later (e.g. after "Start Over").
          e.target.value = "";
        }}
      />

      {/* ── Header ── */}
      <header className="header">
        <div>
          <p className="eyebrow">FILES, REIMAGINED</p>
          <h1>File converter</h1>
        </div>
        <div className="header-actions">
          {backgroundLoading && !popup.open && (
            <span className="bg-loading" title="Loading conversion engines in the background">
              <span className="bg-loading-dot" />
              Warming up tools...
            </span>
          )}
          {step !== "upload" && (
            <button className="restart-btn" onClick={restart}>Restart</button>
          )}
          <button
            className="mode-toggle"
            onClick={() => setSimpleMode((v) => !v)}
            disabled={loadingFormats || converting}
          >
            {simpleMode ? "Advanced" : "Simple"}
          </button>
        </div>
      </header>

      {/* ── Step 1: Upload ── */}
      {step === "upload" && (
        <>
          <div
            className={`drop-zone${selectedFiles.length > 0 ? " has-file" : ""}`}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
            }}
          >
            {selectedFiles.length === 0 ? (
              <>
                <h2>Click to add your files</h2>
                <p>or drag &amp; drop it here &middot; paste also works</p>
              </>
            ) : (
              <div>
                <h2>{selectedFiles[0].name}</h2>
                {selectedFiles.length > 1 && <p>and {selectedFiles.length - 1} more</p>}
                <p>Could not auto-detect format &mdash; please select below</p>
              </div>
            )}
          </div>

          {!loadingFormats && lists.inputIndices.length > 0 && (
            <section>
              <div className="step-label">
                {selectedFiles.length > 0 ? "Select input format" : "What are you converting?"}
                {selectedFiles.length === 0 && !inputCategory && !searchInput.trim() && (
                  <span className="bulk-hint">pick a type, or drop a file above</span>
                )}
              </div>
              <input
                className="search"
                placeholder="Search all formats..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                autoFocus={selectedFiles.length > 0}
              />
              {!searchInput.trim() && !inputCategory ? (
                renderCategoryTiles(inputCategoryCounts, (cat) => setInputCategory(cat))
              ) : (
                <>
                  {inputCategory && !searchInput.trim() && (
                    <button
                      className="category-back"
                      onClick={() => setInputCategory(null)}
                    >
                      &larr; All types
                    </button>
                  )}
                  {renderGroupedGrid(
                    inputGroups,
                    (idx) => idx === selectedInputIdx,
                    selectedFiles.length > 0
                      ? (idx) => setSelectedInputIdx(idx)
                      : () => fileInputRef.current?.click()
                  )}
                </>
              )}
            </section>
          )}
        </>
      )}

      {/* ── Step 2: Pick output ── */}
      {step === "pick-output" && (
        <>
          <div
            className="drop-zone has-file"
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
            }}
          >
            <div>
              <h2>{selectedFiles[0]?.name}</h2>
              {selectedFiles.length > 1 && <p>and {selectedFiles.length - 1} more</p>}
              {inputOpt && (
                <p>
                  Detected as <strong>{inputOpt.format.format.toUpperCase()}</strong>
                  {" "}
                  <button
                    className="change-format-link"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedInputIdx(null);
                      setSelectedOutputIndices(new Set());
                      setOutputCollapsed(false);
                    }}
                  >
                    Change
                  </button>
                </p>
              )}
              {!inputOpt && canUseDetectedBatch && (
                <p>
                  Detected <strong>{detectedInputSummary.formatCount} input formats</strong>
                  {" "}across {selectedFiles.length} files
                </p>
              )}
            </div>
          </div>

          <button className="change-link" onClick={restart}>&larr; Choose a different file</button>

          <section style={{ marginTop: 20 }}>
            <div className="step-label">
              Convert to
              <span className="bulk-hint">select one or more formats</span>
            </div>
            <input
              className="search"
              placeholder="Search output formats..."
              value={searchOutput}
              onChange={(e) => setSearchOutput(e.target.value)}
              autoFocus
            />
            {renderCategoryChips(outputCategoryCounts, outputCategory, setOutputCategory)}
            {renderGroupedGrid(
              outputGroups,
              (idx) => selectedOutputIndices.has(idx),
              (idx) => toggleOutput(idx, true)
            )}
          </section>
        </>
      )}

      {/* ── Step 3: Ready to convert ── */}
      {step === "ready" && (inputOpt || canUseDetectedBatch) && (
        <>
          <div className="summary">
            <span className="tag">{inputSummaryLabel}</span>
            <span className="arrow">&rarr;</span>
            <span className="tag-group">
              {Array.from(selectedOutputIndices).map((idx) => {
                const opt = lists.allOptions[idx];
                return (
                  <span key={idx} className="tag">
                    {opt.format.format.toUpperCase()}
                    <button
                      className="tag-remove"
                      onClick={() => toggleOutput(idx)}
                      title="Remove"
                    >
                      &times;
                    </button>
                  </span>
                );
              })}
            </span>
          </div>

          <div className="summary-meta">
            <p>
              {selectedFiles[0]?.name}
              {selectedFiles.length > 1 ? ` + ${selectedFiles.length - 1} more` : ""}
            </p>
            <button className="change-link" onClick={restart}>Change file</button>
          </div>

          <button
            className="convert-btn"
            onClick={onConvert}
            disabled={converting || loadingFormats}
          >
            {converting
              ? "Converting\u2026"
              : selectedOutputIndices.size > 1
                ? `Convert to ${selectedOutputIndices.size} formats`
                : "Convert Now"}
          </button>

          <section style={{ marginTop: 24 }}>
            <button
              className="collapsible-toggle"
              onClick={() => setOutputCollapsed((v) => !v)}
            >
              <span className={`chevron${outputCollapsed ? "" : " open"}`}>&#9654;</span>
              {outputCollapsed ? "Show output formats" : "Hide output formats"}
            </button>

            {!outputCollapsed && (
              <>
                <input
                  className="search"
                  placeholder="Search output formats..."
                  value={searchOutput}
                  onChange={(e) => setSearchOutput(e.target.value)}
                  style={{ marginTop: 8 }}
                />
                {renderCategoryChips(outputCategoryCounts, outputCategory, setOutputCategory)}
                {renderGroupedGrid(
                  outputGroups,
                  (idx) => selectedOutputIndices.has(idx),
                  (idx) => toggleOutput(idx)
                )}
              </>
            )}
          </section>
        </>
      )}

      {/* ── Step 4: Results ── */}
      {step === "results" && (
        <section className="results-section">
          <h2 className="results-title">
            {results.length > 0
              ? conversionFailures.length > 0
                ? "Conversion Finished"
                : "Conversion Complete"
              : "Conversion Failed"}
          </h2>
          {resultPath && <p className="results-path">Route: {resultPath}</p>}

          {results.length > 0 && (
            <div className="results-list">
              {hasImageResults && (
                <button
                  className={`edit-outputs-toggle${editOutputsOpen ? " active" : ""}`}
                  onClick={() => setEditOutputsOpen((open) => !open)}
                >
                  <HeroIcon name="sparkles" />
                  <span>Edit outputs</span>
                </button>
              )}
              {results.map((file, i) => {
                const preview = getPreviewKind(file.mime);
                if (preview === "image") {
                  return (
                    <ImageResultCard
                      key={i}
                      file={file}
                      editOpen={editOutputsOpen}
                      canUndo={(outputHistory[i]?.length ?? 0) > 0}
                      onEdited={(originalFile, editedFile) => replaceEditedOutput(i, originalFile, editedFile)}
                      onUndo={() => undoEditedOutput(i)}
                    />
                  );
                }
                return (
                  <div key={i} className="result-card">
                    {preview && (
                      <div className="result-preview">
                        {preview === "audio" && (
                          <audio controls src={file.url} />
                        )}
                        {preview === "video" && (
                          <video controls src={file.url} />
                        )}
                        {preview === "pdf" && (
                          <iframe src={file.url} title={file.name} />
                        )}
                        {preview === "text" && (
                          <TextPreview url={file.url} />
                        )}
                      </div>
                    )}
                    <div className="result-row">
                      <div className="result-info">
                        <span className="result-name">{file.name}</span>
                        <span className="result-size">{formatFileSize(file.size)}</span>
                      </div>
                      <button className="download-btn" onClick={() => downloadOutputFile(file)}>
                        Download
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {conversionFailures.length > 0 && (
            <div className="failure-list">
              <h3>{conversionFailures.length} file{conversionFailures.length !== 1 ? "s" : ""} skipped</h3>
              {conversionFailures.map((failure, i) => (
                <div key={i} className="failure-row">
                  <span className="failure-name">{failure.name}</span>
                  <span className="failure-reason">{failure.reason}</span>
                </div>
              ))}
            </div>
          )}

          {results.length > 1 && (
            <button
              className="download-all-btn"
              onClick={() => results.forEach((f) => downloadOutputFile(f))}
            >
              Download All ({results.length} files)
            </button>
          )}

          <button className="restart-btn-large" onClick={restart}>
            Start Over
          </button>
        </section>
      )}

      {/* ── Footer ── */}
      <footer className="footer">
        Original project by{" "}
        <a href="https://github.com/p2r3/convert" target="_blank" rel="noopener noreferrer">
          p2r3
        </a>
        . This is a modern Next.js UI for his project, keeping all local-first conversion
        features intact.
      </footer>

      {/* ── Popup ── */}
      {popup.open && (
        <div className="popup-backdrop">
          <div className="popup">
            <h4>{popup.title}</h4>
            {popup.routeProgress && <RoutePipeline progress={popup.routeProgress} />}
            {popup.detail && !popup.routeProgress && <p>{popup.detail}</p>}
            {popup.closable && (
              <button
                className="popup-btn"
                onClick={() => setPopup((p) => ({ ...p, open: false }))}
              >
                OK
              </button>
            )}
          </div>
        </div>
      )}
    </main>
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
    <div className="result-card">
      <div
        className={`image-edit-surface${activeTool === "crop" ? " cropping" : ""}${pickingColor ? " picking" : ""}`}
        onPointerDown={(event) => {
          void pickBackgroundColor(event);
        }}
        onPointerMove={moveCrop}
        onPointerUp={stopCrop}
        onPointerCancel={stopCrop}
      >
        <img ref={imageRef} src={file.url} alt={file.name} onLoad={onImageLoad} />
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
        {editing && <div className="edit-busy">Editing...</div>}
      </div>

      {editOpen && (
        <div className="image-edit-panel">
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
              label="Remove"
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
              <div className="aspect-buttons" aria-label="Crop aspect ratio">
                {(["free", "1:1", "4:3", "16:9", "3:4"] as CropAspectRatio[]).map((ratio) => (
                  <button
                    key={ratio}
                    className={`aspect-btn${aspectRatio === ratio ? " active" : ""}`}
                    onClick={() => setAspectRatio(ratio)}
                    type="button"
                  >
                    <HeroIcon name="crop" />
                    <span>{ratio === "free" ? "Free" : ratio}</span>
                  </button>
                ))}
              </div>
              <IconButton
                label="Apply crop"
                disabled={!cropRect || editing}
                icon="check"
                onClick={applyCrop}
              />
            </div>
          )}

          {activeTool === "remove" && (
            <div className="tool-settings">
              <div className="remove-source-buttons" aria-label="Remove background source">
                <button
                  className={`aspect-btn${removeSource === "corners" ? " active" : ""}`}
                  onClick={() => {
                    setRemoveSource("corners");
                    setPickingColor(false);
                    removeCornerBackground();
                  }}
                  type="button"
                  disabled={editing}
                >
                  <HeroIcon name="sparkles" />
                  <span>Corners</span>
                </button>
                <button
                  className={`aspect-btn${removeSource === "picked" ? " active" : ""}`}
                  onClick={() => {
                    setRemoveSource("picked");
                    setPickingColor(true);
                  }}
                  type="button"
                  disabled={editing}
                >
                  <HeroIcon name="eyedropper" />
                  <span>{pickingColor ? "Click image" : "Pick color"}</span>
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
                </label>
                {targetColor && (
                  <span
                    className="picked-color"
                    title={`rgb(${targetColor[0]}, ${targetColor[1]}, ${targetColor[2]})`}
                    style={{ backgroundColor: `rgb(${targetColor[0]}, ${targetColor[1]}, ${targetColor[2]})` }}
                  />
                )}
              </div>
            </div>
          )}

          {error && <p className="edit-error">{error}</p>}
        </div>
      )}

      <div className="result-row">
        <div className="result-info">
          <span className="result-name">{file.name}</span>
          <span className="result-size">{formatFileSize(file.size)}</span>
        </div>
        <button className="download-btn" onClick={() => downloadOutputFile(file)}>
          Download
        </button>
      </div>
    </div>
  );
}

function IconButton({
  label,
  icon,
  active = false,
  disabled = false,
  onClick,
}: {
  label: string;
  icon: HeroIconName;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`hero-icon-btn${active ? " active" : ""}`}
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
    >
      <HeroIcon name={icon} />
      <span>{label}</span>
    </button>
  );
}

type HeroIconName = "check" | "crop" | "eraser" | "eyedropper" | "sparkles" | "undo";

function HeroIcon({ name }: { name: HeroIconName }) {
  const paths: Record<HeroIconName, React.ReactNode> = {
    check: <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />,
    crop: (
      <>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v10.5A3.75 3.75 0 0 0 10.5 17.25H21" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 6.75h10.5A3.75 3.75 0 0 1 17.25 10.5V21" />
      </>
    ),
    eraser: (
      <>
        <path strokeLinecap="round" strokeLinejoin="round" d="m16.5 8.25-8.25 8.25a3 3 0 0 0 4.24 4.24l8.25-8.25a3 3 0 0 0-4.24-4.24Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="m12 12.75 4.25 4.25M3.75 21h9" />
      </>
    ),
    eyedropper: (
      <>
        <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 5.25 3 3m-11.25 9 9.75-9.75a2.12 2.12 0 0 0-3-3L4.5 14.25V19.5h5.25Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 16.5 3.75 18.75" />
      </>
    ),
    sparkles: (
      <>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.75 8.25 8.25 3.75 9.75l4.5 1.5 1.5 4.5 1.5-4.5 4.5-1.5-4.5-1.5-1.5-4.5Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 12.75 17.25 15l-2.25.75 2.25.75L18 18.75l.75-2.25 2.25-.75-2.25-.75L18 12.75Z" />
      </>
    ),
    undo: <path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3.75 9.75 9 4.5M4.5 9.75H15a5.25 5.25 0 1 1 0 10.5h-2.25" />,
  };

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
      {paths[name]}
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
