import type { FileData, FileFormat, FormatHandler } from "../FormatHandler.ts";
import * as yaml from "@std/yaml";
import { replaceExtension } from "./handlerUtils.ts";

/**
 * RFC 4180 CSV parser: quoted fields may contain commas, doubled quotes and
 * line breaks; the last record doesn't need a trailing newline.
 */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldStarted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === "\"") {
        if (text[i + 1] === "\"") {
          field += "\"";
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === "\"" && !fieldStarted) {
      inQuotes = true;
      fieldStarted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
      fieldStarted = false;
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      fieldStarted = false;
    } else {
      field += ch;
      fieldStarted = true;
    }
  }
  if (inQuotes) throw new Error("Unterminated quoted CSV field.");
  if (fieldStarted || row.length) {
    row.push(field);
    rows.push(row);
  }
  // Ignore blank lines.
  return rows.filter(r => r.length > 1 || r[0] !== "");
}

export function csvEscape(str: string): string {
  if (/[",\r\n]/.test(str) || /^\s|\s$/.test(str))
    return `"${str.replaceAll("\"", "\"\"")}"`;
  return str;
}

/** Turns an arbitrary JSON key into a well-formed XML element name. */
export function xmlName(name: string): string {
  let out = name.replace(/[^A-Za-z0-9_.\-\u00B7\u00C0-\uFFFF]/g, "_");
  if (!/^[A-Za-z_\u00C0-\uFFFF]/.test(out)) out = "_" + out;
  return out;
}

export function csvToObjects(text: string): Record<string, string>[] {
  const data = parseCSV(text);
  const keys = data.shift() ?? [];
  return data.map(entry => {
    const jsonEntry: Record<string, string> = Object.create(null);
    for (let i = 0; i < entry.length; i++) {
      jsonEntry[i < keys.length ? keys[i] : `column${i + 1}`] = entry[i];
    }
    return { ...jsonEntry };
  });
}

function parseXML(text: string): any {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "application/xml");
  const parseError = doc.getElementsByTagName("parsererror")[0];
  if (parseError) throw new Error("Invalid XML: " + (parseError.textContent ?? "").trim());

  function nodeToObj(node: Node): any {
    if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
      const t = node.textContent;
      return t || undefined;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return undefined;

    const el = node as Element;
    const obj: any = Object.assign(Object.create(null), { _tag: el.tagName });

    if (el.attributes.length) {
      for (let i = 0; i < el.attributes.length; i++) {
        const attr = el.attributes[i];
        obj[attr.name] = attr.value;
      }
    }

    const children: any[] = [];
    for (let i = 0; i < el.childNodes.length; i++) {
      const child = nodeToObj(el.childNodes[i]);
      if (child !== undefined) children.push(child);
    }
    obj._children = children;
    return obj;
  }

  return nodeToObj(doc.documentElement);
}

export class toJsonHandler implements FormatHandler {
  public name: string = "tojson";
  public ready: boolean = true;

  public supportedFormats: FileFormat[] = [
    {
      name: "Comma Separated Values",
      format: "csv",
      extension: "csv",
      mime: "text/csv",
      from: true,
      to: false,
      internal: "csv"
    },
    {
      name: "Extensible Markup Language",
      format: "xml",
      extension: "xml",
      mime: "application/xml",
      from: true,
      to: false,
      internal: "xml"
    },
    {
      name: "YAML Ain't Markup Language",
      format: "yaml",
      extension: "yml",
      mime: "application/yaml",
      from: true,
      to: false,
      internal: "yaml"
    },
    {
      name: "JavaScript Object Notation",
      format: "json",
      extension: "json",
      mime: "application/json",
      from: false,
      to: true,
      internal: "json"
    },
  ];

  async init() {
    this.ready = true;
  }

  async doConvert(
    inputFiles: FileData[],
    inputFormat: FileFormat,
    _outputFormat: FileFormat,
  ): Promise<FileData[]> {
    return inputFiles.map(file => {
      const name = replaceExtension(file.name, "json");
      const text = new TextDecoder().decode(file.bytes);
      let object: any;
      switch (inputFormat.mime) {
        case "text/csv":
          object = csvToObjects(text);
          break;
        case "application/xml":
          object = parseXML(text);
          break;
        case "application/yaml":
          object = yaml.parse(text);
          break;
        default:
          throw new Error("Unsupported input format");
      }
      return {
        name,
        bytes: new TextEncoder().encode(JSON.stringify(object))
      };
    });
  }
}

export class fromJsonHandler implements FormatHandler {
  public name: string = "fromjson";
  public ready: boolean = true;

  public supportedFormats: FileFormat[] = [
    {
      name: "Comma Separated Values",
      format: "csv",
      extension: "csv",
      mime: "text/csv",
      from: false,
      to: true,
      internal: "csv"
    },
    {
      name: "Extensible Markup Language",
      format: "xml",
      extension: "xml",
      mime: "application/xml",
      from: false,
      to: true,
      internal: "xml"
    },
    {
      name: "YAML Ain't Markup Language",
      format: "yaml",
      extension: "yml",
      mime: "application/yaml",
      from: false,
      to: true,
      internal: "yaml"
    },
    {
      name: "JavaScript Object Notation",
      format: "json",
      extension: "json",
      mime: "application/json",
      from: true,
      to: false,
      internal: "json"
    },
  ];

  async init() {
    this.ready = true;
  }

  async doConvert(
    inputFiles: FileData[],
    _inputFormat: FileFormat,
    outputFormat: FileFormat
  ): Promise<FileData[]> {
    return inputFiles.map(file => {
      const name = replaceExtension(file.name, outputFormat.extension);
      const object = JSON.parse(new TextDecoder().decode(file.bytes));
      let text = "";
      switch (outputFormat.mime) {
        case "text/csv": {
          let arr = object;
          if (arr === null || typeof arr !== "object") {
            // A bare scalar document becomes a single-cell table.
            arr = [arr];
          } else if (!Array.isArray(arr)) {
            const newArr: any[] = [];
            for (const [k, v] of Object.entries(object)) {
              if (v != null && typeof v === "object" && !Array.isArray(v)) {
                (v as any)._key = k;
                newArr.push(v);
              } else {
                newArr.push({ _key: k, _value: v });
              }
            }
            arr = newArr;
          }
          const keySet = new Set<string>();
          for (const value of arr) {
            if (value === null || typeof value !== "object" || Array.isArray(value)) {
              keySet.add("_value");
              continue;
            }
            for (const key of Object.keys(value)) {
              if (!keySet.has(key)) keySet.add(key);
            }
          }
          const keys = [...keySet].sort();
          text += keys.map(x => csvEscape(x)).join(",") + "\n";
          for (const value of arr) {
            text += keys.map(key => {
              const isScalar = value === null || typeof value !== "object" || Array.isArray(value);
              if (isScalar) return key === "_value" ? value : "";
              return value[key] ?? "";
            }).map(x => csvEscape(typeof x === "string" ? x : JSON.stringify(x) ?? "")).join(",") + "\n";
          }
          break;
        }
        case "application/xml": {
          function xmlEscape(str: string): string {
            return str
              .replaceAll("&", "&amp;")
              .replaceAll("<", "&lt;")
              .replaceAll(">", "&gt;")
              .replaceAll("\"", "&quot;")
              .replaceAll("'", "&apos;");
          }
          function write(value: any, tagName: string | null = null) {
            if (tagName != null) tagName = xmlName(tagName);
            if (typeof value !== "object" || value === null) {
              const str = xmlEscape(typeof value === "string" ? value : JSON.stringify(value));
              if (tagName != null) text += `<${tagName}>${str}</${tagName}>`;
              else text += str;
              return;
            }
            if (Array.isArray(value)) {
              tagName ??= "Array";
              text += `<${tagName}>`;
              for (const item of value) write(item, "Item");
              text += `</${tagName}>`;
              return;
            }
            const isXMLTag = typeof value._tag === "string" && Array.isArray(value._children);
            const qualifiedName = (name: string) => name.split(":").map(xmlName).join(":");
            if (isXMLTag) tagName ??= qualifiedName(value._tag);
            tagName ??= "Object";
            text += `<${tagName}`;
            if (isXMLTag) {
              for (const [k, v] of Object.entries(value)) {
                if (k === "_tag" || k === "_children") continue;
                text += ` ${qualifiedName(k)}="${xmlEscape(String(v))}"`;
              }
            }
            text += ">";
            if (isXMLTag) {
              for (const child of value._children) write(child);
            } else {
              for (const [k, v] of Object.entries(value)) write(v, k);
            }
            text += `</${tagName}>`;
          }
          text = `<?xml version="1.0" encoding="UTF-8"?>\n`;
          // A document needs exactly one root element.
          if (object === null || typeof object !== "object") write(object, "Value");
          else write(object);
          break;
        }
        case "application/yaml":
          text = yaml.stringify(object);
          break;
        default:
          throw new Error("Unsupported output format");
      }
      return {
        name,
        bytes: new TextEncoder().encode(text)
      };
    });
  }
}
