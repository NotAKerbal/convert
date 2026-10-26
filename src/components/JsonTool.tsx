"use client";

import { useState } from "react";
import { downloadText } from "../lib/toolUtils";

const example =
  '{"hello":"world","tools":["convert","create","simplify"],"local":true}';

export function JsonTool() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [indent, setIndent] = useState(2);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [outputLabel, setOutputLabel] = useState("Formatted output");
  function edit(value: string) {
    setInput(value);
    setOutput("");
    setError("");
    setNotice("");
  }
  function format(minify: boolean) {
    try {
      const parsed: unknown = JSON.parse(input);
      setOutput(JSON.stringify(parsed, null, minify ? undefined : indent));
      setOutputLabel(minify ? "Minified output" : "Formatted output");
      setError("");
      setNotice("Valid JSON. Ready to use.");
    } catch (failure) {
      setOutput("");
      setNotice("");
      setError(
        failure instanceof Error
          ? failure.message
          : "This isn’t valid JSON. Check the syntax and try again.",
      );
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(output);
      setNotice("Copied to clipboard.");
    } catch {
      setNotice(
        "Couldn’t access the clipboard. Select the output to copy it, or download a file.",
      );
    }
  }
  return (
    <section className="workspace-panel json-workspace">
      <div className="json-toolbar">
        <div className="editor-actions">
          <button
            className="primary-button"
            disabled={!input.trim()}
            onClick={() => format(false)}
          >
            Format JSON
          </button>
          <button
            className="secondary-button"
            disabled={!input.trim()}
            onClick={() => format(true)}
          >
            Minify
          </button>
          <label className="inline-label">
            Indent
            <select
              value={indent}
              onChange={(event) => {
                setIndent(Number(event.target.value));
                setOutput("");
                setNotice("");
              }}
            >
              <option value={2}>2 spaces</option>
              <option value={4}>4 spaces</option>
            </select>
          </label>
        </div>
        <button className="quiet-button" onClick={() => edit(example)}>
          Load example
        </button>
      </div>
      <div className="json-editors">
        <label className="field-label">
          JSON input
          <textarea
            className="code-editor"
            rows={17}
            spellCheck={false}
            placeholder={'{\n  "something": "useful"\n}'}
            value={input}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "json-error" : undefined}
            onChange={(event) => edit(event.target.value)}
          />
        </label>
        <label className="field-label">
          {outputLabel}
          <textarea
            className="code-editor"
            rows={17}
            spellCheck={false}
            readOnly
            value={output}
            placeholder="Your formatted JSON will appear here."
          />
        </label>
      </div>
      {error && (
        <p id="json-error" className="tool-message error-message" role="alert">
          {error}
        </p>
      )}
      <div className="editor-footer">
        <p className="field-hint">
          Validate and format without sending your data anywhere.
          <br />
          For exact large integers, wrap values in quotes before formatting.
        </p>
        <div className="editor-actions">
          <button
            className="quiet-button"
            disabled={!input}
            onClick={() => edit("")}
          >
            Clear
          </button>
          <button
            className="secondary-button"
            disabled={!output}
            onClick={() =>
              downloadText(output, "formatted.json", "application/json")
            }
          >
            Download .json
          </button>
          <button className="primary-button" disabled={!output} onClick={copy}>
            Copy output
          </button>
        </div>
      </div>
      <p className="tool-message" role="status">
        {notice}
      </p>
    </section>
  );
}
