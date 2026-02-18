"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  buildFormatLists,
  downloadOutputFile,
  formatFileSize,
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

  const [popup, setPopup] = useState<PopupState>({
    open: false,
    title: "",
    closable: false,
  });

  const step: Step = useMemo(() => {
    if (results.length > 0) return "results";
    if (selectedOutputIndices.size > 0 && selectedInputIdx !== null && selectedFiles.length > 0) {
      return "ready";
    }
    if (selectedFiles.length > 0 && selectedInputIdx !== null) return "pick-output";
    return "upload";
  }, [selectedFiles, selectedInputIdx, selectedOutputIndices, results]);

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
      if (files.some((f) => f.type !== files[0].type)) {
        alert("All input files must be of the same type.");
        return;
      }
      const sorted = files.slice().sort((a, b) => a.name.localeCompare(b.name));
      setSelectedFiles(sorted);
      setSelectedOutputIndices(new Set());
      setOutputCollapsed(false);
      setSearchOutput("");
      revokeOutputFiles(results);
      setResults([]);
      setResultPath("");

      const auto = pickInputByFiles(sorted, lists.allOptions, lists.inputIndices);
      setSearchInput(auto.searchValue);
      if (auto.selectedInputIndex !== null) setSelectedInputIdx(auto.selectedInputIndex);
    },
    [lists, results]
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
    if (!selectedFiles.length || selectedInputIdx === null || selectedOutputIndices.size === 0) return;
    const inputOpt = lists.allOptions[selectedInputIdx];
    if (!inputOpt) return;

    setConverting(true);
    setPopup({ open: true, title: "Converting...", closable: false, routeProgress: null });

    const allOutputFiles: OutputFile[] = [];
    const pathParts: string[] = [];

    const targets = Array.from(selectedOutputIndices);
    for (let t = 0; t < targets.length; t++) {
      const outputOpt = lists.allOptions[targets[t]];
      if (!outputOpt) continue;

      const batchLabel = targets.length > 1 ? ` (${t + 1}/${targets.length})` : "";

      setPopup({
        open: true,
        title: `Finding conversion route${batchLabel}`,
        detail: `${inputOpt.format.format.toUpperCase()} \u2192 ${outputOpt.format.format.toUpperCase()}`,
        closable: false,
        routeProgress: null,
      });

      try {
        const out = await runConversion({
          selectedFiles,
          inputOption: inputOpt,
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
        pathParts.push(out.path.map((n) => n.format.format).join(" \u2192 "));
      } catch (err) {
        console.error(err);
        setPopup({
          open: true,
          title: `Failed: ${inputOpt.format.format} \u2192 ${outputOpt.format.format}`,
          detail: String(err),
          closable: true,
          routeProgress: null,
        });
        setConverting(false);
        return;
      }
    }

    setResults(allOutputFiles);
    setResultPath(pathParts.join(" ; "));
    setConverting(false);
    setPopup((p) => ({ ...p, open: false }));
  };

  // ── restart ──

  const restart = () => {
    revokeOutputFiles(results);
    setSelectedFiles([]);
    setSelectedInputIdx(null);
    setSelectedOutputIndices(new Set());
    setSearchInput("");
    setSearchOutput("");
    setOutputCollapsed(false);
    setResults([]);
    setResultPath("");
  };

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
                <h2>Click to add your file</h2>
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
      {step === "ready" && inputOpt && (
        <>
          <div className="summary">
            <span className="tag">{inputOpt.format.format.toUpperCase()}</span>
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
          <h2 className="results-title">Conversion Complete</h2>
          {resultPath && <p className="results-path">Route: {resultPath}</p>}

          <div className="results-list">
            {results.map((file, i) => {
              const preview = getPreviewKind(file.mime);
              return (
                <div key={i} className="result-card">
                  {preview && (
                    <div className="result-preview">
                      {preview === "image" && (
                        <img src={file.url} alt={file.name} />
                      )}
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
