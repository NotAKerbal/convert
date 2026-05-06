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
  type ConversionFailure,
  downloadOutputFile,
  formatFileSize,
  getDetectedInputSummary,
  getPreviewKind,
  groupByCategory,
  initHandlers,
  loadCacheFromPublic,
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

  // ── initial handler load (once) ──

  const [handlersReady, setHandlersReady] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoadingFormats(true);
      setPopup({
        open: true,
        title: "Loading tools...",
        detail: "Building the supported format list. This may take a moment.",
        closable: false,
      });
      await loadCacheFromPublic();
      await initHandlers();
      if (!active) return;
      setHandlersReady(true);
      setLoadingFormats(false);
      setPopup((p) => ({ ...p, open: false }));
    })().catch((err) => {
      if (!active) return;
      console.error(err);
      setLoadingFormats(false);
      setPopup({ open: true, title: "Failed to load tools", detail: String(err), closable: true });
    });
    return () => { active = false; };
  }, []);

  // ── rebuild lists when mode changes (instant, no async) ──

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
  }, [simpleMode, handlersReady]);

  // ── file selection ──

  const selectFiles = useCallback(
    (files: File[]) => {
      if (!files.length) return;
      const sorted = files.slice().sort((a, b) => a.name.localeCompare(b.name));
      setSelectedFiles(sorted);
      setSelectedOutputIndices(new Set());
      setOutputCollapsed(false);
      setSearchOutput("");
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

  // ── filtered & grouped indices ──

  const filteredInputs = useMemo(
    () => lists.inputIndices.filter((i) => {
      const o = lists.allOptions[i];
      return o && matchesSearch(o, simpleMode, searchInput);
    }),
    [lists, searchInput, simpleMode]
  );

  const filteredOutputs = useMemo(
    () => lists.outputIndices.filter((i) => {
      const o = lists.allOptions[i];
      return o && matchesSearch(o, simpleMode, searchOutput);
    }),
    [lists, searchOutput, simpleMode]
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
    <main className="page">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={(e) => { if (e.target.files) selectFiles(Array.from(e.target.files)); }}
      />

      {/* ── Header ── */}
      <header className="header">
        <h1>Convert to it!</h1>
        <div className="header-actions">
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
                {selectedFiles.length > 0
                  ? "Select input format"
                  : "Supported input formats"}
              </div>
              <input
                className="search"
                placeholder="Search formats..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                autoFocus={selectedFiles.length > 0}
              />
              {renderGroupedGrid(
                inputGroups,
                (idx) => idx === selectedInputIdx,
                selectedFiles.length > 0
                  ? (idx) => setSelectedInputIdx(idx)
                  : () => {}
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
