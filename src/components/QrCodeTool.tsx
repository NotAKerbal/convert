"use client";

import { useEffect, useState } from "react";
import type { QRCodeErrorCorrectionLevel } from "qrcode";
import {
  buildQrPayload,
  downloadText,
  downloadUrl,
  type QrMode,
} from "../lib/toolUtils";
import { ToolIcon } from "./ToolIcon";

const modes: { value: QrMode; label: string }[] = [
  { value: "url", label: "Website" },
  { value: "text", label: "Text" },
  { value: "wifi", label: "Wi-Fi" },
  { value: "email", label: "Email" },
];
const colors = [
  { value: "#171717", name: "Ink" },
  { value: "#164e3a", name: "Forest" },
  { value: "#1e3a5f", name: "Navy" },
  { value: "#6b305b", name: "Plum" },
];

export function QrCodeTool() {
  const [mode, setMode] = useState<QrMode>("url");
  const [fields, setFields] = useState({
    url: "",
    text: "",
    ssid: "",
    password: "",
    security: "WPA",
    hidden: false,
    email: "",
    subject: "",
    message: "",
  });
  const [size, setSize] = useState(512);
  const [color, setColor] = useState(colors[0].value);
  const [correction, setCorrection] = useState<QRCodeErrorCorrectionLevel>("M");
  const [result, setResult] = useState<{
    key: string;
    png?: string;
    svg?: string;
    error?: string;
  } | null>(null);
  const payload = buildQrPayload(mode, fields);
  const key = JSON.stringify([payload.value, size, color, correction]);
  const current = result?.key === key ? result : null;
  const error = payload.error || current?.error;
  const update = (field: keyof typeof fields, value: string | boolean) =>
    setFields((previous) => ({ ...previous, [field]: value }));

  useEffect(() => {
    if (!payload.value || payload.error) return;
    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      try {
        const QRCode = await import("qrcode");
        const options = {
          width: size,
          margin: 4,
          color: { dark: color, light: "#ffffff" },
          errorCorrectionLevel: correction,
        };
        const [png, svg] = await Promise.all([
          QRCode.toDataURL(payload.value, options),
          QRCode.toString(payload.value, { ...options, type: "svg" }),
        ]);
        if (!cancelled) setResult({ key, png, svg });
      } catch {
        if (!cancelled)
          setResult({
            key,
            error:
              "This content is too long for a QR code at this correction level. Shorten it or choose a lower level.",
          });
      }
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [payload.value, payload.error, size, color, correction, key]);

  return (
    <div className="qr-workspace">
      <section
        className="workspace-panel qr-controls"
        aria-label="QR code settings"
      >
        <div className="panel-heading">
          <span className="step-number">01</span>
          <h2>Make it yours</h2>
        </div>
        <div
          className="segmented-control"
          role="group"
          aria-label="QR content type"
        >
          {modes.map((item) => (
            <button
              key={item.value}
              aria-pressed={mode === item.value}
              className={mode === item.value ? "selected" : ""}
              onClick={() => setMode(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {mode === "url" && (
          <label className="field-label">
            Website URL
            <input
              type="url"
              placeholder="https://example.com"
              value={fields.url}
              onChange={(event) => update("url", event.target.value)}
              aria-invalid={Boolean(payload.error)}
              aria-describedby={payload.error ? "qr-error" : "qr-url-hint"}
            />
            <span className="field-hint" id="qr-url-hint">
              A shortcut to anywhere on the web.
            </span>
          </label>
        )}
        {mode === "text" && (
          <label className="field-label">
            Your text
            <textarea
              rows={5}
              placeholder="A message, a note, a little something to share…"
              value={fields.text}
              onChange={(event) => update("text", event.target.value)}
            />
          </label>
        )}
        {mode === "wifi" && (
          <div className="field-stack">
            <label className="field-label">
              Network name (SSID)
              <input
                value={fields.ssid}
                onChange={(event) => update("ssid", event.target.value)}
                placeholder="Your Wi-Fi network"
                autoComplete="off"
              />
            </label>
            <label className="field-label">
              Security
              <select
                value={fields.security}
                onChange={(event) => update("security", event.target.value)}
              >
                <option value="WPA">WPA / WPA2 / WPA3</option>
                <option value="WEP">WEP</option>
                <option value="nopass">Open network</option>
              </select>
            </label>
            {fields.security !== "nopass" && (
              <label className="field-label">
                Password
                <input
                  type="password"
                  value={fields.password}
                  onChange={(event) => update("password", event.target.value)}
                  autoComplete="off"
                  placeholder="Network password"
                />
              </label>
            )}
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={fields.hidden}
                onChange={(event) => update("hidden", event.target.checked)}
              />{" "}
              Hidden network
            </label>
          </div>
        )}
        {mode === "email" && (
          <div className="field-stack">
            <label className="field-label">
              Email address
              <input
                type="email"
                value={fields.email}
                onChange={(event) => update("email", event.target.value)}
                placeholder="hello@example.com"
                aria-invalid={Boolean(payload.error)}
                aria-describedby={payload.error ? "qr-error" : undefined}
              />
            </label>
            <label className="field-label">
              Subject (optional)
              <input
                value={fields.subject}
                onChange={(event) => update("subject", event.target.value)}
                placeholder="Say hello"
              />
            </label>
            <label className="field-label">
              Message (optional)
              <textarea
                rows={3}
                value={fields.message}
                onChange={(event) => update("message", event.target.value)}
              />
            </label>
          </div>
        )}
        <div className="qr-options">
          <fieldset className="color-field">
            <legend>Code color</legend>
            <div className="color-swatches">
              {colors.map((item) => (
                <button
                  key={item.value}
                  aria-label={item.name}
                  aria-pressed={color === item.value}
                  onClick={() => setColor(item.value)}
                  className={color === item.value ? "selected" : ""}
                  style={{ backgroundColor: item.value }}
                >
                  {color === item.value ? "✓" : ""}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="field-label">
            PNG size
            <select
              value={size}
              onChange={(event) => setSize(Number(event.target.value))}
            >
              <option value={256}>256 × 256 px</option>
              <option value={512}>512 × 512 px</option>
              <option value={1024}>1024 × 1024 px</option>
            </select>
          </label>
        </div>
        <label className="field-label">
          Error correction
          <select
            value={correction}
            onChange={(event) =>
              setCorrection(event.target.value as QRCodeErrorCorrectionLevel)
            }
          >
            <option value="L">Low — simplest code</option>
            <option value="M">Medium — everyday use</option>
            <option value="Q">Quartile — extra resilience</option>
            <option value="H">High — best for print</option>
          </select>
          <span className="field-hint">
            Higher correction helps a code stay readable if damaged, but holds
            less content.
          </span>
        </label>
        {error && (
          <p className="tool-message error-message" role="alert" id="qr-error">
            {error}
          </p>
        )}
      </section>
      <section
        className="workspace-panel qr-preview-panel"
        aria-label="QR code preview"
      >
        <div className="panel-heading">
          <span className="step-number">02</span>
          <h2>Ready to share</h2>
          <span className="live-label">
            <span /> LIVE PREVIEW
          </span>
        </div>
        <div className="qr-preview-stage">
          {current?.png && !error && payload.value ? (
            <img
              className="generated-qr"
              src={current.png}
              alt="Generated QR code for your content"
              width={size}
              height={size}
            />
          ) : (
            <div className="qr-empty">
              <ToolIcon name="qr" />
              <p>
                {error
                  ? "A quick fix, then you’re ready."
                  : payload.value
                    ? "Creating your code…"
                    : "Your code starts here."}
              </p>
              <span>
                {payload.value && !error
                  ? "Just a moment."
                  : "Add your details to see a preview."}
              </span>
            </div>
          )}
        </div>
        <p className="qr-caption">
          {current?.png && !error && payload.value
            ? "One scan. You’re there."
            : "A little square. A lot to share."}
        </p>
        <div className="download-actions">
          <button
            className="primary-button"
            disabled={!current?.png || Boolean(error) || !payload.value}
            onClick={() =>
              current?.png && downloadUrl(current.png, "qr-code.png")
            }
          >
            Download PNG <span aria-hidden="true">↓</span>
          </button>
          <button
            className="secondary-button"
            disabled={!current?.svg || Boolean(error) || !payload.value}
            onClick={() =>
              current?.svg &&
              downloadText(current.svg, "qr-code.svg", "image/svg+xml")
            }
          >
            Download SVG <span aria-hidden="true">↓</span>
          </button>
        </div>
        <p className="field-hint preview-hint">
          Static codes. No expiration. Test with your phone before sharing or
          printing.
        </p>
        <span className="sr-only" role="status" aria-live="polite">
          {current?.png && !error && payload.value
            ? "QR code ready to download."
            : ""}
        </span>
      </section>
    </div>
  );
}
