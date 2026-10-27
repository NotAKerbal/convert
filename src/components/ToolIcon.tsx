import type { ToolIconName } from "../lib/tools";

export function ToolIcon({
  name,
  className,
}: {
  name: ToolIconName | "arrow" | "search" | "shield" | "grid";
  className?: string;
}) {
  return (
    <svg
      className={className}
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "convert" && (
        <>
          <path d="M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4" />
        </>
      )}
      {name === "qr" && (
        <>
          <rect x="3" y="3" width="6" height="6" rx="1" />
          <rect x="15" y="3" width="6" height="6" rx="1" />
          <rect x="3" y="15" width="6" height="6" rx="1" />
          <path d="M15 15h3v3h3v3h-6v-3m6-6v2M3 12h3m6-9v3m0 4v5m0 6v-3" />
        </>
      )}
      {name === "text" && (
        <>
          <path d="M3 5h12M9 5v15M5 20h8m2-8h6m-3 0v8m-3 0h6" />
        </>
      )}
      {name === "document" && (
        <>
          <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
          <path d="M14 3v6h6M8 13h8M8 17h6" />
        </>
      )}
      {name === "json" && (
        <>
          <path d="M8 3H6a2 2 0 0 0-2 2v4c0 2-2 3-2 3s2 1 2 3v4a2 2 0 0 0 2 2h2M16 3h2a2 2 0 0 1 2 2v4c0 2 2 3 2 3s-2 1-2 3v4a2 2 0 0 1-2 2h-2" />
          <path d="M10 9h.01M14 15h.01" strokeWidth="3" />
        </>
      )}
      {name === "arrow" && <path d="M5 12h14m-6-6 6 6-6 6" />}
      {name === "search" && (
        <>
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m16 16 5 5" />
        </>
      )}
      {name === "shield" && (
        <>
          <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" />
          <path d="m8 12 3 3 5-6" />
        </>
      )}
      {name === "grid" && (
        <>
          {[3, 14].flatMap((x) =>
            [3, 14].map((y) => (
              <rect
                key={`${x}-${y}`}
                x={x}
                y={y}
                width="7"
                height="7"
                rx="1.5"
              />
            )),
          )}
        </>
      )}
    </svg>
  );
}
