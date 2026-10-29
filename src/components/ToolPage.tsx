import Link from "next/link";
import type { ReactNode } from "react";
import { tools } from "../lib/tools";
import { ToolIcon } from "./ToolIcon";

export function ToolPage({
  slug,
  compact = false,
  showDescription = true,
  children,
}: {
  slug: string;
  compact?: boolean;
  showDescription?: boolean;
  children: ReactNode;
}) {
  const tool = tools.find((item) => item.slug === slug)!;
  return (
    <main
      className={`tool-page tool-${tool.accent}${compact ? " tool-page-compact" : ""}`}
      id="main-content"
    >
      {compact ? (
        <div className="tool-page-heading tool-page-heading-compact">
          <span className="tool-icon">
            <ToolIcon name={tool.icon} />
          </span>
          <div className="tool-page-title">
            <h1>{tool.name}</h1>
            {showDescription && <p>{tool.description}</p>}
          </div>
          <Link href="/" className="back-to-tools">
            ← All tools
          </Link>
        </div>
      ) : (
        <>
          <Link href="/" className="back-to-tools">
            ← All tools
          </Link>
          <div className="tool-page-heading">
            <span className="tool-icon">
              <ToolIcon name={tool.icon} />
            </span>
            <div>
              <p className="eyebrow">{tool.category}</p>
              <h1>{tool.name}</h1>
              {showDescription && <p>{tool.description}</p>}
            </div>
          </div>
        </>
      )}
      {children}
      <p className="tool-local-note">
        <ToolIcon name="shield" /> Processed in your browser. Your content stays
        on your device.
      </p>
      <nav className="more-tools" aria-label="More tools">
        <span>Something else on your list?</span>
        {tools
          .filter((item) => item.slug !== slug)
          .map((item) => (
            <Link key={item.slug} href={item.href}>
              {item.name} <span aria-hidden="true">↗</span>
            </Link>
          ))}
      </nav>
    </main>
  );
}
