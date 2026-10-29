"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { downloadText } from "../lib/toolUtils";
import {
  batchToCsv,
  categoryGroups,
  convertBatch,
  defaultFormat,
  describeUnit,
  editableValue,
  formatComposite,
  formatMagnitude,
  fromBaseMagnitude,
  getCategory,
  getUnit,
  MAX_BATCH_LINES,
  parseConversionQuery,
  parseNumber,
  popularConversions,
  searchUnits,
  selectionFromSearch,
  selectionToSearch,
  toBaseMagnitude,
  unitCategories,
  unitCount,
  unitSources,
  type CategoryDefinition,
  type FormatOptions,
  type FormattedValue,
  type Magnitude,
  type Notation,
  type UnitDefinition,
} from "../lib/unitConversion";
import { ToolIcon } from "./ToolIcon";

type Favorite = { category: string; from: string; to: string };

const FAVORITES_KEY = "convert-to-it.unit-favorites";
const MAX_FAVORITES = 12;
const BATCH_PREVIEW_ROWS = 300;
const notations: { value: Notation; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "decimal", label: "Decimal" },
  { value: "scientific", label: "Scientific" },
  { value: "engineering", label: "Engineering" },
  { value: "fixed", label: "Fixed decimals" },
];
const significantOptions = [3, 4, 5, 6, 8, 10, 12, 15, 20, 30];
const decimalOptions = [0, 1, 2, 3, 4, 5, 6, 8, 10];

function loadFavorites(): Favorite[] {
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(FAVORITES_KEY) ?? "[]",
    );
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is Favorite =>
          typeof item === "object" &&
          item !== null &&
          typeof item.category === "string" &&
          typeof item.from === "string" &&
          typeof item.to === "string" &&
          !!getUnit(item.category, item.from) &&
          !!getUnit(item.category, item.to),
      )
      .slice(0, MAX_FAVORITES);
  } catch {
    return [];
  }
}

const unitLabel = (unit: UnitDefinition) => `${unit.name} (${unit.symbol})`;
const sameFavorite = (a: Favorite, b: Favorite) =>
  a.category === b.category && a.from === b.from && a.to === b.to;

