"use client";

import { useState } from "react";
import { downloadText, getTextStats } from "../lib/toolUtils";

export function TextTool() {
  const [text, setText] = useState("");
  const [notice, setNotice] = useState("");
  const stats = getTextStats(text);
  const edit = (value: string) => {
    setText(value);
    setNotice("");
  };
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setNotice("Copied to clipboard.");
    } catch {
      setNotice(
        "Couldn’t access the clipboard. Select the text to copy it, or download a file.",
      );
    }
  }
  return (
    <section className="workspace-panel text-workspace">
      <div className="stats-grid">
        {Object.entries(stats).map(([label, count]) => (
          <div key={label}>
            <strong>{count.toLocaleString()}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <label className="field-label">
        Your text
        <textarea
          className="text-editor"
          rows={12}
          placeholder="Paste your text here. Let’s give it a little polish."
          value={text}
          onChange={(event) => edit(event.target.value)}
        />
      </label>
      <div
        className="text-transform-actions"
        role="group"
        aria-label="Text transformations"
      >
        <button
          className="secondary-button"
          disabled={!text}
          onClick={() => edit(text.toUpperCase())}
        >
          UPPERCASE
        </button>
        <button
          className="secondary-button"
          disabled={!text}
          onClick={() => edit(text.toLowerCase())}
        >
          lowercase
        </button>
        <button
          className="secondary-button"
          disabled={!text}
          onClick={() =>
            edit(
              text
                .toLowerCase()
                .replace(/(^|[^\p{L}\p{N}’'])[\p{L}]/gu, (letter) =>
                  letter.toUpperCase(),
                ),
            )
          }
        >
          Title Case
        </button>
        <button
          className="secondary-button"
          disabled={!text}
          onClick={() =>
            edit(
              text
                .split("\n")
                .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
                .join("\n")
                .replace(/\n{3,}/g, "\n\n")
                .trim(),
            )
          }
        >
          Clean up spaces
        </button>
      </div>
      <div className="editor-footer">
        <p className="field-hint">
          Word counts use spaces between words. Characters include spaces.
        </p>
        <div className="editor-actions">
          <button
            className="quiet-button"
            disabled={!text}
            onClick={() => edit("")}
          >
            Clear
          </button>
          <button
            className="secondary-button"
            disabled={!text}
            onClick={() =>
              downloadText(text, "text.txt", "text/plain;charset=utf-8")
            }
          >
            Download .txt
          </button>
          <button className="primary-button" disabled={!text} onClick={copy}>
            Copy text
          </button>
        </div>
      </div>
      <p className="tool-message" role="status">
        {notice}
      </p>
    </section>
  );
}
