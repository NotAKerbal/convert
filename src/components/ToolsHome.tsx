"use client";

import Link from "next/link";
import { useState } from "react";
import { tools, type ToolCategory } from "../lib/tools";
import { ToolIcon } from "./ToolIcon";

const categories = ["All tools", "Files", "Create", "Text & code"] as const;

export function ToolsHome() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<ToolCategory | "All tools">(
    "All tools",
  );
  const query = search.trim().toLowerCase();
  const visibleTools = tools.filter(
    (tool) =>
      (category === "All tools" || tool.category === category) &&
      `${tool.name} ${tool.description} ${tool.keywords}`
        .toLowerCase()
        .includes(query),
  );

  return (
    <main className="hub-page" id="main-content">
      <section
        className="tools-section"
        id="tools"
        aria-labelledby="tools-title"
      >
        <div className="directory-heading">
          <h1 id="tools-title">Tools</h1>
          <span className="tool-count">{tools.length} tools</span>
        </div>
        <div className="directory-controls">
          <div
            className="category-filters"
            role="group"
            aria-label="Tool category"
          >
            {categories.map((item) => (
              <button
                key={item}
                className={category === item ? "selected" : ""}
                aria-pressed={category === item}
                onClick={() => setCategory(item)}
              >
                {item}
              </button>
            ))}
          </div>
          <label className="tool-search">
            <ToolIcon name="search" />
            <input
              type="search"
              aria-label="Search tools"
              placeholder="Find a tool…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <kbd aria-hidden="true">⌕</kbd>
          </label>
        </div>

        <div className="tools-grid">
          {visibleTools.map((tool) => (
            <Link
              href={tool.href}
              key={tool.slug}
              className={`tool-card tool-${tool.accent}${tool.icon === "convert" || tool.icon === "qr" ? " featured-tool" : ""}`}
            >
              <div className="tool-card-top">
                <span className="tool-icon">
                  <ToolIcon name={tool.icon} />
                </span>
                <span className="tool-category">{tool.category}</span>
                <span className="tool-card-arrow">
                  <ToolIcon name="arrow" />
                </span>
              </div>
              {tool.icon === "convert" && (
                <div className="conversion-art" aria-hidden="true">
                  <span className="file-art file-art-input">
                    <small>IMG</small>
                    <strong>JPG</strong>
                    <span />
                  </span>
                  <span className="art-transfer">
                    <ToolIcon name="convert" />
                  </span>
                  <span className="file-art file-art-output">
                    <small>READY TO GO</small>
                    <strong>PNG</strong>
                    <span />
                  </span>
                  <i className="art-dot dot-one" />
                  <i className="art-dot dot-two" />
                </div>
              )}
              {tool.icon === "qr" && (
                <div className="qr-art" aria-hidden="true">
                  <div className="qr-art-code">
                    <ToolIcon name="qr" />
                  </div>
                  <span className="scan-caption">
                    a little square.
                    <br />a lot to share.
                  </span>
                  <span className="scan-corner corner-top" />
                  <span className="scan-corner corner-bottom" />
                </div>
              )}
              <div className="tool-card-copy">
                <h3>{tool.name}</h3>
                <p>{tool.description}</p>
              </div>
              <div className="tool-card-bottom">
                <span>{tool.detail}</span>
                <span>
                  Open tool <span aria-hidden="true">↗</span>
                </span>
              </div>
            </Link>
          ))}
        </div>
        {visibleTools.length === 0 && (
          <div className="no-tools" role="status">
            <ToolIcon name="search" />
            <h3>No tools found</h3>
            <p>Try a different search or browse all four tools.</p>
            <button
              className="secondary-button"
              onClick={() => {
                setSearch("");
                setCategory("All tools");
              }}
            >
              Clear filters
            </button>
          </div>
        )}
        <p className="filter-result" role="status" aria-live="polite">
          {query || category !== "All tools"
            ? `${visibleTools.length} tool${visibleTools.length === 1 ? "" : "s"} found`
            : ""}
        </p>
      </section>

      <section className="privacy-strip">
        <span className="privacy-icon">
          <ToolIcon name="shield" />
        </span>
        <div>
          <h2>Your work stays yours.</h2>
          <p>
            Files, text, and QR details are processed in your browser. No
            uploads. No account needed.
          </p>
        </div>
        <span className="privacy-label">
          LOCAL BY DESIGN <span aria-hidden="true">↗</span>
        </span>
      </section>
      <footer className="hub-footer">
        <span>A few good tools. All in one place.</span>
        <span>
          Built on{" "}
          <a
            href="https://github.com/p2r3/convert"
            target="_blank"
            rel="noopener noreferrer"
          >
            p2r3’s converter <span aria-hidden="true">↗</span>
          </a>
        </span>
      </footer>
    </main>
  );
}
