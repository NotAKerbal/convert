"use client";

import { useCallback, useEffect, useRef, useState, type ClipboardEvent } from "react";
import {
  DOCUMENT_DRAFT_KEY,
  documentFilename,
  exportDocumentHtml,
  sanitizeDocumentHtml,
  textToDocumentHtml,
} from "../lib/documentEditor";
import { downloadText, getTextStats } from "../lib/toolUtils";

type Draft = { version: 1; title: string; html: string };
const emptyDraft: Draft = { version: 1, title: "Untitled document", html: "" };
const formats = [
  { command: "bold", label: "Bold", text: "B" },
  { command: "italic", label: "Italic", text: "I" },
  { command: "underline", label: "Underline", text: "U" },
  { command: "insertUnorderedList", label: "Bullet list", text: "• List" },
  { command: "insertOrderedList", label: "Numbered list", text: "1. List" },
] as const;

export function DocumentEditor() {
  const editor = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const selection = useRef<Range | null>(null);
  const latest = useRef<Draft>(emptyDraft);
  const savedVersion = useRef<string | null>(null);
  const pendingChanges = useRef(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [ready, setReady] = useState(false);
  const [text, setText] = useState("");
  const [notice, setNotice] = useState("");
  const [saveStatus, setSaveStatus] = useState("Loading local draft…");
  const [activeFormats, setActiveFormats] = useState<string[]>([]);
  const [block, setBlock] = useState("p");
  const stats = getTextStats(text);

  const saveDraft = useCallback((report = true) => {
    if (!pendingChanges.current) return true;
    try {
      // An unedited tab never writes. An edited tab may only replace the
      // version it loaded or last saved, preserving changes from other tabs.
      if (localStorage.getItem(DOCUMENT_DRAFT_KEY) !== savedVersion.current) {
        if (report) setSaveStatus("Draft changed in another tab — download your edits before reloading");
        return false;
      }
      const serialized = JSON.stringify(latest.current);
      localStorage.setItem(DOCUMENT_DRAFT_KEY, serialized);
      savedVersion.current = serialized;
      pendingChanges.current = false;
      if (report) setSaveStatus("Draft saved on this device");
      return true;
    } catch {
      if (report) setSaveStatus("Autosave unavailable — download to keep your work");
      return false;
    }
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(DOCUMENT_DRAFT_KEY);
      savedVersion.current = saved;
      if (saved) {
        const value = JSON.parse(saved);
        if (value?.version !== 1 || typeof value.title !== "string" || typeof value.html !== "string") {
          throw new Error("Invalid draft");
        }
        const restored: Draft = { version: 1, title: value.title, html: sanitizeDocumentHtml(value.html) };
        latest.current = restored;
        setDraft(restored);
        if (editor.current) {
          editor.current.innerHTML = restored.html;
          setText(editor.current.innerText);
        }
      }
      setSaveStatus(saved ? "Draft saved on this device" : "No draft saved yet");
    } catch {
      setNotice("Couldn’t restore a local draft. You can still write and download your document.");
      setSaveStatus("Autosave unavailable — download to keep your work");
    }
    setReady(true);

    // Flush pending edits on navigation, tab close, or the page going inactive.
    const flush = () => saveDraft();
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!flush()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const onHidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    const onStorage = (event: StorageEvent) => {
      if ((event.key === DOCUMENT_DRAFT_KEY || event.key === null) && event.newValue !== savedVersion.current) {
        setSaveStatus("Draft changed in another tab — download your edits before reloading");
      }
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("storage", onStorage);
    return () => {
      saveDraft(false);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("storage", onStorage);
    };
  }, [saveDraft]);

  useEffect(() => {
    if (!ready) return;
    const timeout = window.setTimeout(() => saveDraft(), 400);
    return () => window.clearTimeout(timeout);
  }, [draft, ready, saveDraft]);

  useEffect(() => {
    const onSelection = () => {
      const current = window.getSelection();
      if (!current?.rangeCount || !editor.current?.contains(current.anchorNode) || !editor.current.contains(current.focusNode)) return;
      selection.current = current.getRangeAt(0).cloneRange();
      setActiveFormats(formats.filter(({ command }) => document.queryCommandState(command)).map(({ command }) => command));
      const value = String(document.queryCommandValue("formatBlock")).toLowerCase();
      setBlock(["h1", "h2", "h3", "blockquote"].includes(value) ? value : "p");
    };
    document.addEventListener("selectionchange", onSelection);
    return () => document.removeEventListener("selectionchange", onSelection);
  }, []);

  function update(next: Draft) {
    if (next.title === latest.current.title && next.html === latest.current.html) return;
    latest.current = next;
    pendingChanges.current = true;
    setDraft(next);
    setSaveStatus("Saving…");
  }

  function syncContent() {
    if (!editor.current) return;
    setText(editor.current.innerText);
    update({ ...latest.current, html: editor.current.innerHTML });
  }

  function command(name: string, value?: string) {
    if (!editor.current) return;
    const current = window.getSelection();
    // A paste can arrive before selectionchange updates the saved toolbar range.
    // Prefer the live selection, capturing it before focus can move the caret.
    const range = current?.rangeCount && editor.current.contains(current.anchorNode) && editor.current.contains(current.focusNode)
      ? current.getRangeAt(0).cloneRange()
      : selection.current;
    editor.current.focus();
    if (range && editor.current.contains(range.commonAncestorContainer)) {
      current?.removeAllRanges();
      current?.addRange(range);
    }
    // Native editing commands retain the browser's undo history. Keep this
    // compatibility boundary small so it can be replaced independently.
    const succeeded = document.execCommand(name, false, value);
    if (!succeeded && !["undo", "redo"].includes(name)) {
      setNotice("Your browser couldn’t apply that format. Try selecting text first.");
    } else {
      setNotice("");
    }
    syncContent();
  }

  function replaceDocument(next: Draft) {
    selection.current = null;
    if (editor.current) {
      editor.current.innerHTML = next.html;
      setText(editor.current.innerText);
    }
    setActiveFormats([]);
    setBlock("p");
    update(next);
    editor.current?.focus();
  }

  function canReplace() {
    return (!text.trim() && latest.current.title === emptyDraft.title) ||
      window.confirm("Replace this draft? Download it first if you want to keep a copy.");
  }

  async function openFile(file: File) {
    if (!/\.(txt|html?)$/i.test(file.name)) {
      setNotice("Open a .txt or .html file. Word and PDF files aren’t supported by this editor.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setNotice("Choose a document smaller than 2 MB.");
      return;
    }
    try {
      const content = await file.text();
      const html = /\.html?$/i.test(file.name) ? sanitizeDocumentHtml(content) : textToDocumentHtml(content);
      if (!canReplace()) return;
      replaceDocument({ version: 1, title: file.name.replace(/\.(txt|html?)$/i, ""), html });
      setNotice("Document opened. HTML imports keep basic text formatting; images, links, and embedded content are removed.");
    } catch {
      setNotice("Couldn’t open that file. Your current draft is still here.");
    }
  }

  function download(format: "html" | "txt") {
    const title = latest.current.title;
    const html = editor.current?.innerHTML || "";
    downloadText(
      format === "html" ? exportDocumentHtml(title, html) : editor.current?.innerText || "",
      `${documentFilename(title)}.${format}`,
      `${format === "html" ? "text/html" : "text/plain"};charset=utf-8`,
    );
    setNotice(`Downloaded ${format === "html" ? "a formatted HTML document" : "plain text"}.`);
  }

  function paste(event: ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    // Paste text only, so clipboard markup cannot add scripts or remote media.
    command("insertText", event.clipboardData.getData("text/plain"));
  }

  return (
    <section className="workspace-panel document-workspace" aria-label="Document workspace">
      <div className="document-topbar">
        <label className="field-label document-name">
          Document name
          <input value={draft.title} maxLength={160} disabled={!ready}
            onChange={(event) => update({ ...latest.current, title: event.target.value })} />
        </label>
        <div className="editor-actions">
          <button className="quiet-button" disabled={!ready} onClick={() => {
            if (canReplace()) { replaceDocument(emptyDraft); setNotice("New document ready."); }
          }}>New document</button>
          <button className="secondary-button" disabled={!ready} onClick={() => fileInput.current?.click()}>Open file</button>
          <input ref={fileInput} type="file" accept=".txt,.html,.htm,text/plain,text/html" className="sr-only" tabIndex={-1} aria-label="Open document file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void openFile(file);
            }} />
        </div>
      </div>

      <div className="document-toolbar" role="group" aria-label="Document formatting">
        <label className="inline-label">
          <span className="sr-only">Paragraph style</span>
          <select aria-label="Paragraph style" value={block} disabled={!ready} onChange={(event) => {
            command("formatBlock", event.target.value);
            setBlock(event.target.value);
          }}>
            <option value="p">Normal text</option><option value="h1">Heading 1</option>
            <option value="h2">Heading 2</option><option value="h3">Heading 3</option>
            <option value="blockquote">Quote</option>
          </select>
        </label>
        {formats.map(({ command: name, label, text: caption }) => (
          <button key={name} className={`document-format format-${name}`} type="button" disabled={!ready}
            title={label} aria-label={label} aria-pressed={activeFormats.includes(name)}
            onMouseDown={(event) => event.preventDefault()} onClick={() => command(name)}>{caption}</button>
        ))}
        <span className="document-toolbar-divider" aria-hidden="true" />
        {[["undo", "Undo", "↶"], ["redo", "Redo", "↷"], ["removeFormat", "Clear formatting", "Clear format"]].map(([name, label, caption]) => (
          <button key={name} className="document-format" type="button" disabled={!ready}
            title={label} aria-label={label} onMouseDown={(event) => event.preventDefault()} onClick={() => command(name)}>{caption}</button>
        ))}
      </div>

      <div className="document-paper">
        <div ref={editor} className="document-content" contentEditable={ready} suppressContentEditableWarning
          role="textbox" aria-label="Document body" aria-multiline="true" aria-describedby="document-help"
          data-placeholder="Start with a thought. Make it your own…" spellCheck
          onInput={syncContent} onPaste={paste} onDrop={(event) => event.preventDefault()}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
              event.preventDefault(); download("html");
            }
          }} />
      </div>

      <div className="document-status">
        <span>{stats.words.toLocaleString()} {stats.words === 1 ? "word" : "words"} · {stats.characters.toLocaleString()} characters</span>
        <span role="status">{saveStatus}</span>
      </div>
      <div className="editor-footer">
        <p className="field-hint" id="document-help">One draft is saved in this browser. Paste adds plain text.<br />Download a copy to keep it beyond this device.</p>
        <div className="editor-actions">
          <button className="quiet-button" disabled={!ready} onClick={() => window.print()}>Print / PDF</button>
          <button className="secondary-button" disabled={!ready} onClick={() => download("txt")}>Download .txt</button>
          <button className="primary-button" disabled={!ready} onClick={() => download("html")}>Download .html</button>
        </div>
      </div>
      <p className="tool-message" role="status">{notice}</p>
    </section>
  );
}