function UnitSelect({
  label,
  category,
  value,
  onChange,
}: {
  label: string;
  category: CategoryDefinition;
  value: string;
  onChange: (id: string) => void;
}) {
  const groups = [...new Set(category.units.map((unit) => unit.group))];
  return (
    <label className="field-label unit-select">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {groups.map((group) => (
          <optgroup key={group} label={group}>
            {category.units
              .filter((unit) => unit.group === group)
              .map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unitLabel(unit)}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

function SourceLink({ unit }: { unit: UnitDefinition }) {
  const source = unitSources[unit.source];
  return source.url ? (
    <a href={source.url} target="_blank" rel="noopener noreferrer">
      {source.label} <span aria-hidden="true">↗</span>
    </a>
  ) : (
    <span>{source.label}</span>
  );
}

export function UnitConverter() {
  const [categoryId, setCategoryId] = useState("length");
  const [fromId, setFromId] = useState("ft");
  const [toId, setToId] = useState("m");
  const [input, setInput] = useState("1");
  // Keeps an exact value after swapping, while the box shows a rounded copy.
  const [pinned, setPinned] = useState<{ text: string; value: Magnitude } | null>(null);
  const [format, setFormat] = useState<FormatOptions>(defaultFormat);
  const [search, setSearch] = useState("");
  const [quick, setQuick] = useState("");
  const [unitFilter, setUnitFilter] = useState("");
  const [batch, setBatch] = useState("");
  const [notice, setNotice] = useState("");
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [ready, setReady] = useState(false);
  const deferredBatch = useDeferredValue(batch);

  const category = getCategory(categoryId) ?? unitCategories[0];
  const from = category.units.find((unit) => unit.id === fromId) ?? category.units[0];
  const to = category.units.find((unit) => unit.id === toId) ?? category.units[0];
  const current: Favorite = { category: category.id, from: from.id, to: to.id };
  const isFavorite = favorites.some((item) => sameFavorite(item, current));

  useEffect(() => {
    const shared = selectionFromSearch(window.location.search);
    if (shared.category) {
      setCategoryId(shared.category);
      setFromId(shared.from!);
      setToId(shared.to!);
      if (shared.value !== undefined) {
        setInput(shared.value);
        if (shared.retained) setPinned({ text: shared.value, value: shared.retained });
      }
    }
    setFavorites(loadFavorites());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const query = selectionToSearch({ category: category.id, from: from.id, to: to.id, value: input, retained: pinned?.text === input ? pinned.value : undefined });
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${query}`);
  }, [ready, category.id, from.id, to.id, input, pinned]);

  // ----- Main conversion
  const parsed = useMemo(():
    | { ok: true; value: Magnitude }
    | { ok: false; error: string } => {
    if (pinned && pinned.text === input) return { ok: true, value: pinned.value };
    const result = parseNumber(input);
    return result.ok ? { ok: true, value: { value: result.value, exact: true } } : result;
  }, [input, pinned]);
  const base = parsed.ok ? toBaseMagnitude(category, from, parsed.value) : null;
  const converted = base?.ok ? fromBaseMagnitude(to, base.value) : null;
  const inputError = !parsed.ok && input.trim() ? parsed.error : "";
  const conversionError =
    base && !base.ok ? base.error : converted && !converted.ok ? converted.error : "";
  const error = inputError || conversionError;
  const result: FormattedValue | null = converted?.ok ? formatMagnitude(converted.value, format) : null;
  const shownInput = parsed.ok ? formatMagnitude(parsed.value, format).text : input;

  const filter = unitFilter.trim().toLowerCase();
  const allUnits = !base?.ok
    ? []
    : category.units
      .filter(
        (unit) =>
          !filter ||
          [unit.name, unit.symbol, unit.group, ...unit.aliases].some((text) =>
            text.toLowerCase().includes(filter),
          ),
      )
        .map((unit) => {
          const value = fromBaseMagnitude(unit, base.value);
          return { unit, value: value.ok ? formatMagnitude(value.value, format) : null };
        });
  const composites =
    base?.ok && category.composites
      ? category.composites
          .map((ids) =>
            formatComposite(category, ids, base.value, format.notation === "fixed" ? format.precision : 3),
          )
          .filter((item): item is FormattedValue => !!item)
      : [];

  // ----- Typed conversion
  const quickResult = useMemo(
    () => (quick.trim() ? parseConversionQuery(quick, { preferCategory: categoryId }) : null),
    [quick, categoryId],
  );
  const quickPreview = (() => {
    if (!quickResult) return null;
    if (!quickResult.ok) return { error: quickResult.error };
    if (quickResult.kind === "number")
      return { text: `${formatMagnitude({ value: quickResult.value, exact: true }, format).text} ${from.symbol} — press Enter to use this number.` };
    const target =
      quickResult.to ??
      quickResult.category.units.find(
        (unit) =>
          unit.id ===
          (quickResult.category.id === category.id && to.id !== quickResult.from.id
            ? to.id
            : quickResult.from.id === quickResult.category.defaultTo
              ? quickResult.category.defaultFrom
              : quickResult.category.defaultTo),
      )!;
    const targetBase = toBaseMagnitude(quickResult.category, quickResult.from, quickResult.value);
    const value = targetBase.ok ? fromBaseMagnitude(target, targetBase.value) : targetBase;
    if (!value.ok) return { error: value.error };
    const formatted = formatMagnitude(value.value, format);
    return {
      text: `${formatMagnitude(quickResult.value, format).text} ${quickResult.from.symbol} ${formatted.exact ? "=" : "≈"} ${formatted.text} ${target.symbol}`,
      target,
    };
  })();

  // ----- Batch
  const batchResult = useMemo(
    () =>
      deferredBatch.trim()
        ? convertBatch(deferredBatch, { category: category.id, from: from.id, to: to.id }, format)
        : null,
    [deferredBatch, category.id, from.id, to.id, format],
  );
  const batchErrors = batchResult?.rows.filter((row) => !row.ok).length ?? 0;

  const searchResults = useMemo(() => searchUnits(search, 30), [search]);

  // ----- Actions
  function selectCategory(id: string, nextFrom?: string, nextTo?: string) {
    const next = getCategory(id);
    if (!next) return;
    const fromUnit = nextFrom ?? next.defaultFrom;
    let toUnit = nextTo ?? next.defaultTo;
    if (fromUnit === toUnit)
      toUnit = fromUnit === next.defaultTo ? next.defaultFrom : next.defaultTo;
    setPinned(null);
    setCategoryId(next.id);
    setFromId(fromUnit);
    setToId(toUnit);
    setUnitFilter("");
    setNotice("");
  }

  function editInput(value: string) {
    setPinned(null);
    setInput(value);
    setNotice("");
  }

  function swap() {
    setFromId(to.id);
    setToId(from.id);
    if (converted?.ok) {
      const text = editableValue(converted.value);
      setInput(text);
      setPinned({ text, value: converted.value });
    }
    setNotice(`Swapped. ${converted?.ok ? "The quantity is unchanged." : ""}`.trim());
  }

  function applyQuick() {
    if (!quickResult) return;
    if (!quickResult.ok) {
      setNotice("");
      return;
    }
    if (quickResult.kind === "number") {
      editInput(quick.trim());
      setQuick("");
      return;
    }
    const text = editableValue(quickResult.value);
    selectCategory(quickResult.category.id, quickResult.from.id, quickPreview?.target?.id);
    setInput(text);
    setPinned({ text, value: quickResult.value });
    setQuick("");
    setNotice(`Loaded ${quickResult.category.name.toLowerCase()} conversion.`);
  }

  async function copy(text: string, description: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice(`Copied ${description}.`);
    } catch {
      setNotice("Couldn’t access the clipboard. Select the value to copy it instead.");
    }
  }

  function saveFavorites(next: Favorite[]) {
    setFavorites(next);
    try {
      window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
      return true;
    } catch {
      setNotice("Saved for this visit only — your browser blocked local storage.");
      return false;
    }
  }

  function toggleFavorite() {
    if (isFavorite) {
      if (saveFavorites(favorites.filter((item) => !sameFavorite(item, current))))
        setNotice("Removed from saved conversions.");
    } else if (saveFavorites([current, ...favorites].slice(0, MAX_FAVORITES)))
      setNotice("Saved. Find it under Saved conversions.");
  }

  function shareLink() {
    const query = selectionToSearch({ category: category.id, from: from.id, to: to.id, value: input, retained: pinned?.text === input ? pinned.value : undefined });
    void copy(`${window.location.origin}${window.location.pathname}${query}`, "a link to this conversion");
  }

  function setNotation(notation: Notation) {
    setFormat((previous) => ({
      ...previous,
      notation,
      precision:
        notation === "fixed" && previous.notation !== "fixed"
          ? 2
          : notation !== "fixed" && previous.notation === "fixed"
            ? defaultFormat.precision
            : previous.precision,
    }));
  }

  const precisionOptions = format.notation === "fixed" ? decimalOptions : significantOptions;
  const presets = category.presets.filter(([a, b]) => a !== from.id || b !== to.id);

  return (
    <div className="unit-workspace">
      <aside className="workspace-panel unit-sidebar" aria-label="Unit categories">
        <label className="tool-search unit-search">
          <ToolIcon name="search" />
          <input
            type="search"
            aria-label="Search units and categories"
            placeholder="Search 400+ units…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        {search.trim() ? (
          <div className="unit-search-results" aria-live="polite">
            {searchResults.length === 0 && <p className="field-hint">No units match “{search.trim()}”.</p>}
            <ul>
              {searchResults.map((item) => (
                <li key={`${item.category.id}:${item.unit?.id ?? ""}`}>
                  <button
                    className="unit-search-result"
                    onClick={() => {
                      selectCategory(item.category.id, item.unit?.id);
                      setSearch("");
                    }}
                  >
                    <strong>{item.unit ? unitLabel(item.unit) : item.category.name}</strong>
                    <span>{item.unit ? item.category.name : `${item.category.units.length} units`}</span>
                  </button>
                  {item.unit && (
                    <button
                      className="unit-search-target"
                      aria-label={`Convert to ${item.unit.name}`}
                      title="Convert to this unit"
                      onClick={() => {
                        selectCategory(
                          item.category.id,
                          item.category.id === category.id && from.id !== item.unit!.id ? from.id : undefined,
                          item.unit!.id,
                        );
                        setSearch("");
                      }}
                    >
                      to
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <nav className="unit-categories" aria-label="Categories">
            {favorites.length > 0 && (
              <div className="unit-category-group">
                <h2>Saved conversions</h2>
                {favorites.map((item) => {
                  const fromUnit = getUnit(item.category, item.from)!;
                  const toUnit = getUnit(item.category, item.to)!;
                  return (
                    <button
                      key={`${item.category}|${item.from}|${item.to}`}
                      className={sameFavorite(item, current) ? "selected" : ""}
                      onClick={() => selectCategory(item.category, item.from, item.to)}
                    >
                      {fromUnit.symbol} → {toUnit.symbol}
                    </button>
                  );
                })}
              </div>
            )}
            {categoryGroups.map((group) => (
              <div className="unit-category-group" key={group}>
                <h2>{group}</h2>
                {unitCategories
                  .filter((item) => item.group === group)
                  .map((item) => (
                    <button
                      key={item.id}
                      className={item.id === category.id ? "selected" : ""}
                      aria-current={item.id === category.id ? "true" : undefined}
                      onClick={() => selectCategory(item.id)}
                    >
                      <span>{item.name}</span>
                      <small>{item.units.length}</small>
                    </button>
                  ))}
              </div>
            ))}
          </nav>
        )}
      </aside>

      <div className="unit-main">
        <section className="workspace-panel unit-converter-panel" aria-labelledby="unit-category-title">
          <label className="field-label unit-quick">
            Type a conversion
            <span className="unit-quick-row">
              <input
                type="text"
                placeholder="Try 5 ft 3 in to cm, 72 °F in °C, or 100 Mbps to MB/s"
                value={quick}
                aria-describedby="unit-quick-preview"
                aria-invalid={quickPreview && "error" in quickPreview ? true : undefined}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setQuick(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    applyQuick();
                  }
                }}
              />
              <button
                className="secondary-button"
                disabled={!quickResult?.ok}
                onClick={applyQuick}
              >
                Use
              </button>
            </span>
            <span
              id="unit-quick-preview"
              className={`field-hint unit-quick-preview${quickPreview && "error" in quickPreview ? " is-error" : ""}`}
              aria-live="polite"
            >
              {quickPreview
                ? "error" in quickPreview
                  ? quickPreview.error
                  : quickPreview.text
                : null}
            </span>
          </label>

          <div className="unit-heading">
            <h2 id="unit-category-title">{category.name}</h2>
            <label className="field-label unit-category-select">
              Category
              <select value={category.id} onChange={(event) => selectCategory(event.target.value)}>
                {categoryGroups.map((group) => (
                  <optgroup key={group} label={group}>
                    {unitCategories
                      .filter((item) => item.group === group)
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </label>
          </div>

          <div className="unit-converter-row">
            <label className="field-label unit-value">
              Value
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                spellCheck={false}
                value={input}
                aria-invalid={error ? true : undefined}
                aria-describedby="unit-value-message"
                onChange={(event) => editInput(event.target.value)}
              />
            </label>
            <UnitSelect label="From" category={category} value={from.id} onChange={(id) => { setPinned(null); setFromId(id); setNotice(""); }} />
            <button
              className="secondary-button unit-swap"
              onClick={swap}
              aria-label="Swap units"
              title="Swap units (keeps the same quantity)"
            >
              <ToolIcon name="convert" />
            </button>
            <UnitSelect label="To" category={category} value={to.id} onChange={(id) => { setToId(id); setNotice(""); }} />
          </div>
          <p
            id="unit-value-message"
            className={error ? "error-message unit-error" : "field-hint"}
            role={error ? "alert" : undefined}
          >
            {error ||
              (pinned ? "Full precision is retained behind this display value and in shared links. Editing the value uses your new input." : "Use decimals, 3/4, 1 1/2, 1,234.5, or 6.02e23. Commas group thousands.")}
          </p>

          <div className="unit-result" aria-live="polite">
            {result ? (
              <>
                <p className="unit-result-equation">
                  <span className="unit-result-from">
                    {shownInput} {from.symbol} {result.exact ? "=" : "≈"}
                  </span>
                  <output className="unit-result-value" aria-label="Result">
                    {result.text} <span>{to.symbol}</span>
                  </output>
                </p>
                <p className="unit-result-meta">
                  <span className={`unit-badge${result.exact ? " is-exact" : ""}`}>
                    {result.exact ? "Exact" : "Rounded"}
                  </span>
                  {to.name}
                </p>
              </>
            ) : (
              <p className="unit-result-empty">{error ? "No result" : "Enter a value to convert."}</p>
            )}
            <div className="editor-actions unit-result-actions">
              <button
                className="primary-button"
                disabled={!result}
                onClick={() => result && copy(result.plain, "the result")}
              >
                Copy result
              </button>
              <button
                className="secondary-button"
                disabled={!result}
                onClick={() => result && copy(`${result.plain} ${to.symbol}`, "the result with its unit")}
              >
                Copy with unit
              </button>
              <button
                className="secondary-button"
                aria-pressed={isFavorite}
                onClick={toggleFavorite}
              >
                {isFavorite ? "★ Saved" : "☆ Save"}
              </button>
              <button className="quiet-button" onClick={shareLink}>
                Copy link
              </button>
            </div>
          </div>
          <p className="tool-message" role="status">
            {notice}
          </p>

          <div className="unit-options">
            <label className="inline-label">
              Notation
              <select value={format.notation} onChange={(event) => setNotation(event.target.value as Notation)}>
                {notations.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="inline-label">
              {format.notation === "fixed" ? "Decimal places" : "Significant figures"}
              <select
                value={format.precision}
                onChange={(event) =>
                  setFormat((previous) => ({ ...previous, precision: Number(event.target.value) }))
                }
              >
                {(precisionOptions.includes(format.precision)
                  ? precisionOptions
                  : [...precisionOptions, format.precision].sort((a, b) => a - b)
                ).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={format.grouping}
                onChange={(event) =>
                  setFormat((previous) => ({ ...previous, grouping: event.target.checked }))
                }
              />
              Group digits
            </label>
          </div>

          <div className="unit-presets" role="group" aria-label="Quick picks">
            <span>Quick picks</span>
            {presets.map(([a, b]) => {
              const fromUnit = getUnit(category.id, a)!;
              const toUnit = getUnit(category.id, b)!;
              return (
                <button key={`${a}-${b}`} onClick={() => selectCategory(category.id, a, b)}>
                  {fromUnit.symbol} → {toUnit.symbol}
                </button>
              );
            })}
            {popularConversions
              .filter((item) => item.category !== category.id)
              .slice(0, 5)
              .map((item) => {
                const fromUnit = getUnit(item.category, item.from)!;
                const toUnit = getUnit(item.category, item.to)!;
                return (
                  <button
                    key={`${item.category}-${item.from}-${item.to}`}
                    className="unit-popular"
                    onClick={() => selectCategory(item.category, item.from, item.to)}
                  >
                    {fromUnit.symbol} → {toUnit.symbol}
                  </button>
                );
              })}
          </div>
        </section>

        <section className="workspace-panel unit-all" aria-labelledby="unit-all-title">
          <div className="unit-section-heading">
            <h2 id="unit-all-title">
              {parsed.ok && base?.ok ? `${shownInput} ${from.symbol} in every ${category.name.toLowerCase()} unit` : `Every ${category.name.toLowerCase()} unit`}
            </h2>
            <label className="tool-search unit-filter">
              <ToolIcon name="search" />
              <input
                type="search"
                aria-label="Filter units"
                placeholder="Filter units…"
                value={unitFilter}
                onChange={(event) => setUnitFilter(event.target.value)}
              />
            </label>
          </div>
          {composites.length > 0 && (
            <ul className="unit-composites" aria-label="Mixed units">
              {composites.map((item) => (
                <li key={item.text}>
                  <span>{item.exact ? "=" : "≈"} {item.text}</span>
                  <button className="quiet-button" onClick={() => copy(item.plain, item.plain)}>
                    Copy
                  </button>
                </li>
              ))}
            </ul>
          )}
          {base?.ok ? (
            <div className="unit-table-wrap">
              <table className="unit-table">
                <thead>
                  <tr>
                    <th scope="col">Unit</th>
                    <th scope="col">Value</th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {allUnits.map(({ unit, value }) => (
                    <tr key={unit.id} className={unit.id === to.id ? "is-target" : unit.id === from.id ? "is-source" : ""}>
                      <th scope="row">
                        <button
                          className="unit-row-name"
                          onClick={() => {
                            if (unit.id === from.id) return;
                            setToId(unit.id);
                            setNotice(`Converting to ${unit.name}.`);
                          }}
                          title={unit.id === from.id ? "Current input unit" : "Convert to this unit"}
                        >
                          <span>{unit.name}</span>
                          <small>{unit.symbol} · {unit.group}</small>
                        </button>
                      </th>
                      <td className="unit-row-value">
                        {value ? (
                          <>
                            <span className="unit-approx">{value.exact ? "" : "≈ "}</span>
                            {value.text}
                          </>
                        ) : (
                          <span className="field-hint">—</span>
                        )}
                      </td>
                      <td className="unit-row-action">
                        <button
                          className="quiet-button"
                          disabled={!value}
                          aria-label={`Copy value in ${unit.name}`}
                          onClick={() => value && copy(value.plain, `the value in ${unit.symbol}`)}
                        >
                          Copy
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {allUnits.length === 0 && <p className="field-hint">No units match that filter.</p>}
            </div>
          ) : (
            <p className="field-hint">Enter a valid value above to see it in every unit.</p>
          )}
        </section>

        <section className="workspace-panel unit-batch" aria-labelledby="unit-batch-title">
          <div className="unit-section-heading">
            <h2 id="unit-batch-title">Batch convert</h2>
            <span className="field-hint">
              {from.symbol} → {to.symbol} · up to {MAX_BATCH_LINES.toLocaleString()} lines
            </span>
          </div>
          <label className="field-label">
            One value per line
            <textarea
              className="code-editor unit-batch-input"
              rows={6}
              spellCheck={false}
              placeholder={`1\n2.5\n3/4\n5 ft 3 in\n12 psi to kPa`}
              value={batch}
              onChange={(event) => setBatch(event.target.value)}
            />
          </label>
          <p className="field-hint">
            Plain numbers use the selected units. Lines with their own units, like “12 psi to kPa”, convert on their own.
          </p>
          {batchResult && (
            <>
              <p className="unit-batch-summary" role="status">
                {batchResult.rows.length.toLocaleString()} line{batchResult.rows.length === 1 ? "" : "s"}
                {batchErrors ? ` · ${batchErrors} need${batchErrors === 1 ? "s" : ""} attention` : " converted"}
                {batchResult.truncated ? ` · only the first ${MAX_BATCH_LINES.toLocaleString()} lines were converted` : ""}
              </p>
              <div className="unit-table-wrap unit-batch-results">
                <table className="unit-table">
                  <thead>
                    <tr>
                      <th scope="col">Line</th>
                      <th scope="col">Input</th>
                      <th scope="col">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batchResult.rows.slice(0, BATCH_PREVIEW_ROWS).map((row) => (
                      <tr key={row.line} className={row.ok ? "" : "is-error"}>
                        <td>{row.line}</td>
                        <td className="unit-batch-cell">{row.input}</td>
                        <td className="unit-batch-cell">
                          {row.ok && row.result && row.to ? (
                            `${row.result.exact ? "" : "≈ "}${row.result.text} ${row.to.symbol}`
                          ) : (
                            <span className="unit-error-text">{row.error}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {batchResult.rows.length > BATCH_PREVIEW_ROWS && (
                <p className="field-hint">
                  Showing the first {BATCH_PREVIEW_ROWS} rows. The CSV includes all of them.
                </p>
              )}
            </>
          )}
          <div className="editor-actions">
            <button className="quiet-button" disabled={!batch} onClick={() => setBatch("")}>
              Clear
            </button>
            <button
              className="secondary-button"
              disabled={!batchResult?.rows.length}
              onClick={() =>
                batchResult &&
                copy(
                  batchResult.rows
                    .map((row) =>
                      row.ok && row.result && row.to
                        ? `${row.input}\t${row.result.plain} ${row.to.symbol}`
                        : `${row.input}\t${row.error}`,
                    )
                    .join("\n"),
                  "the batch results",
                )
              }
            >
              Copy results
            </button>
            <button
              className="primary-button"
              disabled={!batchResult?.rows.length}
              onClick={() => {
                if (!batchResult) return;
                downloadText(batchToCsv(batchResult.rows), "unit-conversions.csv", "text/csv;charset=utf-8");
                setNotice("Downloaded unit-conversions.csv.");
              }}
            >
              Download CSV
            </button>
          </div>
        </section>

        <section className="workspace-panel unit-method" aria-labelledby="unit-method-title">
          <h2 id="unit-method-title">How this is calculated</h2>
          <p className="field-hint">{category.description}</p>
          <dl className="unit-definitions">
            {[from, ...(to.id === from.id ? [] : [to])].map((unit) => (
              <div key={unit.id}>
                <dt>{unitLabel(unit)}</dt>
                <dd>
                  {describeUnit(category, unit)}
                  {unit.note ? ` ${unit.note}` : ""}
                  <br />
                  <small>
                    Source: <SourceLink unit={unit} />
                  </small>
                </dd>
              </div>
            ))}
          </dl>
          {category.notes.length > 0 && (
            <ul className="unit-notes">
              {category.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
          <p className="field-hint">
            Calculations use exact fractions of each unit’s published definition, so results are only rounded for display.
            Units defined through π are marked approximate. Currency, screen pixels, and cup-to-gram cooking conversions
            are left out on purpose: they depend on exchange rates, display density, or ingredient density.
          </p>
          <details className="unit-sources">
            <summary>
              All references · {unitCategories.length} categories, {unitCount()} units
            </summary>
            <ul>
              {Object.values(unitSources).map((source) => (
                <li key={source.label}>
                  {source.url ? (
                    <a href={source.url} target="_blank" rel="noopener noreferrer">
                      {source.label} <span aria-hidden="true">↗</span>
                    </a>
                  ) : (
                    source.label
                  )}
                </li>
              ))}
            </ul>
          </details>
        </section>
      </div>
    </div>
  );
}
